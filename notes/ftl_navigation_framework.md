# Integrated Navigation, Communication & FTL Systems
### A Design Framework — Worldbuilding Reference

---

## Part 1: Positioning & Timekeeping

### 1.1 Three-Tier Navigation Architecture

Vessels use three complementary systems in descending order of precision:

**Tier 1 — Stellar Fix (passive, always available)**
The onboard optics array measures the apparent positions, brightnesses, and Doppler shifts of nearby stars against a master catalogue. The Doppler shift of stellar spectral lines provides radial velocity compensation; apparent position offsets vs. the catalogue give positional parallax. Accuracy degrades with distance from Sol (the catalogue reference frame), typically:

- Within 10 LY of Sol: ± 0.001 AU
- Within 100 LY: ± 0.1 AU
- Beyond 100 LY: ± 1–10 AU (stellar fix alone becomes a rough guide only)

**Tier 2 — Pulsar Navigation (XNAV, passive, high precision)**
Millisecond pulsars are among the most stable clocks in the universe — some rival or exceed atomic clocks. The vessel's X-ray detector array times the arrival of pulses from ≥ 4 known pulsars simultaneously. Pulse timing anomalies from the expected profile triangulate position. This system achieves ≈ **5–10 km accuracy anywhere in the galaxy**, independent of distance from Sol. Typical fix time: 15–30 minutes of continuous observation. This is the backbone of interstellar navigation.

**Tier 3 — FTL Drone Fix (active, highest precision)**
When a vessel dispatches or receives a communication drone, the originating station tracks the drone's departure vector and elapsed transit time, then calculates a precise position update. The station broadcasts this back in the return drone's navigation header. Accuracy: **sub-kilometre, potentially sub-metre** with well-calibrated drone trajectories. This is effectively GPS for interstellar space — sparse, but extremely accurate when available.

### 1.2 Dead Reckoning Between Updates

Between drone fixes, the vessel integrates its own drive telemetry:

- Accelerometers and drive-field sensors measure velocity and heading to high precision
- Stellar fix supplements the dead reckoning continuously
- Pulsar fix can be taken any time the vessel is stationary relative to its local frame for ≥ 20 minutes

Error accumulation in dead reckoning (no external fixes):
- Velocity measurement error of 0.001% over a 1 LY journey → ~1,000 km positional drift
- This is acceptable for interstellar navigation (destination star is easily identifiable from tens of AU)
- Not acceptable for orbital operations or vessel rendezvous → require drone fix or continuous pulsar observation

The navigation computer maintains a confidence ellipsoid around the estimated position, expanding continuously until a new fix collapses it. Pilots see this as a visual "uncertainty bubble" in the nav display.

### 1.3 Universal Standard Time (UST)

FTL travel creates serious timekeeping problems. A vessel that accelerates near c (even inside a bubble) experiences time differently from Sol; the bubble itself is ambiguous about which reference frame it preserves. The network handles this as follows:

- **Sol Station** maintains the master UST clock, derived from an ensemble of atomic clocks
- Every drone carries a UST timestamp embedded in its header
- When a drone arrives at a station, the station logs the UST timestamp vs. its own local clock, notes the drift, and applies a correction factor
- Vessels receive UST corrections with every drone exchange; their own clocks drift between updates
- Drift rate depends on velocity and gravitational depth during travel; high-speed vessels may experience several seconds of drift per LY of travel at extreme speeds

Story note: a vessel returning from a long, fast journey may find that more time has passed on the network than it experienced. UST reconciliation is part of standard docking procedure.

---

## Part 2: The Bridge Communication Network

### 2.1 Station Types

| Type | Orbit | Role |
|---|---|---|
| **Sol Station (Heliospheric)** | ~0.03 AU from Sol | Master hub, UST master, primary routing |
| **Outer System Relay** | 1–5 AU from host star | Bridges to inner station, relay for in-system vessels |
| **Waypoint Station** | Nearest known station to a new system | Last port before uncharted travel |
| **Frontier Station** | Orbit of newly settled star | Local hub; joins network when bridges are established |

### 2.2 Bridge Mechanics & Line-of-Sight

A bridge uses the stellar energy harvested by both endpoint stations to create a maintained metric linkage — a topological shortcut through spacetime. It is not a wormhole in the physical sense; nothing "passes through" space. Instead, the drone is imprinted with a metric signature at Station A and deconstructed/reconstructed at Station B. Transit time is near-instantaneous (bounded by the signal propagation time within the stations themselves, typically < 1 second).

