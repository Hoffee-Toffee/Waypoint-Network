// simulation.js — state initialisation, tick loop, and data model

'use strict'

// ── State ─────────────────────────────────────────────────────────────────
const Sim = {
  stars: {}, // { id: starObject }
  stations: {}, // { id: stationObject }
  bridges: {}, // { "idA_idB": bridgeObject }

  signals: [], // in-transit comm signals (animated dots)
  messages: [], // recent message history (for manifest panel)
  messageMap: {}, // { msgId: msgObject } — O(1) lookup, kept in sync with messages[]
  adjacency: {}, // { stationId: [neighbourId] } — rebuilt with bridges

  simTimeSec: 0, // current simulation time in seconds
  paused: true,
  tickIntervalId: null,

  // Playback speed in sim-seconds per real-second
  speedMultiplier: 1,
  // Sim-seconds advanced per JS tick (set by UI)
  deltaSec: 1,

  settings: {
    displayDistanceLY: 22,
    kappa: C.KAPPA,
    lambda: C.LAMBDA,
    eta: C.DRIVE_EFFICIENCY,
    droneMassKg: C.DRONE_MASS_KG,
    droneBubbleRadiusM: C.DRONE_BUBBLE_RADIUS_M,
    vesselMassKg: C.VESSEL_MASS_KG,
    vesselBubbleRadiusM: C.VESSEL_BUBBLE_RADIUS_M,
    backgroundSignals: {
      enabled: false,
      ratePerHour: 10,
      typeMix: {
        base_check: 0.5,
        data: 0.3,
        drone_transit: 0.15,
        vessel_transit: 0.05,
      },
      distribution: 'proximity',
    },
  },
}

// ── Initialisation ────────────────────────────────────────────────────────

function initSimulation() {
  // Load star catalogue from inlined data (avoids CORS on file:// protocol)
  const starsArr = STAR_DATA
  Sim.stars = {}
  for (const s of starsArr) Sim.stars[s.id] = s

  // Build stations only for stars within display range
  Sim.stations = {}
  _rebuildActiveStations()

  // Compute initial world positions
  tickUpdatePositions()

  // Build bridge connection list
  Sim.bridges = {}
  rebuildBridgeList()

  // Initialise scheduler window tracking
  Scheduler.init()

  // Optimize orbits for resonance
  optimizeOrbits()

  Renderer.init()
  Renderer.draw()
  UI.init()
}

function _rebuildActiveStations() {
  const limit = Sim.settings.displayDistanceLY
  // Add stations for newly-in-range stars
  for (const star of Object.values(Sim.stars)) {
    const d = star.distLY ?? 0
    if (d <= limit) {
      if (!Sim.stations[star.id + '_station']) {
        Sim.stations[star.id + '_station'] = makeStation(star)
      }
    }
  }
  // Remove stations now out of range
  for (const stId of Object.keys(Sim.stations)) {
    const st = Sim.stations[stId]
    const star = Sim.stars[st.starId]
    if (!star || (star.distLY ?? 0) > limit) {
      delete Sim.stations[stId]
    }
  }
}

// ── Station factory ───────────────────────────────────────────────────────

