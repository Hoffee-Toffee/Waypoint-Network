# FTL Network Station Communication Protocol
### Reference Document — Simulation Basis

---

## 1. Assumptions & Shared State

Every station maintains a continuously-updated local model of the entire known network.  No real-time signalling is needed to know *where* other stations are at any moment:

- **Orbital elements** for all stations are shared at first contact and updated in subsequent check-ins.  Each station independently integrates the Keplerian equations to predict every other station's position at any future time.
- **LOS windows** are therefore known in advance for every station pair, out to any horizon.  Shadow entry/exit times are deterministic.
- **UST synchronisation** occurs during every check-in; each station carries a running UST clock and corrects drift when it receives a timestamp from any neighbour.

---

## 2. Line-of-Sight Calculation

LOS between stations A and B is **clear** when no stellar body's physical disc intersects the straight-line segment between their current 3D positions.

**Algorithm:**
1. Compute the 3D world positions of stations A and B.
2. For each potentially-occluding star (precomputed at bridge build time as the subset of stars within `starRadius + margin` of the segment defined by the two *host star* positions):
   - Compute the closest approach distance from the star centre to the **segment** A→B (not the infinite line — stars behind either endpoint must not register as occluders).
   - If `closestApproach < starRadiusLY`, LOS is blocked.
3. LOS is clear only if no star fails the above test.

**Predictive LOS:**  Because orbits are deterministic, the time until the next occlusion for any bridge is computed analytically (O(1)) by finding the prograde angular distance from the current orbital phase to the shadow-entry phase for each endpoint's host star.  This value (`losRemainingSeconds`) drives scheduling decisions.

---

## 3. Physical Conduit Requirements

A bridge between stations A and B requires **both** endpoints to simultaneously point their conduit at each other and maintain that alignment for the **full duration** of the bridge.

### 3.1 Conduit Types

| Conduit | Purpose | Slew rate | Range |
|---|---|---|---|
| **Comm conduit** | Data, check-ins, small packages | 0.25 s/deg | Biaxial: ±90° equatorial, ±120° meridional |
| **Main conduit** | Vessels, large cargo, bulk drone transits | 15 s/deg | 180° anti-stellar hemisphere |

### 3.2 Pointing Constraint

A conduit is a physical device.  It can only point at **one** target at a time.  While a session is active, the conduit is locked to that target and unavailable for any other.

**Session lifetime:**
1. Slew phase: conduit rotates from its last pointing to the new target bearing.  Duration = `angularDistance × slewRateSecPerDeg`.
2. Bridge active: metric field energised, data/payloads transit.
3. Session end: either side sends an "end" token when its outbound queue for this target is empty, or a new subject is opened to extend the session.

**Mutual constraint:** A bridge requires *both* stations' conduits to remain on-target.  If either station needs to close early (LOS about to expire, emergency re-point), the bridge closes.

### 3.3 Slew Cost and Scheduling

When allocating a new window to a target the station has not recently served, the slew cost is:

```
slewCost = angularDistance(lastTarget → newTarget) × slewRateSecPerDeg
```

The scheduler must ensure `losRemaining ≥ windowDuration + slewCost` before committing a window.  If not, the message is deferred.

**Piggyback preference:** If a conduit is already in an open session with the desired target, new messages are appended to that session with zero slew cost (the conduit is already pointing the right way).

---

## 4. Regular Bridge Communications — The Check-In Cycle

### 4.1 Cadence

Each station pair has a configured **effective cadence** = `min(A.baseCadenceSeconds, B.baseCadenceSeconds)`.  High-traffic stations (near Sol) check in frequently (10–30 s); remote stations less often (1–5 min).

A check-in is triggered when:
- `simTime − lastCheckin[neighbour] ≥ effectiveCadence`, **and**
- The bridge currently has LOS (otherwise defer until LOS is restored), **and**
- A conduit is free to aim at the neighbour (or the existing session can be extended).

When LOS is restored after an occlusion, a check-in should be attempted **immediately** (cadence timer reset).

### 4.2 What a Check-In Carries