**Why line-of-sight is required:**  
The bridge maintains metric coherence between endpoints by continuously aligning their local spacetime reference frames. This alignment uses a coherence beam (likely gravitational wave modulation or some exotic metric signal). Any large gravitational body in the direct path — a star, gas giant, or even a closely aligned dense vessel — introduces metric perturbations that decohere the bridge within milliseconds.

Small planets, moons, and ordinary vessels cause negligible decoherence unless they are *precisely* aligned (within a few hundred kilometres of the geometric line between stations). A star behind which one endpoint passes is the primary practical blocker.

**Occlusion categories:**
1. **Stellar occlusion** — the dominant disruption; predictable; each station has a shadow window each orbit
2. **Planetary transit** — rare, brief (seconds to minutes), mostly negligible except for plot purposes
3. **Deliberate blocking** — a sufficiently massive vessel parked precisely on the bridge line can disrupt the connection (plot device potential!)

### 2.3 Message Routing Algorithm

The network is a **time-varying directed graph**:
- Nodes = Stations + the vessel's current position
- Edges = potential bridge connections
- Edge weight = time to use the connection = wait time for alignment + near-zero transit + estimated processing time

The vessel's navigation computer stores a continuously updated **Ephemeris Database** containing:
- Orbital parameters and current positions of all known stations
- Predicted shadow windows for each station for the next 30 days
- Known bridge connections and their historical availability

The routing algorithm selects a path by finding the minimum total latency from vessel to destination and back:

```
t_total = t_vessel→A           (drone travel, vessel to nearest station)
        + Σ [w_hop_i]           (wait times for each bridge alignment)
        + t_processing          (at destination station, can be queried in advance)
        + Σ [w_hop_return_i]    (wait times for return path)
        + t_A→vessel            (return drone travel)
```

The algorithm runs forward-in-time Dijkstra's: starting from the projected departure time, it propagates through the graph, at each node checking if the next bridge is currently available or how long until it opens.

### 2.4 Priority Levels

| Priority | Routing Strategy | Notes |
|---|---|---|
| **P1 — Emergency** | Fastest available path, regardless of hops or energy cost | Beacon mode: all stations accept immediately |
| **P2 — Urgent** | Speed-optimised; multi-hop if faster than waiting for alignment | Preempts lower-priority queued drones |
| **P3 — Standard** | Balance of speed and directness; up to 2 hops preferred | Default for most operational messages |
| **P4 — Low Priority** | Prefer direct routes; wait for alignment rather than re-routing | Batch with other drones to reduce energy cost |
| **P5 — Background** | Opportunistic; sent only during off-peak windows | Large data packets, software updates, bulk records |

The vessel computer calculates the *cost of delay* vs. *cost of urgency* when setting priority. If a P3 message via 3 hops arrives 4 hours faster than waiting 8 hours for a direct alignment, the routing is clear. If a P3 message can wait 2 hours for a direct alignment vs. routing through 4 intermediate stations with cumulative uncertainty, the direct route wins.

### 2.5 Time Estimation: The Practical Formula

For a message from vessel to a destination Station C, via intermediate Station A, requesting information (requiring a response):

```
Round-trip estimate =
  [drone travel: vessel → Station A]             variable (depends on vessel position)
  + [alignment wait: A → B]                      0 to (max shadow duration at A or B)
  + [alignment wait: B → C]                      same
  + [processing time at C]                       C's current queue + estimated task complexity
    (C may need to dispatch its own drones;       add their round-trip recursively)
  + [alignment wait: C → B return]
  + [alignment wait: B → A return]
  + [drone travel: Station A → vessel]           similar to outbound leg
```

The vessel computer shows a probabilistic estimate: "expected 31.4 hours, 90th percentile 47.2 hours." The wide range accounts for the stochastic nature of processing queues at busy stations.

---

## Part 3: Sol Station Orbital Mechanics

### 3.1 Recommended Orbit: 0.03 AU (≈ 4.49 × 10⁹ m from Sol's centre, ≈ 6.5 R☉)

**Rationale:**
- Close enough that the solar corona is dense enough for magnetic plasma scooping
- The Parker Solar Probe reached 0.046 AU with passive heat shielding; a far-future station at 0.03 AU with active magnetic deflection and advanced materials is plausible
- Stellar magnetic field at this distance: ≈ 1,000× stronger than at Earth orbit, aiding plasma confinement
- Solar wind has not yet fully accelerated (≈ 75–150 km/s vs. 400 km/s at 1 AU), but density is far higher

