# FTL Network Simulation — Design Plan
### Visualization Tool & Scheduler Specification

---

## Part A: Framework Critique & Revisions

These are issues raised in notes.md that require changes to `ftl_navigation_framework.md` before or during implementation.

---

### A.1 Bridge Mechanics — Remove Matter Reconstruction (§2.2)

**Issue:** The current text reads *"the drone is imprinted with a metric signature at Station A and deconstructed/reconstructed at Station B."* You correctly identified this as matter teleportation. If arbitrary objects can be deconstructed and reconstructed, there is no in-universe reason this could not be applied to biology, nano-assembly, or memory-copying — which presumably you don't want.

**Proposed replacement framing:**
> The bridge is a maintained metric tunnel — a region of folded spacetime where the path length between the two endpoints has been reduced to near-zero. Nothing is deconstructed. The drone physically travels through the interior of the bridge, experiencing negligible transit time from its own reference frame. The "metric signature" is simply an authorisation token embedded in the bridge's coherence field; it determines what the bridge *admits*, not what it *reconstructs*. A large enough object simply does not fit; an unauthorised one experiences decoherence forces at the aperture. The analogy is a physical door with a keyhole, not a fax machine.

**Consequence for the energy equation (§4.6):** The loading term `ζ × Ṁ / Ṁ_rated` is retained — mass passing through the tunnel displaces the metric and requires additional power to maintain coherence. This is physically equivalent regardless of whether there is reconstruction. No other equations change.

---

### A.2 Bridge Establishment — Missing Section

**Issue:** Nothing in the framework describes how a bridge is *established* — only how it operates once active. Notes raise two questions: (a) what is the start-up sequence, and (b) is the activation simultaneous or sequential?

**Proposed model — FTL Simultaneous Handshake:**

The metric influence that forms the bridge is itself FTL — it is a manipulation of spacetime geometry, not a light-speed signal. Practically, this means a bridge can be opened and closed on timescales of seconds to minutes, not years. The main conduit is therefore fully viable as a dynamic, re-pointable device that establishes fresh bridges on demand. The sequence is:

1. **Pre-computation:** Both stations compute the precise moment when their conduit axes will be within alignment tolerance. Orbital mechanics is deterministic; this is known far in advance.
2. **Conduit slew begins:** Each station begins rotating its conduit toward the target bearing `t_slew` ahead of the alignment window (see §A.3 for rates).
3. **Simultaneous activation:** At `t_open`, both stations power up their metric fields. Because the influence is FTL, both fields effectively couple instantaneously. For *already-established* bridges (used at least once), there is a small warm-up delay (seconds) while the fields re-lock. For a *brand-new* first-ever connection between two stations, a brief acquisition phase is required (see §A.7 for the new station bootstrap procedure), but this is measured in minutes or hours, not years.
4. **Payload launch:** The payload enters at Station A once both fields are confirmed coupled. The coupling confirmation signal travels through the newly-formed bridge itself (sub-second).
5. **Transit:** Near-instantaneous from payload perspective; bounded only by signal propagation within the station (~milliseconds).
6. **Shutdown:** Station A powers down its field once the payload clears its aperture. Station B powers down once the payload exits its aperture. Neither needs to maintain the field after the payload has passed — the metric tunnel collapses behind it.

**Consequence:** The main conduit can freely open new bridges or close and repoint to a different target within its slew time. The only significant delay in establishing any bridge is the conduit rotation cost, not a propagation delay. This makes the main conduit a flexible scheduling resource and not a fixed, dedicated connection.

---

### A.3 Conduit Orientation — Missing Section (New §2.x)

**Issue:** Notes specify orientation constraints not currently in the framework.

**Conduit types and parameters:**

| Conduit | Purpose | Slew rate | Range (arc) | Location on station | Count |
|---|---|---|---|---|---|
| **Main conduit** | Vessels, cargo drones, bulk transfer | 15 s/degree | 180° (semi-sphere) | Central axis | 1 |
| **Comm conduit** | Coordination signals, data-only drones, small packets | 0.25 s/degree | 180° (outer half-space only) | Outer ring, evenly spaced | Configurable (default 3) |

**Main conduit geometry:** The 180° semi-sphere always faces directly away from the host star (anti-stellar direction), fixed to the station body. The excluded hemisphere — the sunward half — is the permanent safe parking zone where vessels and drones queue for transit without intersecting the active beam. As the station orbits, the anti-stellar arc sweeps through all outward directions, so the set of reachable targets changes continuously. The scheduler pre-computes, for every planned main-conduit window, the exact time at which the target will leave the 180° anti-stellar arc (or enter the shadow arc), and uses that as a hard deadline. If the required window duration exceeds the time remaining before that deadline, the transit is deferred to the next orbit when alignment returns.

**Comm conduit geometry:** Each unit is a biaxial gimbal mounted at a fixed position on the outer rim of the station disc. The disc lies in the plane perpendicular to the main conduit axis (the anti-stellar direction). The mount positions are evenly distributed around the disc equator at `360° / count` spacing.

Two independent rotation axes define the reachable zone:

**X-axis** — rotation within the station's equatorial plane (the plane shared by all comm units, perpendicular to the main conduit axis):
- Range: **180°** (±90° from the unit's outward radial direction)
- Hard limit: the station disc itself blocks everything past ±90°; the emitter would point back through the station body

**Y-axis** — tilt in the meridional plane (the plane containing this specific unit, the station centre, and the main conduit axis):
- Range: **240°** (±120° from the station's equatorial plane)
- **+120° toward the anti-stellar direction:** the unit tilts past the equator toward the main conduit axis. It clears the conduit because the unit is on the rim (offset from the axis), and the main conduit points from the centre — there is enough radial clearance at this angle.
- **-120° toward the star:** the unit tilts toward the star. This range is partially obstructed by the star itself for targets along that direction (~17.84° wide at 0.03 AU from Sol).
- The blocked 120° is the inward direction — tilting back toward the station body and past it.

In 3D, the combined reachable zone is a **spherical rectangle**: 180° wide in the X-axis sweep, 240° tall in the Y-axis tilt. It is not a cone or hemisphere. The coverage for a 3-unit array (120° mount spacing) with these ranges is near-complete: the only unserved zones are the narrow cylinders exactly along the main conduit axis (where all units' X-range edges meet), and those are inaccessible to any fixed-mount unit by geometry.

The simulation checks reachability of a target direction `d` (unit vector in station-local coords) against a comm unit as follows:
```js
function isInCommUnitRange(unit, targetDirStation) {
  // Convert target direction to unit-local coords
  // (rotate by mount angle around main-conduit axis)
  const local = rotateAroundConduitAxis(targetDirStation, -unit.mountAngleDeg);

  // local.x = component in equatorial plane (X-axis rotation)
  // local.y = component along main-conduit axis (Y-axis tilt)
  // local.z = outward radial component (should be positive to be in front)

  if (local.z < 0) return false;  // behind the unit (inside the station)

  const xAngle = Math.atan2(local.x, local.z) * RAD_TO_DEG;  // equatorial sweep angle
  const yAngle = Math.atan2(local.y, local.z) * RAD_TO_DEG;  // meridional tilt angle

  return Math.abs(xAngle) <= unit.xRangeDeg / 2
      && yAngle >= -unit.yRangeDeg * (120/240)   // -120° toward star
      && yAngle <=  unit.yRangeDeg * (120/240);  // +120° toward conduit
}
```

**Slew scheduling constraint:** The main conduit cannot skip between two targets instantaneously. If it last served Station A at bearing 45° and needs to serve Station B at bearing 170°, it must slew 125° × 15 s/° = 31.25 minutes before it can open the next bridge. This is a hard constraint in the scheduler. Comm conduits are faster (125° × 0.25 s/° ≈ 31 seconds), making them far more agile.

---

### A.4 Bridge Priority for Established Connections (§2.3 addition)

**Issue:** Notes state stations should prefer re-using an already-established bridge over creating a new one, due to repositioning time and propagation energy. This should be explicit in the routing algorithm.

**Proposed rule:** Add a penalty weight `w_reorient(θ)` to each edge in the routing graph:
```
w_edge = w_shadow_wait + w_reorient + w_transit
w_reorient = |θ_current - θ_target| × slew_rate_seconds
```
An already-active bridge has `w_reorient = 0`. An idle but aligned bridge has a small restart cost. A bridge requiring full slew has the maximum reorient penalty. This naturally biases the scheduler toward extending existing connections.

---

### A.5 Stellar Material Usage Weighting (New §5.4)

**Issue:** Notes raise the possibility of weighting routing toward outer stations to protect Sol's stellar material. Whether stellar extraction rates are astronomically significant is left open; the weighting should still exist as a policy lever.

**Proposed model:** Add a per-station `material_weight` factor (0 to 1, default 1.0) to the energy cost of using that station's resources. Sol Station is set to a lower weight (e.g., 0.5) to make the routing algorithm prefer using outer stations when paths are otherwise similar. This is not a hard constraint but a soft preference baked into edge weights:
```
w_energy(station) = base_energy × (2.0 - station.material_weight)
```
A station with `material_weight = 0.5` costs 1.5× in the energy dimension. The routing algorithm already balances speed vs. energy; this just tilts the balance.

**Floor on reserves:** Each station also maintains a hard `reserve_floor` (e.g., 20% of total capacity) below which it refuses to open new bridges or extend existing ones. This is already implicit in §5.3 but should be made explicit as a station-level parameter.

---

### A.6 Communication Cadence (New §2.6)

**Issue:** Notes describe a variable-cadence check-in system. There is no separate idle heartbeat — the standard check-in serves this purpose at whatever cadence is configured for the pairing.

**Proposed model:**

| Mode | Cadence | Trigger | Payload |
|---|---|---|---|
| **Standard check-in** | Per-pairing configurable (10 s – 5 min) | Scheduled by target cadence | UST timestamp, queue depth, reserve level, local disturbances, new flight plans, manifest delta |
| **Extended session** | Continuous | Either station sends "extend" signal | Full manifest, ship positions, multi-hop negotiations |
| **P1 escalation** | Uses next available check-in window | Station has undelivered P1 item | Highest-priority data prepended to session queue |

**Per-pairing cadence:** Each station has a `baseCadenceSeconds` property representing how often it wants to check in with its neighbours (10 s to 5 min, configurable). The cadence used for any given pairing is `min(A.baseCadenceSeconds, B.baseCadenceSeconds)` — the more active station sets the pace, and both sides honour it. A station is never asked to check in *less* often than it wants to. High-traffic stations (e.g., Sol) use short cadences (10–30 s); remote, low-population stations use longer ones (1–5 min). The average response delay for an unsolicited event is half the effective cadence (e.g., effective 10 s cadence → 5 s average delay).

**Emergency handling:** There is no instantaneous emergency signal — a bridge cannot be opened without coordination from both sides. P1 items instead prepend to the next scheduled session queue and are transmitted at the earliest window. For very high-priority events at stations with short cadences, the effective delay is acceptable (5–15 s typical).

**Missed-window policy:** If a scheduled comm window is missed (station in shadow, conduit busy), the session is re-attempted at the next available window immediately upon re-acquisition — not deferred to the next scheduled cadence slot.

**End-of-session protocol:** Rather than a fixed window, the initiating station sends an "end" token when its outgoing queue is empty. The receiving station confirms, then both are free to reorient. A new high-priority item arriving during a session is injected before the "end" token is sent.

**Relay coordination:** For A→B→C multi-hop coordination, B includes the C-leg schedule in its check-in response to A. A plans its payload arrival at B to align with B's next available C window. B absorbs small timing jitter by queuing the payload briefly.

---

### A.7 Station Construction (§6.1 update)

**Issue:** Notes describe a specific construction model not currently in the framework.

**Proposed addition:** The establishment fleet includes one **platform vessel** — a purpose-built ship whose structural components are designed to be detached and incorporated into the station. The vessel arrives, achieves a parking orbit, and begins disassembly/integration. The drive system may be repurposed as the station's emergency thruster reserve. Once a minimal core is operational (solar collection, one comm conduit, one bridge), the station joins the network and can receive materials and components via bridge, dramatically accelerating completion. The platform vessel's hull becomes part of the station superstructure; it never leaves.

---

## Part B: Simulation Tool Design

---

### B.1 Technology Stack

**Recommendation: Self-contained HTML5 + JavaScript, 3D physics with 2D galactic-plane projection**

- All physics (orbital mechanics, LOS, conduit range) computed in 3D using `{x, y, z}` vectors in light-year units
- The display is a top-down orthographic projection onto the galactic plane (Z axis discarded for screen coords)
- Stations in inclined orbits appear closer to their star in the 2D view but are computed correctly in 3D — the orbital ring draws as an ellipse to hint at inclination
- Runs in any browser, no installation, no server (HTML5 Canvas + standard DOM)
- No build step required — a single folder that opens with `index.html`
- Simulation state is plain JS objects; easily serialised to JSON for save/load

---

### B.2 File Structure

```
ftl-sim/
├── index.html              ← entry point; all UI layout
├── css/
│   └── style.css           ← dark-space theme, panel layout
├── js/
│   ├── constants.js        ← default parameter values, star catalogue data
│   ├── physics.js          ← orbital mechanics, LOS, shadow windows, slew times
│   ├── simulation.js       ← simulation state, tick loop, time advancement
│   ├── routing.js          ← time-varying Dijkstra, path cost functions
│   ├── queue.js            ← message queues, scheduling, session protocols
│   ├── renderer.js         ← canvas drawing: stars, rings, arcs, lines, drones
│   └── ui.js               ← control panel bindings, inspector panel, manifest panel
└── data/
    └── stars.json          ← real nearby star catalogue (position, radius, mass, type)
```

---

### B.3 Data Model

#### Star
```js
{
  id: "sol",
  name: "Sol",
  x: 0.0,              // galactic frame X, light-years
  y: 0.0,              // galactic frame Y, light-years
  z: 0.0,              // galactic frame Z, light-years (height above/below galactic plane)
  radiusM: 6.957e8,    // metres
  massKg: 1.989e30,
  spectralType: "G2V",
  luminositySol: 1.0   // solar luminosities, for flux scaling
}
```

#### Station
```js
{
  id: "sol_station",
  name: "Sol Station",
  starId: "sol",

  // Orbital parameters (user-tweakable; all derived values recomputed on change)
  orbitalRadiusAU: 0.03,
  // Orbital plane orientation (Keplerian elements, simplified)
  orbitInclinationDeg: 0,       // tilt of orbital plane relative to galactic plane (0 = coplanar)
  orbitLANDeg: 0,               // longitude of ascending node (rotation of the tilt axis, degrees)
  // Derived (read-only display):
  orbitalRadiusM: 4.488e9,
  orbitalPeriodHours: 45.5,
  orbitalSpeedKmS: 172,
  shadowArcDeg: 17.84,
  shadowDurationHours: 2.26,
  uptimeFraction: 0.950,

  // Orbital state
  phaseRad: 0.0,  // current angle in orbit (radians, measured in orbital plane)
  // Derived 3D world position (recomputed each tick from phaseRad + inclination):
  // worldPos: { x, y, z }  — light-years in galactic frame

  // Main conduit
  mainConduit: {
    rangeDeg: 180,         // half-angle of the anti-stellar hemisphere (180° = full hemisphere)
    // Current pointing in station-local spherical coords:
    currentAzimuthDeg: 0,  // rotation around the anti-stellar axis (0 = "up" out of orbital plane)
    currentElevationDeg: 0,// elevation from the station's equatorial plane (+90 = anti-stellar pole)
    slewRateSecPerDeg: 15,
    busy: false,
    target: null,            // { stationId, scheduledStart, scheduledEnd }
    schedule: []             // [ { stationId, windowStart, windowEnd, payloads[] } ]
  },

  // Comm conduits — biaxial gimbal, evenly distributed around the station rim
  commConduitCount: 3,
  commConduits: [  // auto-generated; spacing = 360° / count around the station equator
    {
      id: 0,
      // Mount position: angle around station equator (evenly spaced, degrees)
      // 0° = in the orbital plane, "ahead" of the station in its orbit
      mountAngleDeg: 0,

      // Rotation limits (biaxial gimbal — two independent axes):
      // X-axis: sweeps in the plane of all comm units (station equatorial plane, ⊥ to main conduit)
      xRangeDeg: 180,   // ±90° from the unit's outward radial; hard limit = station body
      // Y-axis: tilts in the meridional plane (the plane containing this unit, station centre,
      //         and the main conduit axis)
      yRangeDeg: 240,   // ±120° from the equatorial plane:
                        //   +120° toward the anti-stellar/main-conduit direction (clears the conduit
                        //          because the unit is on the rim, not the axis)
                        //   -120° toward the star (partially occluded by star in this range)

      // Current pointing in unit-local coords:
      currentXDeg: 0,   // rotation around X-axis
      currentYDeg: 0,   // tilt around Y-axis
      slewRateSecPerDeg: 0.25,

      // Physical package capability (optional; strict size/mass limits)
      tunnelRadiusM: 0.15,
      maxPackageMassKg: 2.0,

      busy: false,
      target: null,
      schedule: []
    }
    // ... count - 1 more
  ],

  // Energy
  solarCollectorAreaKm2: 1000,
  stellarMaterialWeightFactor: 1.0,  // 0–1; lower = prefer outer stations
  energyReserveFraction: 1.0,        // current fill level 0–1
  reserveFloor: 0.20,                // fraction below which bridges are refused

  // Queues
  inboundQueue: [],    // items arriving or already received awaiting processing
  outboundQueue: [],   // items waiting to depart, sorted by priority then scheduledTime
  manifest: [],        // summary view of all pending items

  // Per-station base cadence; effective pairing cadence = min(this, neighbour.baseCadenceSeconds)
  baseCadenceSeconds: 30,  // configurable per station (10 s to 300 s)
  // Derived at runtime (read-only); keyed by neighbour stationId
  // effectiveCadences: { "proxima_station": 10, "barnard_station": 30 }


  // Network constraints
  maxBridgeDistanceLY: 10,  // configurable; bridges beyond this require relay hops

  // Status
  online: true,
  lastCheckinByNeighbour: {}  // { neighbourId: simTimeSeconds } of last confirmed check-in
}
```

#### Message / Queue Item
```js
{
  id: "msg_001",
  type: "base_check" | "manifest" | "ship_route" | "data" | "vessel_transit"
       | "drone_transit" | "priority_data" | "emergency",

  priority: 1 | 2 | 3 | 4 | 5,   // P1=Emergency … P5=Background

  sourceId: "sol_station",         // originating station (or vessel id)
  destinationId: "proxima_station",
  // Path starts null; resolved by the FIRST receiving station using its routing table.
  // The source (vessel or originating station) supplies only priority + source + destination.
  path: null,  // filled in by first station: ["sol_station", "barnard_station", "wolf359_station"]

  conduitType: "main" | "comm",    // which conduit type this item requires

  payload: {
    // type-specific; see §B.6 for each message type's payload schema
  },

  status: "queued" | "awaiting_alignment" | "slewing" | "in_session"
        | "in_transit" | "relaying" | "delivered" | "failed",

  createdAt: 0,          // simulation time (hours)
  scheduledDeparture: null,
  actualDeparture: null,
  estimatedArrival: null,
  actualArrival: null,

  // For multi-hop: each hop recorded
  hopLog: [
    { stationId, arrivedAt, departedAt }
  ]
}
```

#### Drone (in-transit object)
```js
{
  id: "drone_042",
  type: "comm" | "cargo" | "survey" | "vessel_escort",
  massKg: 50,
  bubbleRadiusM: 1.5,
  carryingMessageId: "msg_001",

  fromStationId: "sol_station",
  toStationId: "proxima_station",
  // OR for free-space travel:
  fromPosition: { x, y, z },  // LY, galactic frame
  toPosition: { x, y, z },

  speedC: 3000,             // multiples of c (computed from physics)
  departedAt: 0,
  estimatedArrivalAt: 0.0003,  // hours (very fast for nearby stars)

  // Rendering (projected to galactic plane for display)
  currentPosition: { x, y, z },
  trailPositions: []         // last N positions for motion trail
}
```

#### Bridge (active connection state)
```js
{
  id: "bridge_sol_proxima",
  stationAId: "sol_station",
  stationBId: "proxima_station",

  lengthLY: 4.24,
  tunnelRadiusM: 50,    // maximum object radius that fits

  status: "inactive" | "aligning" | "active" | "occluded",
  conduitTypeA: "main",   // which conduit on station A is serving this bridge
  conduitTypeB: "main",

  alignmentStartTime: null,
  activeSince: null,
  scheduledUntil: null,

  activePayload: null,      // current item in transit (only one at a time)
  queuedPayloads: [],       // items waiting for this specific bridge session

  // Acquisition state for brand-new (never connected) bridges
  everConnected: false,   // false until first successful handshake completes
  acquisitionStatus: null // null | "scanning" | "acquired" — used during new station bootstrap
}
```

---

### B.4 Rendering Specification

The canvas is divided into two areas: **map view** (left, ~70%) and **info panel** (right, ~30%).

#### Map View

Draw order (back to front):

1. **Background** — solid black (`#000000`)
2. **Inactive bridge lines** — white, 0.25 opacity, between all station pairs that have a recorded bridge but are currently not active or occluded
3. **Active bridge lines** — white, 0.75 opacity, between stations with a currently-active bridge
4. **Planned path lines** — blue (`#4488ff`), 0.8 opacity, for items currently scheduled/in-transit, drawn as animated dashed lines
5. **Orbital rings** — per star: draw an ellipse whose aspect ratio reflects the orbital inclination (a perfectly edge-on orbit would appear as a line; 0° inclination = circle). The projected semi-minor axis = `orbitalRadius × cos(inclinationDeg)`. Ring colour: grey (`#404040`)
6. **Visibility arcs** — drawn *on* the ring as coloured segments:
   - **Green** (`#44ff44`, 0.7 opacity): the portion of the ring arc that is not occluded by the host star
   - **Red** (`#ff4444`, 0.7 opacity): the shadow arc (occluded by host star)
   - Arc extents are computed from `shadowArcDeg` centred on the point directly behind the star as seen from the station's current position
7. **Stars** — yellow filled circles (`#ffee44`), radius scaled logarithmically to stellar radius (min 4px, max 14px for UI clarity). Star name label below.
8. **Station dot** — white filled circle (4px), positioned at the station's current `phaseRad` on its ring. Station name label, offset to avoid star label.
9. **Active conduit beams** — when a conduit is actively aligned, draw a thin coloured line from the station dot toward the target bearing, fading out (not to the other station — this makes the beam visible without duplicating the bridge line):
   - Main conduit: yellow-orange (`#ffaa00`)
   - Comm conduit: cyan (`#00ccff`)
10. **In-transit drones/vessels** — small coloured dots moving along their path:
    - Comm drone: cyan dot, 2px
    - Cargo drone: white dot, 3px
    - Vessel: white dot with ring, 4px outer
    - Motion trail: 5 previous positions at decreasing opacity
11. **Selection highlight** — when a station is selected, draw a white ring around it and highlight all its active/scheduled connections in brighter colours.

#### Info Panel (right side)

Divided into vertical sections:

- **Selected Station** (top, ~35%) — name, star, orbital parameters table, energy bar, conduit status indicators (free / slewing / busy), online indicator
- **Manifest** (middle, ~35%) — scrollable list of queue items; columns: Priority | Type | From→To | Status | ETA; clicking an item highlights its path on the map
- **Log** (bottom, ~30%) — scrolling event log: bridge activations, deliveries, heartbeat failures, scheduling conflicts

---

### B.5 Controls Layout

#### Top Bar
- **Sim Time** display: `UST: YYYY.DDD HH:MM:SS`
- **Time step** selector: `1s / 1min / 1hr / 1day` per tick
- **Speed** multiplier: `1× / 10× / 100× / 1000× / MAX`
- **Play / Pause / Step** buttons
- **Reset** button

#### Left Sidebar — Global Physics
```
═══ FTL Physics ════════════════
Drive constant κ:         [input]
Bridge constant λ:        [input]
Drive efficiency η:       [slider 0.5–1.0]

═══ Drone Defaults ═════════════
Mass (kg):                [input]
Bubble radius (m):        [input]

═══ Vessel Defaults ════════════
Mass (kg):                [input]
Bubble radius (m):        [input]

═══ Background Signals ═════════
Enable:                   [toggle]
Rate (msgs/hr):           [slider]
Type mix:                 [% base_check | % data | % drone_transit]
Destination distribution: [uniform | weighted by proximity]
```

#### Right Sidebar — Station Inspector (appears on station click)
```
═══ [Station Name] ═════════════
Star: [name]  Type: [spectral]

Orbital Distance (AU):    [slider + number input]
  → Period:     XX.X hours (derived)
  → Speed:      XXX km/s  (derived)
  → Shadow:     X.XX hours/orbit (derived)
  → Uptime:     XX.X% (derived)

═══ Main Conduit ════════════════
Range (arc degrees):      [slider 90–360]
Slew rate (s/deg):        [input]
Current bearing:          [display only]
Status:                   [display]

═══ Comm Conduits ═══════════════
Count:                    [1–8 spinner]
Arc per unit (degrees):   [slider 90–360]
Slew rate (s/deg):        [input]
[Conduit 1: bearing XX°  Status: free]
[Conduit 2: bearing XX°  Status: busy→Barnard]
[...]

═══ Energy ══════════════════════
Collector area (km²):     [input]
Stellar material weight:  [slider 0.0–1.0]
Reserve floor:            [slider 0.0–0.5]
Current reserve:          [progress bar]

═══ Queue ═══════════════════════
[Outbound: N items | Inbound: N items]
[Show manifest ▼]
```

---

### B.6 Message Type Catalogue

This defines every request type the simulation must handle. Implement these before the scheduler.

#### TYPE 1: `base_check`
**Purpose:** Confirm a station is online. The single highest-frequency message type.
**Conduit:** Comm conduit preferred (never blocks the main conduit)
**Priority:** P3 by default; escalates to P1 if a station has not responded within `2 × expected_period`
**Payload schema:**
```js
{
  senderTime: UST_timestamp,    // sender's current UST clock; receiver uses to update its clock
  senderQueueDepth: int,        // number of items in sender's outbound queue
  senderReserveFraction: float  // current energy reserve (so receiver knows if sender can accept)
}
```
**Protocol:**
1. A opens comm session with B
2. A sends `base_check` payload
3. B responds with its own `base_check` payload (same schema)
4. If either side has additional data (see `manifest` type), they attach it to the same session before sending "end"
5. Session closes. No new session opens until next scheduled window.

**Failure handling:** If B does not respond within `timeout` (configurable, default 3× the pairing's `targetCadenceSeconds`), A marks B as `suspect`. After 3 consecutive missed windows, B is marked `offline`. No transits are scheduled to an `offline` station. When the comm window reopens, A immediately re-attempts the check-in regardless of cadence schedule.

---

#### TYPE 2: `manifest`
**Purpose:** Exchange the full outbound queue summary so stations can coordinate scheduling.
**Conduit:** Comm conduit
**Priority:** P3 (piggybacks on `base_check` sessions; sent as additional data)
**Payload schema:**
```js
{
  items: [
    {
      messageId: string,
      type: string,
      priority: int,
      destinationId: string,
      conduitRequired: "main" | "comm",
      massKg: float | null,         // null for data-only
      earliestDeparture: UST,
      latestDeparture: UST | null,  // deadline; null = no deadline
      estimatedWindowNeededHours: float
    }
  ]
}
```
**Protocol:** Sent automatically at the end of every `base_check` session if `items.length > 0`. Receiving station integrates incoming manifest into its scheduling pass.

---

#### TYPE 3: `ship_route`
**Purpose:** Notify a neighbour station of vessels currently in the local system's approach / departure corridor that might affect bridge geometry.
**Conduit:** Comm conduit
**Priority:** P3 (piggybacks on manifest sessions); P2 if vessel is approaching within 12 hours and is large enough to potentially occlude
**Payload schema:**
```js
{
  vessels: [
    {
      vesselId: string,
      massKg: float,
      bubbleRadiusM: float,
      currentPositionLY: { x, y },
      velocityC: float,
      headingDeg: float,
      destinationStationId: string | null,
      estimatedApproachTime: UST,
      estimatedDepartureTime: UST | null
    }
  ]
}
```

---

#### TYPE 4: `data`
**Purpose:** A data-only payload (no physical object). Can use comm conduit, reducing load on main conduit.
**Conduit:** Comm conduit (if data fits; large files use a cargo drone instead)
**Priority:** Any (P3 default)
**Payload schema:**
```js
{
  dataType: "navigation_update" | "scientific" | "personal" | "administrative" | "software",
  sizeKB: float,
  contentHash: string,   // for integrity checking; not actual content in simulation
  requiresAck: bool
}
```

---

#### TYPE 5: `drone_transit`
**Purpose:** Physical transport of a comm/cargo drone through a bridge.
**Conduit:** Main conduit preferred. Comm conduit usable only if drone mass ≤ `commConduit.maxPackageMassKg` and drone radius ≤ `commConduit.tunnelRadiusM` — very small probes only.
**Priority:** Varies (P2–P5)
**Payload schema:**
```js
{
  droneId: string,
  massKg: float,
  bubbleRadiusM: float,
  cargoType: "data" | "supplies" | "equipment" | "fuel",
  cargoMassKg: float,
  onwardDestinationId: string | null,  // if relaying, where the drone goes next
  windowNeededSeconds: float           // estimated time to complete transit
}
```
**Bidirectional constraint:** When a drone_transit is active on a bridge A→B, no `drone_transit` or `vessel_transit` in the direction B→A can use the same bridge. They must queue. Two independent comm conduit sessions may run simultaneously on separate channel pairs, but the main conduit is a single-channel exclusive resource per bridge direction.

---

#### TYPE 6: `vessel_transit`
**Purpose:** Full vessel transit through a bridge. Highest energy cost; requires main conduit; longest window.
**Conduit:** Main conduit (exclusive)
**Priority:** P1–P3 depending on vessel type and manifest
**Payload schema:**
```js
{
  vesselId: string,
  massKg: float,
  bubbleRadiusM: float,
  crewCount: int,
  cargoManifest: [...],
  onwardDestinationId: string | null,
  preAnnouncedAt: UST,              // when the reservation was made
  windowNeededSeconds: float,
  couplingFactor: float             // vessel's drive coupling efficiency 0–1
}
```
**Pre-announcement requirement:** Vessel transits must be pre-announced via comm session before the main conduit window is allocated. An unannounced vessel cannot simply "show up" — the conduit may be in a different orientation. The station will schedule the transit, respond with the allocated window time, and the vessel must arrive within ±tolerance of that time.

---

#### TYPE 7: `multi_hop_coordination`
**Purpose:** Internal message type used by stations to negotiate relayed transits.
**Conduit:** Comm conduit (always; no physical object moves during coordination)
**Priority:** P2 (must resolve before the dependent transit can be scheduled)
**Payload schema:**
```js
{
  transitId: string,         // the drone_transit or vessel_transit being coordinated
  legFrom: string,           // requesting station (e.g., "sol_station")
  legTo: string,             // next-hop station (e.g., "barnard_station")
  finalDestination: string,  // end station (e.g., "wolf359_station")
  requestedWindowStart: UST,
  requestedWindowDurationH: float,
  priority: int,
  alternateWindows: [UST]    // fallback times if primary is unavailable
}
```
**Protocol:**
1. Source station A identifies that the payload must pass through B to reach C.
2. A sends `multi_hop_coordination` to B via comm session.
3. B checks its B→C schedule. If a compatible window exists, B responds with `confirmed_window`.
4. If no compatible window, B proposes the next available time, and A must adjust its A→B window to match.
5. The scheduler at A and B both record the reservation. A then announces to the vessel/drone carrier.

---

### B.7 Scheduler Design

**Algorithm basis — Deferred Acceptance (Gale-Shapley inspired):**
The scheduling problem has a natural match to Deferred Acceptance: multiple messages "propose" to conduit time windows, and stations "tentatively accept" the best match until a higher-priority proposal arrives. Specifically:
- Each open conduit window is a "seat" with preferences (prefers high priority, short slew, piggybacking on existing alignment)
- Each pending message "proposes" to its preferred window (soonest that fits its route)
- A window that already has a lower-priority assignment can be displaced by a higher-priority message, but only if the displaced message can be re-scheduled without breaking an already-committed vessel transit
- The process iterates until no message wants to swap (stable assignment)

This prevents the pathological case of a flurry of P3 messages locking out a P1 that arrives a moment later, and naturally handles the piggybacking preference (a message strongly prefers a window that is already open to the right target).

The scheduler runs on each simulated tick and processes the following steps in order:

**Step 1 — Check-in generation**
For each station–neighbour pairing, if `simTime - lastCheckinByNeighbour[neighbourId] > commCadences[neighbourId]`, add a `base_check` to the outbound queue for that neighbour. No separate heartbeat type exists; the check-in is the heartbeat.

**Step 2 — Route resolution**
For each item in the outbound queue with `status = "queued"` and `path = null`, run the routing algorithm (time-varying Dijkstra from this station's perspective, using known network topology) to assign a `path`. Mark status as `awaiting_alignment`.

**Step 3 — Window allocation**
For each item with a resolved path, attempt to allocate a departure window on the appropriate conduit:
- Check if the conduit's current schedule has a gap large enough for this item's window.
- If a previous window for the same target station is still active and the item fits within it, piggyback (no slew penalty).
- Otherwise, find the next available slot after the slew time from the current/last scheduled bearing.
- If the item is higher priority than a scheduled lower-priority item and the gap is < 2 × slew time, consider preemption (P1 only; P2 may preempt P4/P5 only).

**Step 4 — Session management (multiplexed subjects)**
A comm session is a persistent channel between two comm units. It carries one or more independent *subjects*, each with its own open/close markers. The channel stays open until all subjects are closed. This protocol:
- A opens a session and starts Subject 1 with an open marker
- A sends Subject 1's payload; B responds
- While Subject 1 is still open, A can start Subject 2 with a new open marker
- Subject 1 closes; Subject 2 continues
- When all subjects are closed and no new ones are signalled within the timeout window, the channel closes and both units are free to repoint

For the scheduler:
- If a new message arrives while a session is active and the channel's close sequence has not been sent yet, inject it as a new subject (do not wait for the channel to close and reopen)
- If the close sequence has already been sent, open a new session after reorientation
- A P1 message may inject as a new subject even if the current session's queue was already considered empty — this avoids adding slew delay for urgent traffic on an already-aligned channel

**Step 5 — Main conduit bridge management**
- If a bridge is `aligning`, check if slew is complete; transition to `active`.
- If `active`, advance the in-transit payload. On arrival, mark payload `delivered`, log event, check for queued payloads on the same bridge; extend session if available, else send "end" and start slew to next target.
- If `active` and the station is about to enter its shadow arc within `slew_margin` (user-settable), finish current payload then begin controlled shutdown.

**Step 6 — Energy accounting**
For each tick, deduct energy consumed by:
- Active bridges (proportional to length and tunnel radius)
- Active slewing (motor power, small but non-zero)
- Heartbeat transmissions
- Life support constant
Add energy harvested from solar collectors. Update `energyReserveFraction`. If reserve falls below `reserveFloor`, immediately halt all outbound scheduling until reserve recovers to `reserveFloor + 0.05` (hysteresis).

---

### B.8 Bidirectional Bridge Conflict Matrix

The simulation must enforce these rules:

| A→B direction | B→A direction | Allowed simultaneously? |
|---|---|---|
| Main conduit drone transit | Main conduit drone transit | **NO** — same physical bridge channel |
| Main conduit vessel transit | Main conduit drone transit | **NO** |
| Comm session (A's comm unit) | Comm session (B's comm unit) | **YES** — separate channel pairs; both can send and receive |
| Main conduit A→B | Comm session B→A | **YES** — different conduit types |
| Comm session A→B (channel 1) | Comm session A→B (channel 2) | **YES** — if station has ≥ 2 comm conduits with separate orientations |

The two-simultaneous-channel case from notes is supported when a station has ≥ 2 comm conduits that can both be oriented toward the same target (within their arc range). Each conduit is treated as an independent channel. This allows full-duplex comm sessions.

---

### B.9 Simulation Architecture — Tick Loop

```js
function simulationTick(deltaHours) {
  // 1. Advance orbital phases
  for (station of stations) {
    station.phaseRad += (2 * Math.PI / station.orbitalPeriodHours) * deltaHours;
    station.phaseRad %= (2 * Math.PI);
  }

  // 2. Recompute LOS for all station pairs
  for (pair of stationPairs) {
    pair.losA = computeLOS(pair.stationA, pair.stationB);  // checks host star occlusion at A
    pair.losB = computeLOS(pair.stationB, pair.stationA);  // checks host star occlusion at B
    pair.bridgeAvailable = pair.losA && pair.losB;
  }

  // 3. Run scheduler (see §B.7)
  scheduler.tick(deltaHours);

  // 4. Advance in-transit objects
  for (drone of activeDrones) {
    drone.currentPosition = advanceDrone(drone, deltaHours);
    if (droneArrived(drone)) deliverDrone(drone);
  }

  // 5. Update all bridge statuses
  updateBridgeStatuses(deltaHours);

  // 6. Generate background signals (if enabled)
  if (settings.backgroundSignals.enabled) {
    backgroundSignalGenerator.tick(deltaHours);
  }

  // 7. Advance simulation time
  simTime += deltaHours;

  // 8. Render
  renderer.draw();
}
```

---

### B.10 LOS Calculation

All positions are 3D vectors `{x, y, z}` in galactic light-year coordinates. Station world positions are recomputed each tick from orbital elements.

**Station world position from orbital elements:**
```js
function getStationWorldPos(station) {
  const star = starsById[station.starId];
  const rLY = station.orbitalRadiusAU * AU_IN_LY;

  // Orbit in its own plane (inclination = 0: orbit in galactic XY plane)
  const orbitX = rLY * Math.cos(station.phaseRad);
  const orbitY = rLY * Math.sin(station.phaseRad);
  const orbitZ = 0;

  // Rotate by inclination around the line of nodes (LAN)
  const lanRad = station.orbitLANDeg * DEG_TO_RAD;
  const incRad = station.orbitInclinationDeg * DEG_TO_RAD;
  const pos = rotatePlane(orbitX, orbitY, orbitZ, lanRad, incRad);

  return { x: star.x + pos.x, y: star.y + pos.y, z: star.z + pos.z };
}
```

**LOS check (3D sphere–line intersection):**
```js
function computeLOS(stationI, stationJ) {
  const sI = getStationWorldPos(stationI);
  const sJ = getStationWorldPos(stationJ);

  // Check both host stars for occlusion
  for (const starId of [stationI.starId, stationJ.starId]) {
    const star = starsById[starId];
    const starPos = { x: star.x, y: star.y, z: star.z };
    const starRadiusLY = star.radiusM / LY_IN_METRES;

    // Closest approach of the line sI→sJ to the star centre (3D)
    const d = pointToLineDistance3D(starPos, sI, sJ);
    if (d < starRadiusLY) return false;  // star body intersects the bridge path
  }
  return true;
}

function pointToLineDistance3D(point, lineA, lineB) {
  // Returns the perpendicular distance from `point` to the infinite line through lineA and lineB
  const AB = subtract3(lineB, lineA);
  const AP = subtract3(point, lineA);
  const cross = cross3(AB, AP);
  return magnitude3(cross) / magnitude3(AB);
}
```

**Comm unit reachability check (3D):**
```js
function isInCommUnitRange(station, unit, targetStationId) {
  const stationPos = getStationWorldPos(station);
  const targetPos  = getStationWorldPos(stationsById[targetStationId]);

  // Direction from this station to target, in galactic frame
  const dir = normalise3(subtract3(targetPos, stationPos));

  // Express dir in station-local frame
  // Station local axes:
  //   +Z_local = anti-stellar (main conduit axis)
  //   +X_local = direction of orbital motion
  //   +Y_local = Z_local × X_local
  const zLocal = normalise3(subtract3(stationPos, starPos(station)));  // anti-stellar
  const xLocal = normalise3(station.velocityVector);                   // along orbit
  const yLocal = cross3(zLocal, xLocal);

  const dirLocal = {
    x: dot3(dir, xLocal),
    y: dot3(dir, yLocal),
    z: dot3(dir, zLocal)
  };

  // Rotate into unit-local frame by mount angle around zLocal
  const cosM = Math.cos(unit.mountAngleDeg * DEG_TO_RAD);
  const sinM = Math.sin(unit.mountAngleDeg * DEG_TO_RAD);
  const unitLocal = {
    x:  dirLocal.x * cosM + dirLocal.y * sinM,
    y: -dirLocal.x * sinM + dirLocal.y * cosM,
    z:  dirLocal.z
  };

  // unitLocal.x = equatorial (X-axis) component
  // unitLocal.y = along-conduit (Y-axis) component
  // unitLocal.z = outward radial; must be > 0 (in front of the unit)
  if (unitLocal.z <= 0) return false;  // behind the unit (station body blocking)

  const xAngle = Math.atan2(unitLocal.x, unitLocal.z) * RAD_TO_DEG;
  const yAngle = Math.atan2(unitLocal.y, unitLocal.z) * RAD_TO_DEG;

  return Math.abs(xAngle) <= unit.xRangeDeg / 2   // ±90° equatorial sweep
      && yAngle >= -120                             // up to 120° toward star
      && yAngle <=  120;                            // up to 120° toward conduit
}
```

**Main conduit reachability check (3D):**
The main conduit covers the anti-stellar hemisphere. A target is reachable if the angle between the anti-stellar direction and the direction to the target is ≤ 90°:
```js
function isInMainConduitRange(station, targetStationId) {
  const antiStellar = normalise3(subtract3(getStationWorldPos(station), starPos(station)));
  const toTarget    = normalise3(subtract3(getStationWorldPos(stationsById[targetStationId]),
                                           getStationWorldPos(station)));
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot3(antiStellar, toTarget)))) * RAD_TO_DEG;
  return angleDeg <= 90;
}
```

---

### B.11 Implementation Phases

Build in this order to get a working prototype quickly, then layer in complexity:

**Phase 1 — Static map (no simulation)**
- Render stars at their galactic-frame XY positions (Z projected out)
- Render orbital rings as ellipses (aspect ratio from inclination)
- Place station dots at initial orbital phase positions
- Hardcode Sol + 3 nearest stars from the catalogue with real inclinations
- Green/red arc on rings (using precomputed shadow arcs from 3D LOS)
- Inactive bridge lines between all pairs
- Clicking a star selects it, shows basic info in right panel
- Orbital distance slider updates derived values in info panel

**Phase 2 — Orbital animation**
- Implement tick loop with time advancement
- Station dots move along their rings
- Bridge lines toggle active/inactive based on live LOS computation
- Opacity of bridge lines shifts as per spec (0.75 active / 0.25 inactive)
- Play/pause/speed controls work

**Phase 3 — Station inspector**
- Full inspector panel with all tweakable parameters
- Conduit visualisation (bearing indicators on station dot)
- Energy bar and reserve indicator

**Phase 4 — Basic queue and heartbeats**
- Implement `base_check` generation and delivery
- Comm drones travel across the map (animated)
- Simple manifest panel lists active messages

**Phase 5 — Scheduler**
- Full message type catalogue
- Bidirectional conflict detection
- Slew time calculation and scheduling
- Priority ordering

**Phase 6 — Background signal generator**
- Configurable rate and type mix
- Stress-tests the queue; reveals scheduling bottlenecks visually

**Phase 7 — Multi-hop coordination**
- `multi_hop_coordination` message type
- A→B→C path resolution and window negotiation
- Blue planned-path lines on map

**Phase 8 — Polish**
- Save/load simulation state (JSON)
- Export manifest as text
- Tooltips on hover
- Keyboard shortcuts (space = pause, +/- = speed)

---

## Part C: Resolved Design Questions & Remaining Open Questions

Previously open questions resolved:

1. ✅ **Main conduit and comm conduits are independent hardware** — a drone transit on the main conduit does not block comm conduit sessions and vice versa.

2. ✅ **Main conduit arc is fixed to the station, pointing away from the star** — the 180° semi-sphere is star-relative (always anti-stellar). As the station orbits, the range of reachable targets changes; the safe parking zone is always on the sunward side.

3. ✅ **Comm conduits can handle small physical packages** — subject to strict limits (`tunnelRadiusM ≈ 0.15 m`, `maxPackageMassKg ≈ 2 kg`). Designed primarily for light/data; physical packages are secondary and use field manipulation (miniature equivalent of the main conduit's dock system). Main conduit connects to ~25 docks; we assume free docks are always available for now.

4. ✅ **Never interrupt a vessel transit** — P1 messages use comm conduits or wait for transit completion. A bridge is never purposefully closed with a vessel inside it.

5. ✅ **New station bootstrap procedure** — A new station begins by operating only its comm conduits. It sweeps varying aim points (small angular offsets around the expected position of the nearest existing station) at slightly varying times, broadcasting a connection attempt. The receiving station detects the weak field and responds, locking in the connection. A failed attempt (no response, weak/non-coupling field detected) terminates early — both sides can detect that their field is not coupling. Once the first connection succeeds, the new station syncs its ephemeris and UST clock, and the network routing tables update via the check-in cascade. The main conduit is then brought online once calibrated. The main conduit uses more tightly controlled fields (stronger effects), so its first acquisition is more carefully scheduled with the coordinating station rather than a blind sweep.

---

## Part D: All Questions Resolved

1. ✅ **Cadence is `min(A.baseCadenceSeconds, B.baseCadenceSeconds)`** — the more active station sets the pace for both; the session is always bidirectional (B's queue is included in the response).

2. ✅ **Main conduit range is enforced dynamically per-tick** — window pre-computation includes a hard deadline at the moment the target exits the 180° anti-stellar arc or the shadow begins, whichever comes first. Transits that cannot complete before that deadline are deferred.

3. ✅ **Comm unit mount positions are fixed hardware, biaxial gimbal** — each unit's base is fixed to the station rim; the emitter head rotates on two independent axes: 180° in the equatorial plane (X-axis, blocked by station disc) and 240° in the meridional plane (Y-axis, ±120°: +120° toward the main conduit axis with rim clearance, -120° toward the star). Reachability is computed as a 3D spherical-rectangle test. The simulation is 3D physics with 2D galactic-plane projection for display.

4. ✅ **Mid-session injection via multiplexed subjects** — a new message can be added as a new subject to an active session as long as the channel's close sequence has not been sent. The channel stays open until all subjects close. This avoids unnecessary reorientation for high-priority traffic on an already-aligned link.

---

*No open questions remain. Ready to begin Phase 1 implementation.*