A check-in is a bidirectional exchange.  The initiating station opens a session and sends:

1. **UST timestamp** — receiver uses to correct its local clock.
2. **Queue depth + reserve fraction** — so the neighbour knows if this station can accept incoming transits.
3. **Manifest delta** — any new items in the outbound queue destined for or passing through the neighbour, with their priorities and estimated window needs.
4. **Local disturbance updates** — vessels in-system, any anomalies that could cause unscheduled occlusions.
5. **Schedule proposals** — proposed windows for upcoming transits (see §5).

The receiving station responds with its own payload (same structure) before the session closes.  The session closes when both sides have sent an "end" subject marker.

### 4.3 Session Multiplexing

A single conduit session can carry multiple independent **subjects**.  Each subject has its own open/close markers.  The channel stays open until all subjects are closed.  A new subject can be injected before the close sequence is sent, extending the session without a slew.

---

## 5. Transit Scheduling Protocol

### 5.1 Local Transit (Direct Bridge)

A→B, single hop:

1. A has a message for B.  B is in A's direct-bridge set.
2. A checks `losRemaining(A,B) ≥ windowDuration + slewCost`.  If not, defers.
3. A finds the best available conduit (prefer already-aimed, then idle, then soonest-free).
4. A allocates a window: `[now + slewCost, now + slewCost + windowDuration]`.
5. The window is confirmed.  The conduit is locked.  The message is dispatched at `startSec`.
6. Travel time = `bridgeLength / signalSpeed`.  Message is delivered when `now ≥ startSec + travelTime`.

### 5.2 Relay (Multi-Hop) Transit

A→B→C (A cannot directly reach C):

1. A's path resolver (BFS over the structural bridge graph) finds path `[A, B, C]`.
2. A schedules hop A→B as above.
3. When the message arrives at B, B **re-enqueues** it with destination C.  B resolves its own path from B to C (BFS).  This ensures re-routing if topology has changed since A sent.
4. B schedules hop B→C independently.

**Coordination via check-in (proactive scheduling):**  Rather than waiting for arrival, A can ask B during a check-in session: *"I have a message for C arriving in approximately T seconds; can you hold a B→C window at T + processing?"*  B responds with a confirmed or adjusted window.  This is the `multi_hop_coordination` message type.  When used, relay latency is reduced to near `sum(transit times + slew costs)` rather than `sum(transit times + wait-for-B-to-schedule)`.

### 5.3 Priority Ordering

| Priority | Behaviour |
|---|---|
| P1 Emergency | Injected into any open session immediately; if no session is active, forces earliest possible slew regardless of queue |
| P2 Urgent | Sorted before P3–P5; may preempt P4/P5 scheduled windows if slew cost is zero |
| P3 Standard | Default; scheduled in arrival order within priority class |
| P4 Low | Deferred to next available window after P1–P3 are cleared |
| P5 Background | Opportunistic; dispatched only during confirmed idle windows |

The scheduler processes the outbound queue **sorted by priority then creation time** on every tick.

---

## 6. Batching and Piggybacking

**Batching:** Multiple messages to the same destination are grouped into a single session window.  When a conduit is already aimed at target B, any message queued for B is appended to the existing session at zero additional slew cost.  The window is extended by `sum(windowDurations)` for all batched messages.

**Piggybacking:** Messages destined for C via B can be appended to an existing A→B session if B is the next hop for C.  This saves a slew for each additional message.

**End-of-session protocol:**  A session closes when both sides confirm their outbound queues for each other are empty (both send "end" subjects).  If a new high-priority message arrives before "end" is sent, it is injected as a new subject rather than waiting for a new session (which would require a slew away and back).

---

## 7. Gap Analysis — Simulation vs. Protocol

The following gaps exist between the above protocol and the current simulation implementation:

### GAP 1 — Check-ins only fire when background signals are enabled
**Protocol:** Check-ins are a fundamental operating behaviour of every station.  They are not optional.  
**Simulation:** `Queue.tick` wraps the entire check-in generation block in `if (Sim.settings.backgroundSignals.enabled)`.  With background signals off, no check-ins are generated at all.  
**Fix required:** Move check-in generation to always run.  Make the `enabled` flag only control the *background random traffic* (`BgGen`), not the operational check-ins.