function makeStation(star) {
  const id = star.id + '_station'
  const periapsisAU = (star.radiusM / C.AU_IN_METRES) + 0.01
  const station = {
    id,
    name: star.name + ' Station',
    starId: star.id,

    // Orbital parameters
    orbitalRadiusAU: periapsisAU, // Initially circular at periapsis
    orbitInclinationDeg: 0,
    orbitLANDeg: 0,
    eccentricity: 0,
    periapsisAU: periapsisAU,

    // Orbital state
    meanAnomalyRad: Math.random() * 2 * Math.PI,

    // Derived orbital values (filled by recomputeDerivedOrbit)
    orbitalPeriodHours: 0,
    orbitalSpeedKmS: 0,
    shadowArcDeg: 0,
    shadowDurationHours: 0,
    uptimeFraction: 0,
    solarFluxWm2: 0,

    // 3D world position and velocity (updated each tick)
    worldPos: { x: 0, y: 0, z: 0 },
    velocityDir: { x: 0, y: 0, z: 0 },

    // Main conduit
    mainConduit: {
      rangeDeg: C.MAIN_CONDUIT_RANGE_DEG,
      slewRateSecPerDeg: C.MAIN_CONDUIT_SLEW_RATE_S_DEG,
      currentAzimuthDeg: 0,
      currentElevationDeg: 0,
      busy: false,
      target: null,
      schedule: [],
    },

    // Comm conduits (mapped by target station ID)
    // Each target gets { incoming: conduitKey, outgoing: conduitKey }
    commConduitMap: {},
    commConduits: [],

    // Energy
    solarCollectorAreaKm2: C.DEFAULT_COLLECTOR_AREA_KM2,
    stellarMaterialWeightFactor: C.DEFAULT_MATERIAL_WEIGHT,
    energyReserveFraction: 1.0,
    reserveFloor: C.DEFAULT_RESERVE_FLOOR,

    // Queues
    inboundQueue: [],
    outboundQueue: new Set(), // Set<msgId> — O(1) add/delete
    manifest: [],

    // Comms
    baseCadenceSeconds: C.DEFAULT_BASE_CADENCE_S,
    lastCheckinByNeighbour: {}, // { stationId: simTimeSec } (arrivals)
    lastHeartbeatSent: {}, // { stationId: simTimeSec } (dispatches)

    // Network
    maxBridgeDistanceLY: C.DEFAULT_MAX_BRIDGE_LY,
    maxBridgeConnections: C.DEFAULT_MAX_BRIDGE_CONNECTIONS,

    // Status
    online: true,
    selected: false,

    // Planned usage for Main conduit (future slots booked via handshake)
    // [ { startSec, endSec, msgId, type, fromId, toId } ]
    reservations: [],
  }

  // outboundQueue as a Set for O(1) add/delete
  station.outboundQueue = new Set()

  // Pending check-in destinations (O(1) dedup in queue.js)
  station.pendingCheckinDests = new Set()

  // Recompute derived orbital values
  Physics.recomputeDerivedOrbit(station, star)

  return station
}

function addCommConduit(station, targetId, type) {
  const id = station.commConduits.length
  const conduit = {
    id,
    targetId,
    type, // 'incoming' | 'outgoing'
    mountAngleDeg: 0,
    xRangeDeg: 360,
    yRangeDeg: 360,
    slewRateSecPerDeg: 0, // Dedicated links are always aligned
    busy: false,
    schedule: [],
  }
  station.commConduits.push(conduit)
  return 'comm' + id
}

// ── Bridge list ───────────────────────────────────────────────────────────

