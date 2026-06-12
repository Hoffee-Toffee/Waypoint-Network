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
    while (this._accumSec * ratePerSec >= 1) {
      this._accumSec -= 1 / ratePerSec
      this._fireOne()
    }
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

    let fromId, toId
    if (Sim.settings.backgroundSignals.distribution === 'proximity') {
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
  _windows: {},
  _conduitState: {},
  _losCache: {},
  _mainBookings: {},

  init() {
    this._windows = {}
    this._conduitState = {}
    this._mainBookings = {}
    this.reSync()
  },

  reSync() {
    this._losCache = {}
    for (const id of Object.keys(Sim.stations)) {
      const st = Sim.stations[id]
      if (!this._windows[id]) {
        this._windows[id] = { main: [] }
        this._conduitState[id] = {
          main: { currentTargetId: null, sessionEndSec: 0 },
        }
      }

      const keys = ['main', ...st.commConduits.map((_, i) => 'comm' + i)]
      for (const key of keys) {
        if (!this._windows[id][key]) {
          this._windows[id][key] = []
          const targetId = key === 'main' ? null : (st.commConduits[parseInt(key.replace('comm',''))]?.targetId ?? null)
          this._conduitState[id][key] = {
            currentTargetId: targetId,
            sessionEndSec: 0,
          }
        }
      }
      if (!st.reservations) st.reservations = []
    }
  },

  tick(deltaSec) {
    const now = Sim.simTimeSec

    const losRemainingCache = {}
    for (const bridge of Object.values(Sim.bridges)) {
      if (!bridge.los) {
        losRemainingCache[bridge.id] = 0
        continue
      }
      const sA = Sim.stations[bridge.stationAId]
      const sB = Sim.stations[bridge.stationBId]
      if (sA && sB) {
        losRemainingCache[bridge.id] = Physics.losRemainingSeconds(sA, sB, Sim.stars)
      }
    }
    this._losCache = losRemainingCache

    for (const station of Object.values(Sim.stations)) {
      for (const msgId of station.outboundQueue) {
        const msg = Sim.messageMap[msgId]
        if (msg && msg.status === 'awaiting_alignment') msg.status = 'queued'
      }
    }

    // 1. Prune windows and reservations
    for (const stId of Object.keys(this._windows)) {
      const st = Sim.stations[stId]
      if (st) st.reservations = (st.reservations || []).filter(r => Math.max(r.arrivalEnd || 0, r.endSec || 0) > now - 3600)

      for (const key of Object.keys(this._windows[stId])) {
        this._windows[stId][key] = this._windows[stId][key].filter(
          (w) => w.endSec > now || (w._visuallyDispatched && !w._delivered),
        )
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

    // 3. Spawn visual signal dots
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

    // 4. Advance slew state
    for (const station of Object.values(Sim.stations)) {
      this._advanceSlew(station, deltaSec)
    }

    // 5. Activate / deactivate bridges; deliver messages
    for (const bridge of Object.values(Sim.bridges)) {
      this._updateBridgeFromSchedule(bridge, now)
    }
  },

  enqueue(fromId, toId, type, priority, analystPath = null, options = {}) {
    const station = Sim.stations[fromId]
    if (!station) return null
    const id = 'msg_' + ++Queue._msgCounter
    const msg = {
      id,
      type,
      priority,
      sourceId: fromId,
      destinationId: toId,
      path: options.path || null,
      analystPath,
      status: 'queued',
      conduitType: (type === 'vessel_transit' || options.conduitType === 'main') ? 'main' : 'comm',
      createdAt: Sim.simTimeSec,
      scheduledDeparture: null,
      actualDeparture: null,
      estimatedArrival: null,
      actualArrival: null,
      hopLog: [],
      ...options,
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
        msg.status = 'awaiting_alignment'
        continue
      }

      const nextStation = Sim.stations[nextHopId]
      const windowSec = this._estimateWindowSec(msg)
      const speedC = this._getMsgSpeed(msg, station)
      const currentDistLY = Vec3.dist(station.worldPos, nextStation.worldPos)
      const travelSec = (currentDistLY / speedC) * C.YEAR_IN_SECONDS
      const totalWindowNeeded = windowSec + travelSec

      const pair = this._findChannelPair(station, nextStation, now, msg)
      if (!pair) continue

      const { sourceKey, targetKey } = pair
      const csA = this._conduitState[station.id][sourceKey]
      const csB = this._conduitState[nextStation.id][targetKey]

      const isPayload = msg.type === 'data' ||
                        msg.type === 'drone_transit' ||
                        msg.type === 'vessel_transit'

      const isAlreadyAimed = csA.currentTargetId === nextHopId && csA.sessionEndSec > now

      if (!isAlreadyAimed && isPayload && !msg.isReserved) {
        msg.status = 'awaiting_alignment'
        continue
      }

      if (msg.isReserved) {
        const slewSec = this._slewCost(station, sourceKey, nextHopId)
        if (now < msg.earliestStart - slewSec - 5) {
          continue
        }
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

      let startSec = Math.max(now, csA.sessionEndSec, csB.sessionEndSec - travelSec, msg.earliestStart || 0) + slewSec

      if (sourceKey === 'main') {
        if (msg.isReserved) {
          startSec = msg.earliestStart
          if (startSec < now - 3600) {
            UI.appendLog('error', `Reservation lapsed for ${msg.type} at ${station.name.replace(' Station','')} (Start: ${this._formatTime(startSec)}, Now: ${this._formatTime(now)})`)
            msg.status = 'failed'
            station.outboundQueue.delete(msgId)
            continue
          }
        } else {
          startSec = this._enforceMainQuotas(station, startSec, msg.priority)
          let ok = false
          while (!ok) {
            let conflict = null
            const myEndSec = startSec + windowSec
            const arrivalStart = startSec + travelSec
            const arrivalEnd = arrivalStart + windowSec

            for (const b of (station.reservations || [])) {
              if (!(myEndSec <= b.startSec || startSec >= b.endSec)) { conflict = b; break; }
            }
            if (!conflict) {
              for (const b of (nextStation.reservations || [])) {
                if (!(arrivalEnd <= b.startSec || arrivalStart >= b.endSec)) { conflict = b; break; }
              }
            }
            if (conflict) {
              startSec = (arrivalEnd > conflict.startSec && arrivalStart < conflict.endSec)
                ? conflict.endSec - travelSec + 1
                : conflict.endSec + 1
            } else {
              ok = true
            }
          }
        }
      }

      const endSec = startSec + totalWindowNeeded

      csA.currentTargetId = nextHopId
      csA.sessionEndSec = startSec + windowSec
      csB.currentTargetId = station.id
      csB.sessionEndSec = startSec + travelSec + windowSec

      if (sourceKey === 'main') {
        if (!this._mainBookings[station.id]) this._mainBookings[station.id] = []
        this._mainBookings[station.id].push({ priority: msg.priority, endSec: startSec + windowSec })
        if (this._mainBookings[station.id].length > 10) this._mainBookings[station.id].shift()

        if (msg.isReserved) {
          const res = msg.bookingRef
          const match = (r) => (res && r.msgId === res.msgId) || (r.type === msg.type && Math.abs(r.startSec - msg.earliestStart) < 1 && r.toId === nextHopId)
          station.reservations = (station.reservations || []).filter(r => !match(r))
          nextStation.reservations = (nextStation.reservations || []).filter(r => !match(r))
        }
      }

      this._windows[station.id][sourceKey].push({
        targetId: nextHopId,
        startSec,
        endSec,
        windowSec,
        messageId: msgId,
        _visuallyDispatched: false,
        _delivered: false,
      })

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
      station.outboundQueue.delete(msgId)
    }
  },

  _resolvePath(fromId, toId) {
    if (fromId === toId) return [fromId]
    const visited = new Set([fromId])
    const queue = [[fromId]]
    while (queue.length) {
      const path = queue.shift()
      const current = path[path.length - 1]
      const neighbours = Sim.adjacency[current] ?? []
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

  _findChannelPair(stationA, stationB, now, msg) {
    const useMain = msg.conduitType === 'main'
    if (useMain) {
      const starA = Sim.stars[stationA.starId]
      const starB = Sim.stars[stationB.starId]
      if (!Physics.isInMainConduitRange(stationA, stationB, starA)) return null
      if (!Physics.isInMainConduitRange(stationB, stationA, starB)) return null
      const csA = this._conduitState[stationA.id]?.main
      const csB = this._conduitState[stationB.id]?.main
      if (!csA || !csB) return null
      if (csA.currentTargetId === stationB.id && csA.sessionEndSec > now &&
          csB.currentTargetId === stationA.id && csB.sessionEndSec > now) {
        return { sourceKey: 'main', targetKey: 'main' }
      }
      if (msg.type === 'base_check' || msg.isReserved) {
        if (csA.sessionEndSec <= now + 10 && csB.sessionEndSec <= now + 10) {
          return { sourceKey: 'main', targetKey: 'main' }
        }
      }
      return null
    } else {
      const mapA = stationA.commConduitMap[stationB.id]
      const mapB = stationB.commConduitMap[stationA.id]
      if (!mapA || !mapB) return null
      return { sourceKey: mapA.outgoing, targetKey: mapB.incoming }
    }
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

  _slewCost(station, conduitKey, targetId) {
    const cs = this._conduitState[station.id]?.[conduitKey]
    const rate =
      conduitKey === 'main'
        ? station.mainConduit.slewRateSecPerDeg
        : (station.commConduits[parseInt(conduitKey.replace('comm', ''), 10)]
            ?.slewRateSecPerDeg ?? C.COMM_CONDUIT_SLEW_RATE_S_DEG)

    const lastTargetId = cs?.currentTargetId
    if (!lastTargetId) return 5

    const lastStation = Sim.stations[lastTargetId]
    const targetStation = Sim.stations[targetId]
    if (!lastStation || !targetStation) return 5

    const toLast = Vec3.norm(Vec3.sub(lastStation.worldPos, station.worldPos))
    const toNew = Vec3.norm(Vec3.sub(targetStation.worldPos, station.worldPos))
    return Vec3.angleDeg(toLast, toNew) * rate
  },

  _advanceSlew(station, deltaSec) {
  },

  _enforceMainQuotas(station, startSec, priority) {
      const bookings = this._mainBookings[station.id] || []
      if (priority === 1) return startSec

      let ok = false
      let candidateStart = startSec
      while (!ok) {
          const recent = bookings.filter(b => b.endSec > candidateStart - 86400)
          const lowCount = recent.filter(b => b.priority >= 5).length
          const medCount = recent.filter(b => b.priority >= 3).length

          if (priority >= 5 && lowCount >= 5) {
              candidateStart += 600
              continue
          }
          if (priority >= 3 && medCount >= 8) {
              candidateStart += 600
              continue
          }
          ok = true
      }
      return candidateStart
  },

  _updateBridgeFromSchedule(bridge, now) {
    if (!bridge.los) {
      if (bridge.status === 'active') bridge.status = 'occluded'
    }

    const hasActiveWindow = (stId, targetId) => {
      const wins = this._windows[stId]
      if (!wins) return false
      return Object.values(wins).some((arr) =>
        arr.some(
          (w) =>
            !w.isReceiver &&
            w.targetId === targetId &&
            w.startSec <= now &&
            w.endSec >= now,
        ),
      )
    }

    if (bridge.los) {
      const isActive =
        hasActiveWindow(bridge.stationAId, bridge.stationBId) ||
        hasActiveWindow(bridge.stationBId, bridge.stationAId)

      if (isActive && bridge.status !== 'active') {
        bridge.status = 'active'
        bridge.activeSince = now
      } else if (!isActive && bridge.status === 'active') {
        bridge.status = 'inactive'
      }
    }

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

          if (now < w.startSec + travelSec + (w.windowSec || 0)) continue

          msg.status = 'delivered'
          msg.actualDeparture = w.startSec
          msg.actualArrival = now
          w._delivered = true

          if (msg.type === 'base_check') {
            const fromSt = Sim.stations[msg.sourceId]
            if (fromSt) fromSt.pendingCheckinDests.delete(msg.destinationId)
            const toSt = Sim.stations[msg.destinationId]
            if (toSt) toSt.lastCheckinByNeighbour[msg.sourceId] = now
          }

          const scenario = Analyst._pendingScenario
          const isProtocol = msg.type === 'manifest' || msg.type === 'manifest_ack'
          const isScenarioPayload = scenario && msg.type === scenario.type

          if (msg.path && msg.path.length > 2 && !isProtocol) {
            msg.path.shift()
            msg.status = 'queued'

            if (isScenarioPayload) {
                const nextTargetId = msg.path[1] || scenario.toId
                const res = (sB.reservations || []).find(r =>
                    r.fromId === sB.id &&
                    r.type === msg.type &&
                    r.toId === nextTargetId &&
                    !r.isReceiver &&
                    Math.max(r.arrivalEnd || 0, r.endSec || 0) >= now - 3600
                )
                if (res) {
                    msg.earliestStart = res.startSec
                    msg.isReserved = true
                    msg.bookingRef = res
                    UI.appendLog('info', `Relay picked up reservation at ${sB.name.replace(' Station','')}: ${this._formatTime(res.startSec)}`)
                } else {
                    UI.appendLog('info', `Waiting for downstream reservation for ${msg.type} at ${sB.name.replace(' Station','')}`)
                }
            }
            UI.appendLog('info', `Relaying ${msg.type} from ${sB.name.replace(' Station','')} to ${msg.path[1].replace('_station','')}`)
            sB.outboundQueue.add(msg.id)
          } else {
            this._onMessageReachedFinalDestination(msg, sB)
          }
        }
      }
    }
  },

  _formatTime(s) {
    const days = Math.floor(s / 86400)
    const hrs = Math.floor((s % 86400) / 3600)
    const mins = Math.floor((s % 3600) / 60)
    const year = Math.floor(days / 365) + 2400
    const doy = (days % 365) + 1
    return `UST ${year}.${String(doy).padStart(3, '0')} ${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
  },

  _findFreeSlot(fromSt, toSt, minStart, duration, transitSec, peerBookings = []) {
    const horizon = minStart - 3600
    const toBookings = (toSt.reservations || [])
      .concat((Scheduler._windows[toSt.id]?.main ?? [])
        .filter(w => !w._delivered)
        .map(w => ({ startSec: w.startSec, endSec: w.endSec })))
      .filter(b => b.endSec > horizon)

    const fromBookings = (fromSt.reservations || [])
      .concat((Scheduler._windows[fromSt.id]?.main ?? [])
        .filter(w => !w._delivered)
        .map(w => ({ startSec: w.startSec, endSec: w.endSec })))
      .concat(peerBookings)
      .filter(b => b.endSec > horizon)

    let t = minStart
    while (t < minStart + 86400 * 365) {
      const losWindow = Physics.getNextLOSWindow(fromSt, toSt, Sim.stars, t, duration, transitSec)
      if (!losWindow) return null

      let candidateStart = Math.max(t, losWindow.start)
      const slewSec = this._slewCost(fromSt, 'main', toSt.id)
      candidateStart = Math.max(candidateStart, candidateStart + slewSec)

      const candidateEnd = candidateStart + duration
      const arrivalStart = candidateStart + transitSec
      const arrivalEnd = arrivalStart + duration

      let conflict = null
      for (const b of fromBookings) {
        if (!(candidateEnd <= b.startSec || candidateStart >= b.endSec)) { conflict = b; break; }
      }
      if (!conflict) {
        for (const b of toBookings) {
          if (!(arrivalEnd <= b.startSec || arrivalStart >= b.endSec)) { conflict = b; break; }
        }
      }

      if (conflict) {
        if (arrivalEnd > conflict.startSec && arrivalStart < conflict.endSec) {
          t = conflict.endSec - transitSec + 1
        } else {
          t = conflict.endSec + 1
        }
      } else {
        return {
          sender: { start: candidateStart, end: candidateEnd },
          receiver: { start: arrivalStart, end: arrivalEnd }
        }
      }
    }
    return null
  },

  _onMessageReachedFinalDestination(msg, station) {
    const ap = msg.analystPath
    if (!ap) return
    const scenario = Analyst._pendingScenario
    if (!scenario) {
        if (msg.type === 'manifest') UI.appendLog('error', 'Manifest reached destination but no scenario is pending.')
        return
    }

    if (msg.type === 'manifest') {
      const data = msg.manifestData
      if (!data) {
        UI.appendLog('error', 'Manifest missing data.')
        return
      }

      const fromSt = Sim.stations[msg.sourceId]
      const toSt = station
      const isFinal = toSt.id === data.fullPath[data.fullPath.length - 1]

      const transitType = data.scenarioType
      const speedC = this._getMsgSpeed({ type: transitType }, fromSt)
      const distLY = Vec3.dist(fromSt.worldPos, toSt.worldPos)
      const transitSec = (distLY / speedC) * C.YEAR_IN_SECONDS
      const pulseSec = this._estimateWindowSec({ type: transitType })

      const commTransitSec = (distLY / C.COMM_SIGNAL_SPEED_C) * C.YEAR_IN_SECONDS
      const slewSecAtFrom = this._slewCost(fromSt, 'main', toSt.id)
      const minStart = Math.max(Sim.simTimeSec + commTransitSec + slewSecAtFrom + 30, msg.earliestStart || 0)

      const peerBookings = data.peerBookings || []

      let resAtFrom = (fromSt.reservations || []).find(
        (b) =>
          b.fromId === fromSt.id &&
          b.toId === toSt.id &&
          b.type === transitType &&
          b.startSec >= minStart &&
          !b.isReceiver
      )

      let resInfo
      if (resAtFrom) {
        UI.appendLog('info', `Piggybacking leg: ${fromSt.name.replace(' Station', '')} → ${toSt.name.replace(' Station', '')} @ ${this._formatTime(resAtFrom.startSec)}`)
        resInfo = resAtFrom
      } else {
        const slot = this._findFreeSlot(fromSt, toSt, minStart, pulseSec, transitSec, peerBookings)
        if (!slot) {
          UI.appendLog('error', `No slot found for ${fromSt.name} -> ${toSt.name}`)
          return
        }
        resInfo = {
            msgId: 'res_' + ++Queue._msgCounter,
            type: transitType,
            fromId: fromSt.id,
            toId: toSt.id,
            startSec: slot.sender.start,
            endSec: slot.sender.end,
            arrivalStart: slot.receiver.start,
            arrivalEnd: slot.receiver.end
        }

        if (!fromSt.reservations) fromSt.reservations = []
        if (!toSt.reservations) toSt.reservations = []
        fromSt.reservations.push({ ...resInfo, isReceiver: false })
        toSt.reservations.push({
            ...resInfo,
            isReceiver: true,
            startSec: resInfo.arrivalStart,
            endSec: resInfo.arrivalEnd
        })

        UI.appendLog('info', `Leg Booked: ${fromSt.name.replace(' Station', '')} → ${toSt.name.replace(' Station', '')} @ ${this._formatTime(resInfo.startSec)}`)
      }

      this.enqueue(toSt.id, fromSt.id, 'manifest_ack', 1, data.fullPath, {
        path: [toSt.id, fromSt.id],
        bookingRef: resInfo,
      })

      if (!isFinal) {
        const myIdx = data.fullPath.indexOf(toSt.id)
        const nextHopId = data.fullPath[myIdx + 1]
        UI.appendLog('info', `Forwarding manifest to ${nextHopId.replace('_station','')}`)

        const myFullBookings = (toSt.reservations || [])
          .concat((Scheduler._windows[toSt.id]?.main ?? [])
            .filter((w) => !w._delivered)
            .map((w) => ({ startSec: w.startSec, endSec: w.endSec, fromId: toSt.id, toId: w.targetId, type: 'window' })))
          .filter(b => b.endSec > resInfo.arrivalEnd - 3600)

        this.enqueue(toSt.id, nextHopId, 'manifest', 1, data.fullPath, {
          path: [toSt.id, nextHopId],
          earliestStart: resInfo.arrivalEnd,
          manifestData: { ...data, peerBookings: myFullBookings },
        })
      }
    } else if (msg.type === 'manifest_ack') {
      const res = msg.bookingRef
      if (res) {
        UI.appendLog('info', `Leg Confirmed: ${station.name.replace(' Station', '')} -> ${res.toId.replace('_station', '')} @ ${this._formatTime(res.startSec)}`)

        // Match payload in queue
        for (const msgId of station.outboundQueue) {
            const p = Sim.messageMap[msgId]
            if (p && p.type === scenario.type && (p.path?.[1] === res.toId || p.destinationId === scenario.toId)) {
                p.earliestStart = res.startSec
                p.isReserved = true
                p.bookingRef = res
                UI.appendLog('info', `Payload triggered at ${station.name.replace(' Station','')}`)
            }
        }

        if (station.id === scenario.fromId) {
          this.enqueue(station.id, scenario.toId, scenario.type, scenario.priority, scenario.path, {
            path: [...scenario.path],
            earliestStart: res.startSec,
            conduitType: 'main',
            isReserved: true,
            bookingRef: res
          })
        }
      }
    } else if (msg.type === scenario.type && station.id === scenario.toId) {
      UI.appendLog('event', `SUCCESS: ${msg.type} reached final destination.`)
      Analyst._pendingScenario = null
    }
  },
}