### GAP 2 — No immediate reconnect after LOS restoration
**Protocol:** When LOS is restored after an occlusion, a check-in should be attempted immediately, not waiting for the cadence timer.  
**Simulation:** `lastCheckin[nid]` is set when a check-in is *enqueued*.  After an occlusion, the timer was already set and will run to its normal next-fire time.  
**Fix required:** When `bridge.los` transitions from `false → true` (in `tickUpdateLOS`), reset `lastCheckinByNeighbour[partner]` to force immediate retry.

### GAP 3 — Mutual conduit pointing not enforced
**Protocol:** A bridge requires both stations' conduits to point at each other simultaneously for the full session duration.  
**Simulation:** Only the *initiating* station allocates a conduit window.  The receiving station has no corresponding window allocated, no conduit locked, and nothing preventing it from pointing that conduit elsewhere during the same period.  
**Fix required:** When station A allocates a window for target B, A must also request (or reserve) a corresponding window on B's conduit pointing back at A.  In practice, this can be modelled as: the scheduler checks that B has a free conduit during the proposed window before confirming A's window.  If B has no free conduit, the window is deferred.

### GAP 4 — Path resolved at source, not re-resolved at each relay
**Protocol:** Each relay station should re-resolve the path from its own position.  
**Simulation:** The path is resolved at source station A using BFS, and the full path array is carried on the message.  When it arrives at relay B, B enqueues a *new* message with `path = null`, which will be re-resolved by BFS from B.  
**Status:** This is currently **correct** — relay enqueue sets `path: null`.  ✓

### GAP 5 — No proactive multi-hop coordination
**Protocol:** A should be able to ask B to hold a future B→C window while a payload is in transit A→B, reducing relay latency.  
**Simulation:** Relay scheduling is entirely reactive: the message must arrive at B before B begins scheduling B→C.  
**Fix required:** Implement `multi_hop_coordination` message type — sent by A to B during a check-in session, carrying the expected arrival time and destination.

### GAP 6 — Session multiplexing not fully modelled
**Protocol:** Multiple subjects share a single open session; new subjects can be injected before close.  
**Simulation:** Windows are allocated per-message, but the session-level "subjects" abstraction doesn't exist.  The piggybacking logic (conduit already aimed at target) is correctly modelled, but the concept of a named session with multiple subjects and an "all-closed" termination is not.  
**Status:** Piggybacking works correctly.  Full subject multiplexing is an enhancement, not a correctness bug.

### GAP 7 — LOS cache uses old `Physics.losRemainingSeconds` not the new analytical version for all stars
**Protocol:** LOS remaining should account for *all* potentially-occluding bodies.  
**Simulation:** `losRemainingSeconds` calls `_losRemainingForStation` which only considers the two host stars (derived analytically from `shadowArcDeg`).  The `hasLOS` function correctly uses `bridge.occluderStars` (which is the right precomputed subset).  However, for the LOS *remaining* calculation, third-body occlusions are not considered.  
**Status:** In practice, third-body occlusions between two stations orbiting different stars at 0.03 AU are geometrically negligible and will be caught by `hasLOS` dropping the bridge when they occur.  Acceptable for current purposes.

---

## 8. Summary of Required Fixes

| # | Issue | Severity |
|---|---|---|
| 1 | Check-ins gated by background signal toggle | **High** — operational check-ins should always run |
| 2 | No immediate reconnect after LOS restoration | **Medium** — causes unnecessary delay after occlusion ends |
| 3 | Mutual conduit pointing not enforced | **Medium** — receiving station conduit is not modelled as locked |
| 5 | No proactive multi-hop coordination | **Low** — increases relay latency but messages still arrive |
| 6 | Session subject multiplexing incomplete | **Low** — piggybacking works; full abstraction is an enhancement |
| 7 | LOS remaining ignores third-body occlusions | **Negligible** — caught by real-time hasLOS check |
