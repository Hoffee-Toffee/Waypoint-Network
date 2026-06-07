// scheduler.js — Deferred Acceptance window allocation, conduit slewing,
//                session management, and background signal generation

'use strict'

// ── Background signal generator ───────────────────────────────────────────
const BgGen = {
  _accumSec: 0,

  tick(deltaSec) {
    if (!Sim.settings.backgroundSignals.enabled) return
    const ratePerSec = Sim.settings.backgroundSignals.ratePerHour / 3600
    this._accumSec += deltaSec
    const expected = this._accumSec * ratePerSec
    // Poisson: fire messages based on accumulated probability
    while (this._accumSec * ratePerSec >= 1) {
      this._accumSec -= 1 / ratePerSec
      this._fireOne()
    }
    // Also handle sub-1 probability stochastically
    if (Math.random() < expected % 1) {
      this._fireOne()
      this._accumSec = 0
    }
  },

  _fireOne() {
    const ids = Object.keys(Sim.stations).filter(
      (id) => Sim.stations[id].online,
    )
    if (ids.length < 2) return
    const mix = Sim.settings.backgroundSignals.typeMix
    const roll = Math.random()
    let type
    if (roll < mix.base_check) type = 'base_check'
    else if (roll < mix.base_check + mix.data) type = 'data'
    else if (roll < mix.base_check + mix.data + mix.drone_transit)
      type = 'drone_transit'
    else type = 'vessel_transit'

    // Pick source weighted by proximity to Sol station for realistic traffic
    let fromId, toId
    if (Sim.settings.backgroundSignals.distribution === 'proximity') {
      // Higher chance for well-connected, nearby stations
      const weights = ids.map((id) => {
        const bridges = Object.values(Sim.bridges).filter(
          (b) => b.stationAId === id || b.stationBId === id,
        )
        return Math.max(1, bridges.length)
      })
      const total = weights.reduce((a, b) => a + b, 0)
      let r = Math.random() * total
      let idx = 0
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i]
        if (r <= 0) {
          idx = i
          break
        }
      }
      fromId = ids[idx]
    } else {
      fromId = ids[Math.floor(Math.random() * ids.length)]
    }

    // Pick a reachable destination (has a bridge path)
    const reachable = ids.filter((id) => {
      if (id === fromId) return false
      return getBridgeForPair(fromId, id) !== null
    })
    if (reachable.length === 0) return
    toId = reachable[Math.floor(Math.random() * reachable.length)]

    const priority =
      type === 'base_check' ? 3 : Math.ceil(Math.random() * 4) + 1
    Scheduler.enqueue(fromId, toId, type, Math.min(priority, 5))
  },
}