function rebuildBridgeList() {
  Sim.bridges = {}
  const ids = Object.keys(Sim.stations)
  const n = ids.length
  if (n === 0) return

  // ── Pre-compute 3D positions and all pairwise distances once ────────────
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  const pz = new Float64Array(n)
  const idxOf = {} // stationId → array index

  for (let i = 0; i < n; i++) {
    const star = Sim.stars[Sim.stations[ids[i]].starId]
    px[i] = star.x
    py[i] = star.y
    pz[i] = star.z
    idxOf[ids[i]] = i
  }

  // Flat array of 3D distances — O(N²) once, reused everywhere
  const D = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = px[i] - px[j],
        dy = py[i] - py[j],
        dz = pz[i] - pz[j]
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      D[i * n + j] = d
      D[j * n + i] = d
    }
  }

  // ── Phase 1: Kruskal MST over ALL pairs ────────────────────────────────
  // No distance cap here — guarantees every station gets at least one connection.
  // Iterative union-find (path-halving) to avoid call-stack issues at large N.
  const parent = new Int32Array(n)
  const rankU = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i

  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  function union(x, y) {
    const rx = find(x),
      ry = find(y)
    if (rx === ry) return false
    if (rankU[rx] < rankU[ry]) parent[rx] = ry
    else if (rankU[rx] > rankU[ry]) parent[ry] = rx
    else {
      parent[ry] = rx
      rankU[rx]++
    }
    return true
  }

  // Build sorted edge list — only need to touch each pair once
  const allEdges = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      allEdges.push(i * n + j) // pack as single int
    }
  }
  allEdges.sort((a, b) => D[a] - D[b])

  const connCount = new Int32Array(n)
  const inMST = new Uint8Array(n * n) // 1 if this pair is in MST

  for (const packed of allEdges) {
    const i = (packed / n) | 0,
      j = packed % n
    if (union(i, j)) {
      const key = ids[i] + '|' + ids[j]
      Sim.bridges[key] = makeBridge(
        Sim.stations[ids[i]],
        Sim.stations[ids[j]],
        D[packed],
      )
      connCount[i]++
      connCount[j]++
      inMST[packed] = 1
    }
  }

  // ── Phase 2: Add shortcut edges within distance cap ────────────────────
  // Score candidates by current hop count (pre-computed APSP) so no BFS per
  // candidate. Only add edges that reduce the path from > 2 hops to 1 hop.
  // Distance cap and maxBridgeConnections are enforced here.

  // BFS from every node → hop matrix (O(V × (V+E_mst)) ≈ O(V²))
  const adj = Array.from({ length: n }, () => [])
  for (const key of Object.keys(Sim.bridges)) {
    const sep = key.indexOf('|')
    const ai = idxOf[key.slice(0, sep)],
      bi = idxOf[key.slice(sep + 1)]
    if (ai !== undefined && bi !== undefined) {
      adj[ai].push(bi)
      adj[bi].push(ai)
    }
  }

  const HOP = new Uint16Array(n * n).fill(65535)
  for (let s = 0; s < n; s++) {
    HOP[s * n + s] = 0
    const q = [s]
    let qi = 0
    while (qi < q.length) {
      const cur = q[qi++]
      const d1 = HOP[s * n + cur] + 1
      for (const nb of adj[cur]) {
        if (HOP[s * n + nb] === 65535) {
          HOP[s * n + nb] = d1
          q.push(nb)
        }
      }
    }
  }

  // Score and sort candidate extra edges: highest hop count first
  const extras = []
  for (let i = 0; i < n; i++) {
    const maxI = Sim.stations[ids[i]].maxBridgeConnections
    if (connCount[i] >= maxI) continue
    for (let j = i + 1; j < n; j++) {
      if (inMST[i * n + j]) continue
      const maxJ = Sim.stations[ids[j]].maxBridgeConnections
      if (connCount[j] >= maxJ) continue
      const d = D[i * n + j]
      const maxD = Math.min(
        Sim.stations[ids[i]].maxBridgeDistanceLY,
        Sim.stations[ids[j]].maxBridgeDistanceLY,
      )
      if (d > maxD) continue
      const hops = HOP[i * n + j]
      if (hops <= 2) continue // already well-connected — no meaningful shortcut
      extras.push([i, j, d, hops])
    }
  }
  extras.sort((a, b) => b[3] - a[3] || a[2] - b[2]) // most hops first, tiebreak by distance

  for (const [i, j, d] of extras) {
    if (connCount[i] >= Sim.stations[ids[i]].maxBridgeConnections) continue
    if (connCount[j] >= Sim.stations[ids[j]].maxBridgeConnections) continue

    // EFFECTIVE UPTIME FILTER: Ensure window > travel time
    const sA = Sim.stations[ids[i]]
    const sB = Sim.stations[ids[j]]
    const maxWindow = Physics.maxContinuousWindow(sA, sB)
    const travelTime = (d / C.COMM_SIGNAL_SPEED_C) * C.YEAR_IN_SECONDS

    if (maxWindow <= travelTime * 1.1) continue // 10% safety margin

    Sim.bridges[ids[i] + '|' + ids[j]] = makeBridge(sA, sB, d)
    connCount[i]++
    connCount[j]++
  }

  tickUpdateLOS()

  // ── Rebuild adjacency list & Dedicated Conduits ──────────────────────────
  Sim.adjacency = {}
  for (const s of Object.values(Sim.stations)) {
    s.commConduits = []
    s.commConduitMap = {}
  }

  for (const bridge of Object.values(Sim.bridges)) {
    const a = bridge.stationAId,
      b = bridge.stationBId
    if (!Sim.adjacency[a]) Sim.adjacency[a] = []
    if (!Sim.adjacency[b]) Sim.adjacency[b] = []
    Sim.adjacency[a].push(b)
    Sim.adjacency[b].push(a)

    // Assign dedicated conduit pairs
    const stA = Sim.stations[a]
    const stB = Sim.stations[b]
    stA.commConduitMap[b] = {
      outgoing: addCommConduit(stA, b, 'outgoing'),
      incoming: addCommConduit(stA, b, 'incoming')
    }
    stB.commConduitMap[a] = {
      outgoing: addCommConduit(stB, a, 'outgoing'),
      incoming: addCommConduit(stB, a, 'incoming')
    }
  }

  if (Scheduler.reSync) Scheduler.reSync()
}

