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
      const st = Sim.stations[id]
      this._windows[id] = { main: [] }
      this._conduitState[id] = {
        main: { currentTargetId: null, sessionEndSec: 0 },
      }
      for (let i = 0; i < st.commConduits.length; i++) {
        const key = 'comm' + i
        this._windows[id][key] = []
        this._conduitState[id][key] = {
          currentTargetId: st.commConduits[i].targetId,
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
        // Update sessionEndSec: max busy duration of remaining windows
        const wins = this._windows[stId][key]
        const busyUntil = wins.length === 0 ? now : wins.reduce((m, w) => Math.max(m, w.startSec + (w.windowSec || 0)), 0)
        this._conduitState[stId][key].sessionEndSec = Math.max(now, busyUntil)
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
          if (w.isReceiver) continue
          if (w._visuallyDispatched) continue
          if (w.startSec > now) continue
          const msg = Sim.messageMap[w.messageId]
          if (!msg) continue
          const fromSt = Sim.stations[stId]
          const toSt = Sim.stations[w.targetId]

          // Fix: Clear pending flag on dispatch to allow scheduling next interval
          if (msg.type === 'base_check' && fromSt) {
            fromSt.pendingCheckinDests.delete(w.targetId)
          }

          const speedC = this._getMsgSpeed(msg, fromSt)
          if (fromSt && toSt) Queue.spawnSignalDot(fromSt, toSt, msg.type, speedC)
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

  enqueue(fromId, toId, type, priority, analystPath = null) {
    const station = Sim.stations[fromId]
    if (!station) return null
    const id = 'msg_' + ++Queue._msgCounter
    const msg = {
      id,
      type,
      priority,
      sourceId: fromId,
      destinationId: toId,
      path: null, // resolved by scheduler
      analystPath, // stable copy for UI tracking
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
    return msg
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
        msg.path = null
        msg.status = 'awaiting_alignment'
        continue
      }

      const nextStation = Sim.stations[nextHopId]
      const windowSec = this._estimateWindowSec(msg)
      const speedC = this._getMsgSpeed(msg, station)

      // REAL-TIME DISTANCE: calculate travel time based on current positions
      const currentDistLY = Vec3.dist(station.worldPos, nextStation.worldPos)
      const travelSec = (currentDistLY / speedC) * C.YEAR_IN_SECONDS

      // SAFETY MARGIN: Ensure we have enough LOS for the pulse AND the travel time
      // to avoid the bridge closing while the signal is in flight.
      const totalWindowNeeded = windowSec + travelSec

      const pair = this._findChannelPair(station, nextStation, now, msg)
      if (!pair) continue

      const { sourceKey, targetKey } = pair
      const csA = this._conduitState[station.id][sourceKey]
      const csB = this._conduitState[nextStation.id][targetKey]

      // PROTOCOL ENFORCEMENT:
      // Only heartbeats and coordination signals can trigger a new alignment.
      // Payloads (data, drone_transit, vessel_transit) MUST piggyback
      // on an existing session.
      const isPayload = msg.type === 'data' ||
                        msg.type === 'drone_transit' ||
                        msg.type === 'vessel_transit'

      const isAlreadyAimed = csA.currentTargetId === nextHopId && csA.sessionEndSec > now

      if (!isAlreadyAimed && isPayload) {
        // Wait for next heartbeat or coordination pulse to open the window
        msg.status = 'awaiting_alignment'
        continue
      }

      const slewSec = isAlreadyAimed
        ? 0
        : Math.max(
            this._slewCost(station, sourceKey, nextHopId),
            this._slewCost(nextStation, targetKey, station.id),
          )

      const losRemaining = this._losCache?.[bridge.id] ?? 0
      if (losRemaining < totalWindowNeeded + slewSec) {
        msg.status = 'awaiting_alignment'
        continue
      }

      // Calculate start time: avoid overlap at both ends.
      // Sender must be free: csA.sessionEndSec
      // Receiver must be free WHEN PULSE ARRIVES: csB.sessionEndSec - travelSec
      const startSec = Math.max(now, csA.sessionEndSec, csB.sessionEndSec - travelSec) + slewSec
      const endSec = startSec + totalWindowNeeded

      // Update both conduit states
      // Free them after the pulse duration (windowSec)
      csA.currentTargetId = nextHopId
      csA.sessionEndSec = startSec + windowSec
      csB.currentTargetId = station.id
      csB.sessionEndSec = startSec + travelSec + windowSec

      // Add window to sender
      this._windows[station.id][sourceKey].push({
        targetId: nextHopId,
        startSec,
        endSec,
        windowSec,
        messageId: msgId,
        _visuallyDispatched: false,
        _delivered: false,
      })

      // Add window to receiver (offset by travel time)
      this._windows[nextStation.id][targetKey].push({
        targetId: station.id,
        startSec: startSec + travelSec,
        endSec: endSec,
        windowSec,
        messageId: msgId,
        isReceiver: true,
        _visuallyDispatched: true,
        _delivered: true,
      })

      msg.status = 'scheduled'
      msg.scheduledDeparture = startSec
      msg.estimatedArrival = endSec

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

  // Find a free channel (conduit) pair between source and target.
  // NEW MODEL: Each neighbor has a dedicated pair for comms.
  _findChannelPair(stationA, stationB, now, msg) {
    const useMain = msg.conduitType === 'main'

    if (useMain) {
      // Main conduit logic remains shared (limited hardware)
      const starA = Sim.stars[stationA.starId]
      const starB = Sim.stars[stationB.starId]
      if (!Physics.isInMainConduitRange(stationA, stationB, starA)) return null
      if (!Physics.isInMainConduitRange(stationB, stationA, starB)) return null

      const csA = this._conduitState[stationA.id]?.main
      const csB = this._conduitState[stationB.id]?.main
      if (!csA || !csB) return null

      const aAimed = csA.currentTargetId === stationB.id && csA.sessionEndSec > now
      const bAimed = csB.currentTargetId === stationA.id && csB.sessionEndSec > now

      if (aAimed && bAimed) return { sourceKey: 'main', targetKey: 'main' }

      // ALIGNMENT TRIGGERS:
      // Only heartbeats and booking requests can trigger a new Main Conduit alignment.
      const canTrigger = msg.type === 'base_check' ||
                         msg.type === 'main_booking' ||
                         msg.type === 'main_booking_ack'

      if (canTrigger) {
        if (csA.sessionEndSec <= now && csB.sessionEndSec <= now)
          return { sourceKey: 'main', targetKey: 'main' }
      }
      return null
    } else {
      // DEDICATED CONDUITS: Direct lookup
      const mapA = stationA.commConduitMap[stationB.id]
      const mapB = stationB.commConduitMap[stationA.id]
      if (!mapA || !mapB) return null

      return { sourceKey: mapA.outgoing, targetKey: mapB.incoming }
    }
  },

  _commConduitKeys(station) {
    return station.commConduits.map((_, i) => 'comm' + i)
  },

  _getMsgSpeed(msg, station) {
    if (msg.type === 'vessel_transit') {
      return Physics.calculateVesselSpeed(
        station,
        Sim.settings.vesselMassKg || C.VESSEL_MASS_KG,
        Sim.settings.vesselBubbleRadiusM || C.VESSEL_BUBBLE_RADIUS_M,
      )
    }
    if (msg.type === 'drone_transit') {
      return C.DRONE_SPEED_C
    }
    return C.COMM_SIGNAL_SPEED_C
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
            !w.isReceiver &&
            w.targetId === targetId &&
            w.startSec <= now &&
            w.endSec >= now, // VISIBILITY FIX: endSec already includes travelSec
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

    // Step 3: deliver messages — run even if bridge.los is false
    for (const [stId, targetId] of [
      [bridge.stationAId, bridge.stationBId],
      [bridge.stationBId, bridge.stationAId],
    ]) {
      const sA = Sim.stations[stId]
      const sB = Sim.stations[targetId]
      if (!sA || !sB) continue

      const wins = this._windows[stId]
      if (!wins) continue
      for (const arr of Object.values(wins)) {
        for (const w of arr) {
          if (w.targetId !== targetId) continue
          if (w.isReceiver) continue
          if (!w._visuallyDispatched || w._delivered) continue

          const msg = Sim.messageMap[w.messageId]
          if (!msg || msg.status === 'delivered' || msg.status === 'failed') continue

          const speedC = this._getMsgSpeed(msg, sA)
          const currentDistLY = Vec3.dist(sA.worldPos, sB.worldPos)
          const travelSec = (currentDistLY / speedC) * C.YEAR_IN_SECONDS

          // Deliver when the back of the pulse arrives
          if (now < w.startSec + travelSec + (w.windowSec || 0)) continue

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
            // Fix: Clear pending flag on delivery so next heartbeat can be scheduled
            const fromSt = Sim.stations[msg.sourceId]
            if (fromSt) fromSt.pendingCheckinDests.delete(msg.destinationId)

            const toSt = Sim.stations[msg.destinationId]
            if (toSt) toSt.lastCheckinByNeighbour[msg.sourceId] = now
          }
          if (msg.path && msg.path.length > 2) {
            // Relay: shift path and put back in queue at the current station (sB)
            msg.path.shift()
            msg.status = 'queued'
            sB.outboundQueue.add(msg.id)
          } else {
            // Reached final destination
            this._onMessageReachedFinalDestination(msg, sB)
          }
        }
      }
    }
  },

  _onMessageReachedFinalDestination(msg, station) {
    const ap = msg.analystPath
    if (!ap) return
    const scenario = Analyst._pendingScenario
    if (!scenario) return

    if (msg.type === 'manifest') {
      // Manifest reached target, now send ACK back to source
      if (ap[0] === scenario.fromId) {
        const turnaroundPath = [...ap].reverse()
        UI.appendLog('info', `Manifest received at ${station.name.replace(' Station','')}. Returning ACK.`)
        this.enqueue(turnaroundPath[0], turnaroundPath[turnaroundPath.length-1], 'manifest_ack', 1, turnaroundPath)
      }
    } else if (msg.type === 'manifest_ack') {
      // Manifest ACK reached source
      if (ap[0] === scenario.toId && station.id === scenario.fromId) {
        const needsMain = scenario.type === 'vessel_transit' || scenario.type === 'drone_transit'
        if (needsMain) {
          // Large payloads need main conduit booking
          UI.appendLog('info', 'Manifest ACK received. Requesting Main Conduit booking.')
          const m = this.enqueue(scenario.fromId, scenario.toId, 'main_booking', 1, scenario.path)
          if (m) m.conduitType = 'main' // Force booking request onto main conduit to trigger alignment
        } else {
          // Data skip main booking
          UI.appendLog('event', `Protocol handshake complete. Dispatching ${scenario.type}.`)
          this.enqueue(scenario.fromId, scenario.toId, scenario.type, scenario.priority, scenario.path)
          Analyst._pendingScenario = null
        }
      }
    } else if (msg.type === 'main_booking') {
      // Main booking request reached target
      if (ap[0] === scenario.fromId) {
        const turnaroundPath = [...ap].reverse()
        UI.appendLog('info', 'Main booking request received. Confirming alignment.')
        const m = this.enqueue(turnaroundPath[0], turnaroundPath[turnaroundPath.length-1], 'main_booking_ack', 1, turnaroundPath)
        if (m) m.conduitType = 'main'
      }
    } else if (msg.type === 'main_booking_ack') {
      // Main booking ACK reached source
      if (ap[0] === scenario.toId && station.id === scenario.fromId) {
        UI.appendLog('event', `Protocol handshake complete. Dispatching ${scenario.type}.`)
        this.enqueue(scenario.fromId, scenario.toId, scenario.type, scenario.priority, scenario.path)
        Analyst._pendingScenario = null
      }
    }
  },
}