// ── Scheduler ─────────────────────────────────────────────────────────────
const Scheduler = {
  // _windows[stationId][conduitKey] = [ { targetId, startSec, endSec, messageId,
  //                                       _visuallyDispatched, _delivered } ]
  _windows: {},

  // _conduitState[stationId][conduitKey] = { currentTargetId, sessionEndSec }
  // Tracks what each physical conduit is currently aimed at and when the
  // current session ends.  A conduit can only be retargeted after sessionEndSec.
  _conduitState: {},

  init() {
    this._windows = {}
    this._conduitState = {}
    for (const id of Object.keys(Sim.stations)) {
      this._windows[id] = { main: [] }
      this._conduitState[id] = {
        main: { currentTargetId: null, sessionEndSec: 0 },
      }
      const n = Sim.stations[id].commConduits.length
      for (let i = 0; i < 8; i++) {
        const key = 'comm' + i
        this._windows[id][key] = []
        this._conduitState[id][key] = {
          currentTargetId: null,
          sessionEndSec: 0,
        }
      }
    }
  },

  tick(deltaSec) {
    const now = Sim.simTimeSec

    // Pre-compute LOS remaining for each bridge once per tick.
    // losRemainingSeconds does a 360-step orbital scan per call, so caching
    // here avoids calling it N times per message in the queue processor.
    const losRemainingCache = {}
    for (const bridge of Object.values(Sim.bridges)) {
      if (!bridge.los) {
        losRemainingCache[bridge.id] = 0
        continue
      }
      const sA = Sim.stations[bridge.stationAId]
      const sB = Sim.stations[bridge.stationBId]
      if (sA && sB) {
        losRemainingCache[bridge.id] = Physics.losRemainingSeconds(
          sA,
          sB,
          Sim.stars,
        )
      }
    }
    this._losCache = losRemainingCache

    // Reset awaiting_alignment messages back to queued so they are retried.
    for (const station of Object.values(Sim.stations)) {
      for (const msgId of station.outboundQueue) {
        const msg = Sim.messageMap[msgId]
        if (msg && msg.status === 'awaiting_alignment') msg.status = 'queued'
      }
    }

    // 1. Prune windows: keep if not yet expired OR if dispatched but not yet delivered
    for (const stId of Object.keys(this._windows)) {
      for (const key of Object.keys(this._windows[stId])) {
        this._windows[stId][key] = this._windows[stId][key].filter(
          (w) => w.endSec > now || (w._visuallyDispatched && !w._delivered),
        )
        // Update sessionEndSec: max endSec of remaining windows, or now if empty
        const wins = this._windows[stId][key]
        if (wins.length === 0) {
          // Session has ended; conduit remains pointed at last target until slewed
          this._conduitState[stId][key].sessionEndSec = now
        } else {
          this._conduitState[stId][key].sessionEndSec = wins.reduce(
            (m, w) => Math.max(m, w.endSec),
            0,
          )
        }
      }
    }

    // 2. Process outbound queues
    for (const station of Object.values(Sim.stations)) {
      if (!station.online) continue
      this._processStationQueue(station, now)
    }

    // 3. Spawn visual signal dots for windows that have just become active
    for (const stId of Object.keys(this._windows)) {
      for (const key of Object.keys(this._windows[stId])) {
        for (const w of this._windows[stId][key]) {
          if (w._visuallyDispatched) continue
          if (w.startSec > now) continue
          const msg = Sim.messageMap[w.messageId]
          if (!msg) continue
          const fromSt = Sim.stations[msg.sourceId]
          const toSt = Sim.stations[msg.destinationId]
          if (fromSt && toSt) Queue.spawnSignalDot(fromSt, toSt, msg.type)
          if (msg.status === 'scheduled') msg.status = 'in_transit'
          w._visuallyDispatched = true
        }
      }
    }

    // 4. Advance slew state (visual only hook)
    for (const station of Object.values(Sim.stations)) {
      this._advanceSlew(station, deltaSec)
    }

    // 5. Activate / deactivate bridges; deliver messages
    for (const bridge of Object.values(Sim.bridges)) {
      this._updateBridgeFromSchedule(bridge, now)
    }
  },

  enqueue(fromId, toId, type, priority) {
    const station = Sim.stations[fromId]
    if (!station) return
    const id = 'msg_' + ++Queue._msgCounter
    const msg = {
      id,
      type,
      priority,
      sourceId: fromId,
      destinationId: toId,
      path: null, // resolved by scheduler
      status: 'queued',
      conduitType: type === 'vessel_transit' ? 'main' : 'comm',
      createdAt: Sim.simTimeSec,
      scheduledDeparture: null,
      actualDeparture: null,
      estimatedArrival: null,
      actualArrival: null,
      hopLog: [],
    }
    Sim.messages.push(msg)
    Sim.messageMap[id] = msg
    if (Sim.messages.length > C.MAX_MESSAGES) {
      const evicted = Sim.messages.splice(0, 1)[0]
      delete Sim.messageMap[evicted.id]
    }
    station.outboundQueue.add(id)
  },

  _processStationQueue(station, now) {
    // Sort queue: P1 first, then by creation time
    const sortedQueue = [...station.outboundQueue].sort((a, b) => {
      const ma = Sim.messageMap[a]
      const mb = Sim.messageMap[b]
      if (!ma || !mb) return 0
      if (ma.priority !== mb.priority) return ma.priority - mb.priority
      return ma.createdAt - mb.createdAt
    })

    for (const msgId of sortedQueue) {
      const msg = Sim.messageMap[msgId]
      if (!msg || msg.status !== 'queued') continue

      // Resolve path if not yet done
      if (!msg.path) {
        msg.path = this._resolvePath(msg.sourceId, msg.destinationId)
        if (!msg.path || msg.path.length < 2) {
          msg.status = 'failed'
          station.outboundQueue.delete(msgId)
          continue
        }
      }

      const nextHopId = msg.path[1]
      const bridge = getBridgeForPair(station.id, nextHopId)
      if (!bridge || !bridge.los) {
        // LOS unavailable — clear cached path so we re-route on next attempt
        // (a different path may be available when LOS is restored)
        msg.path = null
        msg.status = 'awaiting_alignment'
        continue
      }

      // Only schedule if LOS will last long enough for the full transmission.
      // Use the per-tick cached value to avoid repeated orbital scans.
      const nextStation = Sim.stations[nextHopId]
      const windowSec = this._estimateWindowSec(msg)
      const conduitKey = this._findFreeConduit(station, nextHopId, now, msg)
      const slewSec = conduitKey
        ? this._slewCost(station, conduitKey, nextHopId)
        : 0
      const losRemaining = this._losCache?.[bridge.id] ?? 0
      if (losRemaining < windowSec + slewSec) {
        msg.status = 'awaiting_alignment'
        continue
      }

      // Find a conduit that can reach nextHopId
      if (!conduitKey) continue

      const cs = this._conduitState[station.id][conduitKey]
      const stWindows = this._windows[station.id][conduitKey]

      // Is the conduit already in a session with this same target?
      const isAlreadyAimed =
        cs.currentTargetId === nextHopId && cs.sessionEndSec > now

      let startSec, endSec
      if (isAlreadyAimed) {
        // Piggyback: extend the existing session, no slew cost
        startSec = now
        endSec = cs.sessionEndSec + windowSec
        cs.sessionEndSec = endSec
      } else {
        // New target: starts after slew from current pointing (slewSec already computed above)
        startSec = Math.max(now, cs.sessionEndSec) + slewSec
        endSec = startSec + windowSec
        // Update conduit state to new target
        cs.currentTargetId = nextHopId
        cs.sessionEndSec = endSec
      }

      stWindows.push({
        targetId: nextHopId,
        startSec,
        endSec,
        messageId: msgId,
        _visuallyDispatched: false,
        _delivered: false,
      })

      msg.status = 'scheduled'
      msg.scheduledDeparture = startSec
      msg.estimatedArrival =
        endSec + (bridge.lengthLY / C.COMM_SIGNAL_SPEED_C) * C.YEAR_IN_SECONDS

      // Remove from outbound queue — now tracked by window
      station.outboundQueue.delete(msgId)
    }
  },

  // Simple BFS path resolution using bridge graph
  _resolvePath(fromId, toId) {
    if (fromId === toId) return [fromId]
    const visited = new Set([fromId])
    const queue = [[fromId]]
    while (queue.length) {
      const path = queue.shift()
      const current = path[path.length - 1]
      const neighbours = this._getNeighbours(current)
      for (const nid of neighbours) {
        if (visited.has(nid)) continue
        const newPath = [...path, nid]
        if (nid === toId) return newPath
        visited.add(nid)
        queue.push(newPath)
      }
    }
    return null
  },

  _getNeighbours(stationId) {
    // Use precomputed adjacency list (rebuilt with bridges) for O(1) lookup
    return Sim.adjacency[stationId] ?? []
  },

  // Deferred Acceptance: find the best available conduit for this message.
  //
  // KEY RULE: a comm conduit is a physical device that can only point at ONE
  // target at a time.  It cannot serve two different targets simultaneously.
  // A conduit is eligible for targetId only if:
  //   (a) it is idle (session has ended / never started), OR
  //   (b) its current session is already aimed at targetId (piggybacking).
  // If all conduits are mid-session with a different target, return null and
  // the message stays queued until a conduit frees up.
  _findFreeConduit(station, targetId, now, msg) {
    const useMain =
      msg.type === 'vessel_transit' || msg.type === 'drone_transit'
    const candidates = useMain ? ['main'] : this._commConduitKeys(station)

    if (useMain) {
      const targetStation = Sim.stations[targetId]
      const star = Sim.stars[station.starId]
      if (!Physics.isInMainConduitRange(station, targetStation, star))
        return null
    }

    // Phase 1: conduit already in an active session aimed at this exact target
    for (const key of candidates) {
      const cs = this._conduitState[station.id]?.[key]
      if (!cs) continue
      if (cs.currentTargetId === targetId && cs.sessionEndSec > now) return key
    }

    // Phase 2: idle conduit (session has ended or never started)
    for (const key of candidates) {
      const cs = this._conduitState[station.id]?.[key]
      if (!cs) continue
      if (cs.sessionEndSec <= now) return key
    }

    // All conduits are busy with different targets — cannot schedule yet
    return null
  },

  _commConduitKeys(station) {
    return station.commConduits.map((_, i) => 'comm' + i)
  },

  _estimateWindowSec(msg) {
    const base = {
      base_check: 5,
      manifest: 10,
      data: 15,
      ship_route: 8,
      drone_transit: 30,
      vessel_transit: 120,
      multi_hop_coordination: 12,
    }
    return base[msg.type] ?? 10
  },

  // Seconds to slew conduit from its last pointing to face targetId.
  // Uses actual angular distance between the last-target direction and the
  // new target direction, multiplied by the conduit's slew rate.
  _slewCost(station, conduitKey, targetId) {
    const cs = this._conduitState[station.id]?.[conduitKey]
    const rate =
      conduitKey === 'main'
        ? station.mainConduit.slewRateSecPerDeg
        : (station.commConduits[parseInt(conduitKey.replace('comm', ''), 10)]
            ?.slewRateSecPerDeg ?? C.COMM_CONDUIT_SLEW_RATE_S_DEG)

    const lastTargetId = cs?.currentTargetId
    if (!lastTargetId) return 5 // small startup cost from rest

    const lastStation = Sim.stations[lastTargetId]
    const targetStation = Sim.stations[targetId]
    if (!lastStation || !targetStation) return 5

    const toLast = Vec3.norm(Vec3.sub(lastStation.worldPos, station.worldPos))
    const toNew = Vec3.norm(Vec3.sub(targetStation.worldPos, station.worldPos))
    return Vec3.angleDeg(toLast, toNew) * rate
  },

  _setConduitTarget() {
    // Replaced by direct _conduitState updates in _processStationQueue
  },

  _advanceSlew(station, deltaSec) {
    // Main conduit: track current target direction
    // (visual only — actual physics check uses isInMainConduitRange)
    // Nothing to advance for pure direction tracking in current model
    // This is a hook for future animation of the conduit rotating
  },

  _updateBridgeFromSchedule(bridge, now) {
    // Step 1: update bridge status based on LOS (always, even when !los)
    if (!bridge.los) {
      if (bridge.status === 'active') bridge.status = 'occluded'
    }

    // Step 2: check for active scheduling windows (regardless of current LOS,
    // since a window may have been open before LOS was lost and the payload
    // is already in flight toward the destination).
    const hasActiveWindow = (stId, targetId) => {
      const wins = this._windows[stId]
      if (!wins) return false
      return Object.values(wins).some((arr) =>
        arr.some(
          (w) =>
            w.targetId === targetId && w.startSec <= now && w.endSec >= now,
        ),
      )
    }

    const sA = Sim.stations[bridge.stationAId]
    const sB = Sim.stations[bridge.stationBId]
    // Only open bridge status if LOS is clear
    if (bridge.los) {
      const isActive =
        hasActiveWindow(bridge.stationAId, bridge.stationBId) ||
        hasActiveWindow(bridge.stationBId, bridge.stationAId)

      if (isActive && bridge.status !== 'active') {
        bridge.status = 'active'
        bridge.activeSince = now
        UI.appendLog(
          'event',
          `Bridge opened: ${sA.name.replace(' Station', '')} ↔ ${sB.name.replace(' Station', '')}`,
        )
      } else if (!isActive && bridge.status === 'active') {
        bridge.status = 'inactive'
        UI.appendLog(
          'info',
          `Bridge closed: ${sA.name.replace(' Station', '')} ↔ ${sB.name.replace(' Station', '')}`,
        )
      }
    }

    // Step 3: deliver messages — run even if bridge.los is false, because a
    // window that was open before occlusion may still have an in-flight payload
    // that needs to be marked delivered when the travel time elapses.
    for (const [stId, targetId] of [
      [bridge.stationAId, bridge.stationBId],
      [bridge.stationBId, bridge.stationAId],
    ]) {
      const wins = this._windows[stId]
      if (!wins) continue
      for (const arr of Object.values(wins)) {
        for (const w of arr) {
          if (w.targetId !== targetId) continue
          // Only deliver windows that have been visually dispatched (signal sent)
          if (!w._visuallyDispatched) continue
          if (w._delivered) continue
          const msg = Sim.messageMap[w.messageId]
          if (!msg || msg.status === 'delivered' || msg.status === 'failed')
            continue
          const travelSec =
            (bridge.lengthLY / C.COMM_SIGNAL_SPEED_C) * C.YEAR_IN_SECONDS
          if (now < w.startSec + travelSec) continue
          msg.status = 'delivered'
          msg.actualDeparture = w.startSec
          msg.actualArrival = now
          w._delivered = true
          const fromName =
            Sim.stations[msg.sourceId]?.name.replace(' Station', '') ??
            msg.sourceId
          const toName =
            Sim.stations[msg.destinationId]?.name.replace(' Station', '') ??
            msg.destinationId
          UI.appendLog(
            'event',
            `Delivered [${msg.type}] P${msg.priority}: ${fromName}→${toName}`,
          )
          if (msg.type === 'base_check') {
            const toSt = Sim.stations[msg.destinationId]
            if (toSt) toSt.lastCheckinByNeighbour[msg.sourceId] = now
          }
          if (msg.path && msg.path.length > 2) {
            Scheduler.enqueue(
              msg.path[1],
              msg.destinationId,
              msg.type,
              msg.priority,
            )
            msg.status = 'relaying'
          }
        }
      }
    }
  },
}