function makeBridge(sA, sB, lengthLY) {
  // Precompute which stars could ever occlude this bridge.
  // A star can only occlude if it comes within `starRadius` of the segment.
  // Star radii are ~1e-7 LY; we add a margin of 1e-4 LY (> any station orbital radius)
  // for safety.  In practice, only the two host stars qualify.
  const MARGIN_LY = 1e-4
  const occluderStars = Object.values(Sim.stars).filter((star) => {
    const starRadiusLY = star.radiusM / C.LY_IN_METRES
    const threshold = starRadiusLY + MARGIN_LY
    // Point-to-segment distance from star to line sA_star→sB_star (static positions)
    const starA = Sim.stars[sA.starId],
      starB = Sim.stars[sB.starId]
    const ax = starA.x,
      ay = starA.y,
      az = starA.z
    const bx = starB.x,
      by = starB.y,
      bz = starB.z
    const abx = bx - ax,
      aby = by - ay,
      abz = bz - az
    const ab2 = abx * abx + aby * aby + abz * abz
    const apx = star.x - ax,
      apy = star.y - ay,
      apz = star.z - az
    const t =
      ab2 > 0
        ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2))
        : 0
    const dx = star.x - (ax + abx * t),
      dy = star.y - (ay + aby * t),
      dz = star.z - (az + abz * t)
    return Math.sqrt(dx * dx + dy * dy + dz * dz) < threshold
  })

  return {
    id: sA.id + '|' + sB.id,
    stationAId: sA.id,
    stationBId: sB.id,
    lengthLY,
    tunnelRadiusM: 50,
    occluderStars, // only stars that can actually block this bridge
    status: 'inactive',
    conduitTypeA: 'main',
    conduitTypeB: 'main',
    alignmentStartTime: null,
    activeSince: null,
    scheduledUntil: null,
    activePayload: null,
    queuedPayloads: [],
    los: false,
    everConnected: false,
    acquisitionStatus: null,
  }
}

// ── Tick loop ─────────────────────────────────────────────────────────────

function startTick() {
  if (Sim.tickIntervalId !== null) return
  function frame() {
    tickFrame()
    Sim.tickIntervalId = requestAnimationFrame(frame)
  }
  Sim.tickIntervalId = requestAnimationFrame(frame)
}

function stopTick() {
  if (Sim.tickIntervalId !== null) {
    cancelAnimationFrame(Sim.tickIntervalId)
    Sim.tickIntervalId = null
  }
}

function tickFrame() {
  if (Sim.paused) {
    Renderer.draw()
    return
  }

  const deltaSec = Sim.deltaSec * Sim.speedMultiplier

  // 1. Advance orbital phases
  for (const station of Object.values(Sim.stations)) {
    const periodSec = station.orbitalPeriodHours * C.HOURS_TO_SECONDS
    station.meanAnomalyRad += ((2 * Math.PI) / periodSec) * deltaSec
    station.meanAnomalyRad %= 2 * Math.PI
  }

  // 2. Recompute 3D world positions
  tickUpdatePositions()

  // 3. Recompute LOS for all bridge pairs
  tickUpdateLOS()

  // 4. Run queue tick (check-ins, signal movement)
  Queue.tick(deltaSec)

  // 5. Run scheduler tick (window allocation, slewing, bridge activation)
  Scheduler.tick(deltaSec)

  // 6. Run background signal generator
  BgGen.tick(deltaSec)

  // 7. Advance simulation time
  Sim.simTimeSec += deltaSec

  // 8. Refresh manifest panel (throttled — every ~0.5s real time)
  UI.maybeRefreshManifest()

  // 9. Refresh inspector live fields if a station is selected
  if (UI._inspectorStation) UI.refreshInspectorLive()

  // 10. Render
  Renderer.draw()
}

