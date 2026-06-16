// queue.js — heartbeat generation, signal dispatch, arrival handling

'use strict'

const Queue = {
  _msgCounter: 0,
  _signalCounter: 0,
  _lastManifestRefreshSec: -Infinity,

  tick(deltaSec) {
    // 1. Generate operational heartbeats
    // Each station initiates a heartbeat to its neighbors independently based on its cadence.
    // No slave/master relationship or replies; heartbeats are purely scheduled.
    {
      const stationIds = Object.keys(Sim.stations)
      for (const sid of stationIds) {
        const station = Sim.stations[sid]
        if (!station.online) continue
        for (const nid of stationIds) {
          if (nid === sid) continue

          const bridge = getBridgeForPair(sid, nid)
          if (!bridge || !bridge.los) continue

          const neighbour = Sim.stations[nid]

          // Initial jitter based on station pair to avoid traffic bursts
          const pairId = sid < nid ? sid + nid : nid + sid
          let hash = 0
          for (let i = 0; i < pairId.length; i++) hash = (hash << 5) - hash + pairId.charCodeAt(i)

          const effectiveCadence = Math.min(station.baseCadenceSeconds, neighbour.baseCadenceSeconds)
          const jitter = Math.abs(hash % effectiveCadence)

          // Schedule the first heartbeat according to the jitter
          const lastSent = station.lastHeartbeatSent[nid] ?? (Sim.simTimeSec + jitter - effectiveCadence)
          if (Sim.simTimeSec - lastSent < effectiveCadence) continue

          if (station.pendingCheckinDests.has(nid)) continue

          Scheduler.enqueue(sid, nid, 'base_check', 3)
          station.pendingCheckinDests.add(nid)
          station.lastHeartbeatSent[nid] = Sim.simTimeSec
        }
      }
    }

    // 2. Advance in-flight visual signals
    for (let i = Sim.signals.length - 1; i >= 0; i--) {
      const sig = Sim.signals[i]

      const sA = Sim.stations[sig.fromId]
      const sB = Sim.stations[sig.toId]
      if (!sA || !sB) {
        Sim.signals.splice(i, 1)
        continue
      }

      const currentDistLY = Vec3.dist(sA.worldPos, sB.worldPos)
      const travelTimeSec = (currentDistLY / sig.speedC) * C.YEAR_IN_SECONDS

      sig.elapsedSec += deltaSec
      const t = travelTimeSec > 0 ? Math.min(1, sig.elapsedSec / travelTimeSec) : 1
      sig.t = t

      sig.fromPos = { ...sA.worldPos }
      sig.toPos = { ...sB.worldPos }

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

  spawnSignalDot(fromStation, toStation, type, speedC) {
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
      speedC: speedC || C.COMM_SIGNAL_SPEED_C,
      elapsedSec: 0,
      t: 0,
      currentPos: { ...fromPos },
    })
  },

  dispatchSignal(fromStation, toStation, type, priority, speedC) {
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
      speedC: speedC || C.COMM_SIGNAL_SPEED_C,
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
      if (msg.type === 'base_check') {
        const fromSt = Sim.stations[msg.sourceId]
        if (fromSt?.pendingCheckinDests)
          fromSt.pendingCheckinDests.delete(msg.destinationId)
      }
    }

    if (sig.type === 'base_check') {
      toStation.lastCheckinByNeighbour[sig.fromId] = Sim.simTimeSec

      const fromName = fromStation.name.replace(' Station', '')
      const toName = toStation.name.replace(' Station', '')
      UI.appendLog(
        'event',
        `Check-in: ${fromName} → ${toName} (${sig.distanceLY.toFixed(2)} LY)`,
      )

      // No replies. Stations heartbeat on their own timers.
    }
  },
}