### 3.2 Calculated Orbital Parameters

Using GM☉ = 1.327 × 10²⁰ m³/s², R☉ = 6.957 × 10⁸ m:

| Parameter | Value |
|---|---|
| Orbital radius | 4.488 × 10⁹ m (0.03 AU, 6.45 R☉) |
| Orbital velocity | **172 km/s** (≈ 0.057% c) |
| Orbital period | **45.5 hours** (≈ 1.90 Earth days) |
| Solar surface gravity at station | ~0.39 m/s² (station is in free orbit) |
| Solar flux at station | **1.51 MW/m²** (≈ 1,110× Earth's solar constant) |
| Coronal plasma temperature | ~1–2 million K (but extremely low density) |

The 172 km/s orbital velocity is significant for station engineering — any detached structure must be independently in the same orbit or rapidly drifts apart.

### 3.3 Visibility Windows (Sol Station Blocking by the Sun)

For a distant observer in Sol Station's orbital plane, the Sun blocks line-of-sight to Sol Station when the station passes "behind" the Sun. The blocking arc is:

```
θ_block = 2 × arcsin(R☉ / r_station)
         = 2 × arcsin(6.957 × 10⁸ / 4.488 × 10⁹)
         = 2 × arcsin(0.1550)
         = 2 × 8.92°
         = 17.84°
```

| Metric | Value |
|---|---|
| Shadow arc | 17.84° of the orbit |
| Fraction of orbit blocked | **4.96%** |
| Blocking duration per orbit | **≈ 2.26 hours** every 45.5 hours |
| Max continuous visible window | **≈ 43.2 hours** |
| Single-station uptime | **≈ 95.0%** |

The shadow event is **entirely predictable** — orbital mechanics gives exact entry and exit times centuries in advance. The navigation computer predicts these with zero uncertainty.

### 3.4 Comparison: Different Orbital Distances

| Orbit (AU) | Period | Orbital Speed | Shadow Duration | Uptime |
|---|---|---|---|---|
| 0.02 AU (4.3 R☉) | 24.9 h | 210 km/s | 1.85 h/orbit | 92.6% |
| **0.03 AU (6.5 R☉)** | **45.5 h** | **172 km/s** | **2.26 h/orbit** | **95.0%** |
| 0.05 AU (10.8 R☉) | 98.0 h | 133 km/s | 2.91 h/orbit | 97.0% |
| 0.10 AU (21.5 R☉) | 277 h | 94 km/s | 4.12 h/orbit | 98.5% |

The uptime improves at greater distances, but plasma density for harvesting drops sharply. The 0.03 AU orbit balances these concerns.

### 3.5 Multi-Station Combined Uptime

When two stations each have ~95% uptime and their blocking events are statistically independent (different orbital planes, different periods), the combined bridge availability is:

```
P(both visible) ≈ 0.950 × 0.950 = 90.25%
```

For a station orbiting Proxima Centauri (much smaller star, R ≈ 0.15 R☉, cooler so closer orbit tolerable):

```
At 0.01 AU from Proxima:
  Period ≈ 25.1 hours
  Shadow arc = 2 × arcsin(0.104 × 10⁹ / 1.496 × 10⁹) = 7.98°
  Shadow duration ≈ 33 minutes per orbit
  Uptime ≈ 97.8%
```

Sol–Proxima bridge combined uptime: ~95.0% × 97.8% ≈ **92.8%**

**Routing implication for multi-hop paths (4 hops, each 95% uptime):**
```
P(all 4 clear) ≈ 0.95⁴ ≈ 81.5%
Average additional wait across 4 hops ≈ 4 × (0.05 × 2.26/2 hrs) ≈ 17 minutes
Worst-case wait (all in shadow simultaneously) ≈ 4 × 2.26 = ~9 hours
```

This gives the routing algorithm meaningful trade-offs: a direct 2-hop path with a known 4-hour alignment wait might beat a 4-hop path where each hop is nominally ready but has a 19% chance of requiring a wait.

---

## Part 4: FTL Physics Framework

### 4.1 Physical Basis (Alcubierre-Inspired)

The underlying physics is an evolution of the Alcubierre metric — a modification of spacetime geometry around a vessel such that it moves within a "flat" local bubble while the surrounding space contracts ahead and expands behind. The exotic-matter problem is assumed to be solved by future technology; what remains is the classical energy scaling.

The original Alcubierre formulation showed that bubble energy scales roughly with the square of the bubble radius and the square of the velocity. Later refinements by White (2012) showed that a toroidal geometry could dramatically reduce requirements. The framework below uses an empirically-fitted exponent derived from those refinements.

### 4.2 Bubble Drive Power Equation

```
P_drive = κ × M_tot × R_bub² × (v/c)ⁿ / η_drive
```

Where:
- **κ** = the "warp constant" (calibrated by one reference scenario; see §4.5)
- **M_tot** = total mass within the bubble (vessel + cargo + drive system + fuel), kg
- **R_bub** = bubble radius (m); minimum is the vessel's longest dimension × 1.1 clearance factor
- **v** = bubble velocity; **c** = speed of light
- **n = 3** (recommended; matches Alcubierre scaling for velocity dependence; adjust to taste)
- **η_drive** = drive efficiency, 0 to 1; advanced drives achieve 0.80–0.95

**Total energy for a journey of distance d at constant speed v:**
```
E_drive = P_drive × (d/v)
        = κ × M_tot × R_bub² × (v/c)² × (d/c) / η_drive
```

Note: energy scales as **v²**, not v³, because higher speed means shorter travel time. The practical consequence: there is no single "optimal" cruise speed — faster always costs more energy, so missions trade off speed against fuel mass.

**Maximum speed for a given power budget P:**
```
v_max = c × [ P × η_drive / (κ × M_tot × R_bub²) ]^(1/3)
```

### 4.3 The Drone vs. Ship Speed Differential

For identical power-to-mass ratios (same P/M), speed depends on bubble radius:

```
v_max ∝ R_bub^(-2/3)
```

For a communication drone (M_d = 50 kg, R_d = 1.5 m) vs. a light freighter (M_f = 10⁶ kg, R_f = 100 m), at the same total power:

```
v_drone / v_freighter = [(M_f × R_f²) / (M_d × R_d²)]^(1/3)
                      = [(10⁶ × 10⁴) / (50 × 2.25)]^(1/3)
                      = [8.89 × 10⁷]^(1/3)
                      ≈ 447
```

**The drone is approximately 450× faster than the freighter at the same total power.** For the same energy budget per trip, the differential is even larger (~9,400×), because the drone completes its journey so much faster.

This is the physical reason why communication drones vastly outpace vessels in speed — it is not a design choice but an inherent consequence of mass and bubble geometry.

### 4.4 Minimum Viable Bubble Radius

The drive equations create strong incentives to minimise R_bub. However, there is a practical lower bound:

```
R_bub_min = f × max(L_vessel, W_vessel, H_vessel)
```

Where f ≈ 1.08–1.15 (safety margin for metric stability near the bubble wall). Objects that contact the bubble wall are subject to extreme tidal forces; crew and sensitive equipment require at least 2–5 metres of clearance.

An explorer-class vessel 80 m long × 30 m wide × 20 m tall: R_bub_min ≈ 86 m (using longest dimension × 1.08).

### 4.5 Drive Constant Calibration

The constant κ has units of W·c³/(kg·m²) and cannot be derived from first principles in fiction — it is the one free parameter. Set it by picking a **reference scenario** that feels right for your story:

*Example calibration:* A small scout ship (M = 5,000 kg, R_bub = 30 m, η = 0.85) achieves v = 50c using P = 1,000 TW (which might represent, for example, the output of ~600 km² of the Sol Station solar array).

Solving: κ = P × η × c³ / (M × R² × v³)

Once κ is set, all other scenarios scale from it consistently.

### 4.6 Bridge Equations

The bridge is a maintained topological connection between two stations. Unlike the drive, the bridge does not accelerate mass through space; it reconstructs/deconstructs a drone's quantum state at each endpoint. Energy scales with the connection's length and tunnel radius, but not with payload mass (beyond a loading factor for heavy traffic).

**Bridge maintenance power:**
```
P_bridge = λ × L_bridge × r_tun² / η_bridge
```

Where:
- **λ** = bridge constant (separate from κ; calibrated similarly)
- **L_bridge** = bridge length in light-years
- **r_tun** = tunnel radius (m); determines maximum size of objects transferable
- **η_bridge** = bridge efficiency (stellarpower conversion)

Key scaling: **P_bridge ∝ L** (linear in distance, not quadratic). Maintaining a bridge to a star 10 LY away costs 10× more than one to a star 1 LY away, all else equal. This makes nearby stars far cheaper to connect, creating a natural "near neighbourhood" communication advantage.

**Bridge loading (active transfers):**
```
P_bridge_active = P_bridge_idle × (1 + ζ × Ṁ / Ṁ_rated)
```

Where Ṁ is mass throughput and ζ is a loading coefficient (~0.2–0.5). For communication drones (typically 50–500 kg), the loading overhead is small. A large vessel being launched through the bridge causes a significant spike.

### 4.7 Combined Drive + Bridge Operation (Waypoint Launch)

When a vessel uses its own drive inside a bridge, the two systems couple. The bridge's metric distortion partially satisfies the drive's requirements, reducing the effective bubble radius the drive must maintain:

```
R_eff = R_vessel × (1 − α × coupling_factor)
```

Where coupling_factor ∈ [0, 1] represents how well the vessel's drive frequency is matched to the bridge's metric frequency (a function of engineering; frontier vessels may have poor coupling efficiency, purpose-built couriers may be optimised).

**Combined effective velocity:**
```
v_combined = v_bridge + ξ × v_vessel_drive
```

Where ξ > 1 is the amplification factor (typically 1.5–3.0 for good coupling). The vessel's drive is more effective inside the bridge because it is working with an already-distorted spacetime rather than against flat space.

**Practical result:** Waypoint Stations can launch a vessel at the station's bridge speed, and the vessel's drive adds a fraction on top. A vessel that can achieve 15c alone might reach 40–80c when launched by a Waypoint Station with good coupling, explaining why Waypoint Stations matter even for vessels with functional drives.

---

## Part 5: Energy Systems

### 5.1 Solar Flux at Sol Station (0.03 AU)

Solar irradiance scales as 1/r²:

```
F(0.03 AU) = 1,361 W/m² × (1 AU / 0.03 AU)²
           = 1,361 × 1,111
           ≈ 1.51 × 10⁶ W/m²  =  1.51 MW/m²
```

**Collector array output:**

| Array Size | Power Output | Equivalent |
|---|---|---|
| 1 km² | 1.51 TW | ~50% of current Earth power consumption |
| 10 km² | 15.1 TW | ~5× Earth's current total power use |
| 100 km² | 151 TW | ~50× Earth |
| 10,000 km² | 15,100 TW | Easily powers all bridge connections |

A 100 × 100 km collector square (10,000 km²) sounds enormous, but occupies only 0.00022% of the orbital circumference at this distance — it is geometrically trivial. The station is less a single structure than a distributed ring of collection panels in the same orbit, connected by microwave power transmission.

### 5.2 Stellar Wind Plasma Harvesting

At 0.03 AU, the solar wind is dense and still accelerating. Using a coronal density model:

```
n_proton ≈ 12,000 protons/cm³  (vs. 5–10 at Earth orbit)
v_wind ≈ 100–150 km/s  (not yet fully accelerated)
Mass flux density ≈ 2.0–3.5 × 10⁻¹² kg/(m²·s)
```

**Collection rate, 100 km² magnetic scoop (100% capture efficiency):**

```
Ṁ = 2.5 × 10⁻¹² × 10⁸ m² ≈ 2.5 × 10⁻⁴ kg/s ≈ 21 kg/day
```

**With magnetic funnel focusing (effective aperture 1,000× physical):**
```
Ṁ ≈ 21,000 kg/day ≈ 21 tonnes/day
```

This hydrogen/helium plasma serves two functions:
1. **Fusion fuel** — D-T fusion of 1 kg yields ~6.3 × 10¹⁴ J (630 TJ). At 21 t/day, potential fusion power ≈ 153 TW continuous (supplementing solar PV)
2. **Reaction mass** — for station-keeping, adjusting orbital parameters, and refuelling vessels

At 0.03 AU, the solar radiation pressure also exerts a significant force on large collector arrays, which doubles as orbital station-keeping thrust — a passive benefit.

### 5.3 Power Budget Summary

For a well-established Sol Station maintaining 20 active bridge connections to nearby stars (avg. 5 LY each), plus vessel traffic:

| Function | Estimated Power |
|---|---|
| 20 bridge maintenance connections | ~500–2,000 TW (depends on λ calibration) |
| Active vessel transits (peaks) | +50–500 TW during launches |
| Station life support & computing | ~10 TW |
| Drone fabrication and fuelling | ~5 TW |
| Reserve / storage charging | 20% of generation |

This suggests a minimum solar collection infrastructure of **~1,500–3,000 TW**, achievable with a 1,000–2,000 km² collector array — well within the physical constraints of the orbit.

---

## Part 6: New System Establishment

### 6.1 The Waypoint Process

When a new star system is identified for establishment:

1. **Survey drone** (tiny, extremely fast, no crew) traverses via existing bridge network to the nearest Waypoint Station, then uses its high-speed drive to fly the remaining leg solo. Returns with stellar data. This may take weeks to months depending on distance from the network edge.

2. **Establishment fleet** departs from nearest Waypoint Station. Vessels use their own (slow, large-bubble) FTL drives; speed is greatly limited by crew requirements, supplies, and the mass of station construction materials. Multi-year journey for more distant targets is plausible for frontier expansion.

3. **Station core constructed** in orbit of new star. Initial power comes from a smaller solar array; the full array is assembled over months or years.

4. **Bridge test** — once the new station has sufficient power, it attempts a first bridge alignment with the nearest station in the network. The first successful transfer is a landmark event. Initially this bridge will have low uptime (limited power, engineering calibration) but improves as the station matures.

5. **Network integration** — the new station is added to all ephemeris databases. Communication to and from the system drops from years (physical vessel) to hours or days (bridge network). The system is now "open."

### 6.2 Speed Comparison: Before and After Establishment

For a new system 8 LY from the nearest Waypoint:

| Stage | Speed | Travel Time |
|---|---|---|
| Survey drone (drive only, 50 kg) | e.g. 3,000c | ~1 day |
| Establishment vessel (drive only, 10⁶ kg) | e.g. 8c | ~1 year |
| Post-establishment: small courier via bridge | ~instant (bridge) + local legs | hours |
| Post-establishment: freighter via bridge launch | bridge + vessel drive combined | days |

---

## Part 7: Future Simulation Framework

### 7.1 Real Nearby Star Catalogue (Closest Targets)

For a simulation using real stellar distances and types:

| Star | Distance (LY) | Type | Notes |
|---|---|---|---|
| Proxima Centauri | 4.24 | M5.5Ve (red dwarf) | Closest; small, dim star |
| Alpha Centauri A | 4.37 | G2V (Sun-like) | Binary system |
| Alpha Centauri B | 4.37 | K1V (orange dwarf) | Binary with above |
| Barnard's Star | 5.96 | M4Ve | High proper motion |
| Wolf 359 | 7.78 | M6Ve | Very faint |
| Lalande 21185 | 8.29 | M2V | |
| Sirius A | 8.60 | A1V | Brightest nearby; has white dwarf companion |
| Epsilon Eridani | 10.52 | K2V | Known debris disc |
| Tau Ceti | 11.91 | G8V | Sun-like; habitable zone candidate |

A simulation could model each of these with their own Sol Station equivalent, each orbiting at a calculated distance from their host star, with shadow durations derived from the star's actual radius and the chosen orbital distance.

### 7.2 Simulation Architecture Sketch

A future simulation would need:

```
For each station S_i:
  - Position in galactic frame (3D coordinates from stellar catalogue)
  - Orbital parameters (period, radius, inclination around host star)
  - Current orbital phase (initialised randomly or from some epoch)

For each timestep t:
  For each station pair (S_i, S_j):
    - Compute vector S_i → S_j
    - Check if host star of S_i occludes S_j (as seen from S_i)
    - Check if host star of S_j occludes S_i (as seen from S_j)
    - Record bridge available = (not occluded at either end)

For a message routing request (source, destination, departure_time, priority):
  - Run time-varying Dijkstra from departure_time
  - Return: optimal path, estimated arrival time, confidence interval
```

Each station's shadow windows can be precomputed analytically for any future time window (orbital mechanics is deterministic), making the routing computation fast. Bridge length (real distance between stars) enters the bridge power equation directly, giving a physically-grounded energy cost per route.

---

## Summary: Key Numbers to Remember

| Quantity | Value |
|---|---|
| Sol Station orbital distance | 0.03 AU (6.5 R☉) |
| Sol Station orbital period | **45.5 hours** |
| Sol Station orbital speed | **172 km/s** |
| Sol Station shadow per orbit | **2.26 hours** |
| Sol Station single-link uptime | **~95%** |
| Sol–Proxima bridge combined uptime | **~93%** |
| Solar flux at Sol Station | **1.51 MW/m²** |
| Drone speed advantage over freighter | **~450× (same power)** |
| Bridge power scaling | Linear in distance |
| Drive energy scaling | Quadratic in speed, linear in distance |

---

*This document is a living design reference. The FTL constants κ and λ are intentionally left uncalibrated — calibrate them from one reference scenario that fits your story's pacing, then all other scenarios scale consistently from it.*