function tickUpdatePositions() {
  for (const station of Object.values(Sim.stations)) {
    const star = Sim.stars[station.starId]
    station.worldPos = Physics.stationWorldPos(station, star)
    station.velocityDir = Physics.stationVelocityDir(station, star)
  }
}

function tickUpdateLOS() {
  for (const bridge of Object.values(Sim.bridges)) {
    const sA = Sim.stations[bridge.stationAId]
    const sB = Sim.stations[bridge.stationBId]
    const prevLos = bridge.los
    const los = Physics.hasLOS(sA, sB, bridge.occluderStars)
    bridge.los = los
    if (!los && bridge.status === 'active') {
      bridge.status = 'occluded'
    } else if (los && bridge.status === 'occluded') {
      bridge.status = 'inactive'
    }
    // GAP 2: removed -Infinity reset to avoid traffic bursts when LOS returns
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Helper: find a bridge regardless of which station is A vs B in the key */
function getBridgeForPair(idA, idB) {
  return Sim.bridges[idA + '|' + idB] || Sim.bridges[idB + '|' + idA] || null
}

function optimizeOrbits() {
  const stations = Object.values(Sim.stations)
  if (stations.length < 2) return

  // 1. Identify "Priority Neighbor" for each station.
  // We use the closest neighbor (from the MST).
  const priorityNeighbor = {}
  for (const bridge of Object.values(Sim.bridges)) {
    const sA = bridge.stationAId
    const sB = bridge.stationBId
    if (!priorityNeighbor[sA] || bridge.lengthLY < priorityNeighbor[sA].dist) {
      priorityNeighbor[sA] = { id: sB, dist: bridge.lengthLY }
    }
    if (!priorityNeighbor[sB] || bridge.lengthLY < priorityNeighbor[sB].dist) {
      priorityNeighbor[sB] = { id: sA, dist: bridge.lengthLY }
    }
  }

  const ratios = [
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 3],
    [3, 2],
    [3, 5],
    [5, 3],
    [1, 3],
    [3, 1],
  ]

  // 2. Perform relaxation to align periods to rational ratios.
  // We'll do a few passes.
  for (let pass = 0; pass < 3; pass++) {
    for (const station of stations) {
      const pnInfo = priorityNeighbor[station.id]
      if (!pnInfo) continue
      const neighbor = Sim.stations[pnInfo.id]
      if (!neighbor) continue

      const targetPeriod = neighbor.orbitalPeriodHours
      // Find the best ratio p/q such that p*T_station ≈ q*T_target
      let bestRatio = [1, 1]
      let bestDiff = Infinity

      for (const [p, q] of ratios) {
        const candidateT = (q / p) * targetPeriod
        // Convert back to semi-major axis to check if it's physically possible (periapsis)
        const star = Sim.stars[station.starId]
        const GM = C.GM_SOL * (star.massKg / 1.989e30)
        const candidateA_m = Math.pow(((candidateT * 3600) / (2 * Math.PI)) ** 2 * GM, 1 / 3)
        const candidateA_AU = candidateA_m / C.AU_IN_METRES

        if (candidateA_AU >= station.periapsisAU) {
          const diff = Math.abs(candidateT - station.orbitalPeriodHours)
          if (diff < bestDiff) {
            bestDiff = diff
            bestRatio = [p, q]
          }
        }
      }

      // Adjust semi-major axis to achieve the target ratio
      const finalT = (bestRatio[1] / bestRatio[0]) * targetPeriod
      const star = Sim.stars[station.starId]
      const GM = C.GM_SOL * (star.massKg / 1.989e30)
      const finalA_m = Math.pow(((finalT * 3600) / (2 * Math.PI)) ** 2 * GM, 1 / 3)
      station.orbitalRadiusAU = finalA_m / C.AU_IN_METRES
      station.eccentricity = 1 - (station.periapsisAU / station.orbitalRadiusAU)

      Physics.recomputeDerivedOrbit(station, star)
    }
  }
  UI.appendLog('info', 'Orbital resonances optimized.')
}
