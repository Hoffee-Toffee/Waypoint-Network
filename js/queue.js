// queue.js — check-in generation, signal dispatch, arrival handling

'use strict'

const Queue = {
  _msgCounter: 0,
  _signalCounter: 0,
  _lastManifestRefreshSec: -Infinity,

  tick(deltaSec) {
    // 1. Generate operational check-ins — always run, regardless of background
    //    signal setting.  Check-ins are a fundamental station behaviour, not
    //    optional test traffic.  The background signal flag only controls
    //    the random BgGen traffic generated below.
    {
      const { ratePerHour, typeMix } = Sim.settings.backgroundSignals
      const checkInFraction = Math.max(0.01, typeMix.base_check ?? 0.5)
      const rateBasedCadence =
        ratePerHour > 0 ? 3600 / (ratePerHour * checkInFraction) : Infinity

      const stationIds = Object.keys(Sim.stations)
      for (const sid of stationIds) {
        const station = Sim.stations[sid]
        if (!station.online) continue
        for (const nid of stationIds) {
          if (nid === sid) continue

          const bridge = getBridgeForPair(sid, nid)
          if (!bridge || !bridge.los) continue

          const neighbour = Sim.stations[nid]
          const stationCadence = Math.min(
            station.baseCadenceSeconds,
            neighbour.baseCadenceSeconds,
          )
          const effectiveCadence = Math.max(rateBasedCadence, stationCadence)

          const lastCheckin = station.lastCheckinByNeighbour[nid] ?? -Infinity
          if (Sim.simTimeSec - lastCheckin < effectiveCadence) continue

          if (station.pendingCheckinDests?.has(nid)) continue

          Scheduler.enqueue(sid, nid, 'base_check', 3)
          station.pendingCheckinDests?.add(nid)
          station.lastCheckinByNeighbour[nid] = Sim.simTimeSec
        }
      }
    }

    // 2. Advance in-flight visual signals
    for (let i = Sim.signals.length - 1; i >= 0; i--) {
      const sig = Sim.signals[i]
      // Travel time in sim-seconds: distance(LY) / speed(c) * seconds_per_year
      const travelTimeSec = (sig.distanceLY / sig.speedC) * C.YEAR_IN_SECONDS
      sig.elapsedSec += deltaSec
      const t =
        travelTimeSec > 0 ? Math.min(1, sig.elapsedSec / travelTimeSec) : 1
      sig.t = t
      sig.currentPos = {
        x: sig.fromPos.x + (sig.toPos.x - sig.fromPos.x) * t,
        y: sig.fromPos.y + (sig.toPos.y - sig.fromPos.y) * t,
        z: sig.fromPos.z + (sig.toPos.z - sig.fromPos.z) * t,
      }
      if (t >= 1) {
        Queue.onSignalArrived(sig)
        Sim.signals.splice(i, 1)
      }
    }
  },

  // Spawn only the visual travelling dot (message already exists in Sim.messages)
  spawnSignalDot(fromStation, toStation, type) {
    const fromPos = { ...fromStation.worldPos }
    const toPos = { ...toStation.worldPos }
    Sim.signals.push({
      id: 'sig_' + ++Queue._signalCounter,
      messageId: null, // visual only
      type,
      fromId: fromStation.id,
      toId: toStation.id,
      fromPos,
      toPos,
      distanceLY: Vec3.dist(fromPos, toPos),
      speedC: C.COMM_SIGNAL_SPEED_C,
      elapsedSec: 0,
      t: 0,
      currentPos: { ...fromPos },
    })
  },

  dispatchSignal(fromStation, toStation, type, priority) {
    const id = 'msg_' + ++Queue._msgCounter
    const fromPos = { ...fromStation.worldPos }
    const toPos = { ...toStation.worldPos }
    const distanceLY = Vec3.dist(fromPos, toPos)

    const msg = {
      id,
      type,
      priority,
      sourceId: fromStation.id,
      destinationId: toStation.id,
      status: 'in_transit',
      createdAt: Sim.simTimeSec,
      arrivedAt: null,
    }
    Sim.messages.push(msg)
    Sim.messageMap[id] = msg
    if (Sim.messages.length > C.MAX_MESSAGES) {
      const evicted = Sim.messages.splice(0, 1)[0]
      delete Sim.messageMap[evicted.id]
    }

    Sim.signals.push({
      id: 'sig_' + ++Queue._signalCounter,
      messageId: id,
      type,
      fromId: fromStation.id,
      toId: toStation.id,
      fromPos,
      toPos,
      distanceLY,
      speedC: C.COMM_SIGNAL_SPEED_C,
      elapsedSec: 0,
      t: 0,
      currentPos: { ...fromPos },
    })
  },

  onSignalArrived(sig) {
    const fromStation = Sim.stations[sig.fromId]
    const toStation = Sim.stations[sig.toId]
    const msg = Sim.messageMap[sig.messageId]
    if (msg) {
      msg.status = 'delivered'
      msg.arrivedAt = Sim.simTimeSec
      // Clear the pending check-in flag so the next one can be scheduled
      if (msg.type === 'base_check') {
        const fromSt = Sim.stations[msg.sourceId]
        if (fromSt?.pendingCheckinDests)
          fromSt.pendingCheckinDests.delete(msg.destinationId)
      }
    }

    if (sig.type === 'base_check') {
      // Receiving station records that it heard from the sender
      toStation.lastCheckinByNeighbour[sig.fromId] = Sim.simTimeSec

      const fromName = fromStation.name.replace(' Station', '')
      const toName = toStation.name.replace(' Station', '')
      UI.appendLog(
        'event',
        `Check-in: ${fromName} → ${toName} (${sig.distanceLY.toFixed(2)} LY)`,
      )
    }
  },
}

// Helper: find a bridge regardless of which station is A vs B in the key
function getBridgeForPair(idA, idB) {
  return Sim.bridges[idA + '|' + idB] || Sim.bridges[idB + '|' + idA] || null
}
