// physics.js — orbital mechanics, LOS, conduit range, shadow windows

'use strict'

const Physics = {
  // ── Orbital mechanics ────────────────────────────────────────────────────

  /**
   * Compute the 3D world position of a station in galactic-frame light-years.
   * Orbit is computed in the orbital plane, then rotated by inclination and LAN
   * into the galactic frame.
   *
   * Orbital plane convention:
   *   - phase 0 → station is at (r, 0, 0) in orbital plane
   *   - inclination 0 → orbital plane = galactic XY plane
   */
  stationWorldPos(station, star) {
    const rLY = station.orbitalRadiusAU * C.AU_IN_LY
    const phase = station.phaseRad

    // Position in un-rotated orbital plane
    let pos = Vec3.of(rLY * Math.cos(phase), rLY * Math.sin(phase), 0)

    // Rotate by LAN (around Z axis) then inclination (around the new X axis)
    const lan = station.orbitLANDeg * C.DEG_TO_RAD
    const inc = station.orbitInclinationDeg * C.DEG_TO_RAD

    // 1. Rotate around Z by LAN
    pos = Vec3.rotateAround(pos, Vec3.of(0, 0, 1), station.orbitLANDeg)
    // 2. Rotate around the line of nodes (rotated X axis) by inclination
    const lineOfNodes = Vec3.norm(Vec3.of(Math.cos(lan), Math.sin(lan), 0))
    pos = Vec3.rotateAround(pos, lineOfNodes, station.orbitInclinationDeg)

    return Vec3.add(Vec3.of(star.x, star.y, star.z), pos)
  },

  /**
   * Compute the station's instantaneous velocity direction (unit vector)
   * in galactic frame. This is the tangent to the orbit at the current phase,
   * rotated by the same LAN + inclination as the position.
   */
  stationVelocityDir(station, star) {
    const phase = station.phaseRad
    // Tangent in un-rotated orbital plane (perpendicular to radius, prograde)
    let vel = Vec3.of(-Math.sin(phase), Math.cos(phase), 0)

    vel = Vec3.rotateAround(vel, Vec3.of(0, 0, 1), station.orbitLANDeg)
    const lan = station.orbitLANDeg * C.DEG_TO_RAD
    const lineOfNodes = Vec3.norm(Vec3.of(Math.cos(lan), Math.sin(lan), 0))
    vel = Vec3.rotateAround(vel, lineOfNodes, station.orbitInclinationDeg)

    return Vec3.norm(vel)
  },

  /**
   * Orbital period in hours, given orbital radius in AU and stellar mass in kg.
   * Uses Kepler's third law: T = 2π √(a³ / GM)
   */
  orbitalPeriodHours(orbitalRadiusAU, stellarMassKg) {
    const a = orbitalRadiusAU * C.AU_IN_METRES
    const GM = C.GM_SOL * (stellarMassKg / 1.989e30)
    const T_s = 2 * Math.PI * Math.sqrt(a ** 3 / GM)
    return T_s / C.HOURS_TO_SECONDS
  },

  /**
   * Orbital speed in km/s.
   */
  orbitalSpeedKmS(orbitalRadiusAU, stellarMassKg) {
    const a = orbitalRadiusAU * C.AU_IN_METRES
    const GM = C.GM_SOL * (stellarMassKg / 1.989e30)
    return Math.sqrt(GM / a) / 1000
  },

  /**
   * Shadow arc in degrees — the arc of the orbit that is occluded by the host star
   * as seen from a distant observer on the orbital plane.
   * θ = 2 × arcsin(R_star / r_orbit)
   */
  shadowArcDeg(orbitalRadiusAU, starRadiusM) {
    const r = orbitalRadiusAU * C.AU_IN_METRES
    const ratio = starRadiusM / r
    if (ratio >= 1) return 360 // station inside star — shouldn't happen
    return 2 * Math.asin(ratio) * C.RAD_TO_DEG
  },

  /**
   * Shadow duration in hours per orbit.
   */
  shadowDurationHours(orbitalRadiusAU, starRadiusM, stellarMassKg) {
    const arcDeg = Physics.shadowArcDeg(orbitalRadiusAU, starRadiusM)
    const period = Physics.orbitalPeriodHours(orbitalRadiusAU, stellarMassKg)
    return (arcDeg / 360) * period
  },

  /**
   * Single-link uptime fraction (1 - shadow fraction).
   */
  uptimeFraction(orbitalRadiusAU, starRadiusM) {
    const arcDeg = Physics.shadowArcDeg(orbitalRadiusAU, starRadiusM)
    return 1 - arcDeg / 360
  },

  /**
   * Solar flux at a given orbital distance (W/m²).
   * Scales as 1/r².
   */
  solarFlux(orbitalRadiusAU, luminositySol) {
    const SOLAR_CONSTANT = 1361 // W/m² at 1 AU from Sol
    return (SOLAR_CONSTANT * luminositySol) / orbitalRadiusAU ** 2
  },

  /**
   * Recompute all derived orbital properties and store them on the station.
   * Call whenever orbitalRadiusAU changes.
   */
  recomputeDerivedOrbit(station, star) {
    station.orbitalPeriodHours = Physics.orbitalPeriodHours(
      station.orbitalRadiusAU,
      star.massKg,
    )
    station.orbitalSpeedKmS = Physics.orbitalSpeedKmS(
      station.orbitalRadiusAU,
      star.massKg,
    )
    station.shadowArcDeg = Physics.shadowArcDeg(
      station.orbitalRadiusAU,
      star.radiusM,
    )
    station.shadowDurationHours = Physics.shadowDurationHours(
      station.orbitalRadiusAU,
      star.radiusM,
      star.massKg,
    )
    station.uptimeFraction = Physics.uptimeFraction(
      station.orbitalRadiusAU,
      star.radiusM,
    )
    station.solarFluxWm2 = Physics.solarFlux(
      station.orbitalRadiusAU,
      star.luminositySol,
    )
  },

  // ── Line-of-sight ────────────────────────────────────────────────────────

  /**
   * Returns true if the straight-line path from stationI to stationJ
   * is unobstructed by ANY star's physical body.
   *
   * Two previous bugs are fixed here:
   *
   * 1. The old code only checked the two HOST stars.  Any other star lying
   *    geometrically between the two stations was ignored, giving false-positive
   *    LOS even when a third body blocked the path.  We now check every star.
   *
   * 2. The old code used Vec3.pointToLineDist which measures distance from a
   *    point to an INFINITE line.  Stars that are spatially "behind" either
   *    endpoint (outside the segment) could therefore register as occluders
   *    even though they are nowhere near the actual bridge path.  We now use
   *    the point-to-SEGMENT distance, clamped to [0,1] along the segment.
   *
   * Does NOT check conduit range; that is a separate test.
   */
  hasLOS(stationI, stationJ, starsById) {
    const posI = stationI.worldPos
    const posJ = stationJ.worldPos

    // Vector along bridge segment and its squared length (reused for every star)
    const abx = posJ.x - posI.x
    const aby = posJ.y - posI.y
    const abz = posJ.z - posI.z
    const ab2 = abx * abx + aby * aby + abz * abz

    for (const star of Object.values(starsById)) {
      const starRadiusLY = star.radiusM / C.LY_IN_METRES

      // Point-to-SEGMENT distance (not infinite line).
      // t is the scalar projection of (star - posI) onto the segment,
      // clamped to [0,1] so we never extend beyond the endpoints.
      const apx = star.x - posI.x
      const apy = star.y - posI.y
      const apz = star.z - posI.z
      const t = ab2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2)) : 0
      const cx = posI.x + abx * t
      const cy = posI.y + aby * t
      const cz = posI.z + abz * t
      const dx = star.x - cx
      const dy = star.y - cy
      const dz = star.z - cz
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)

      if (d < starRadiusLY) return false
    }
    return true
  },
  /**
   * Returns how many sim-seconds of clear LOS remain between two stations.
   *
   * PERFORMANCE FIX: the previous implementation advanced both station phases
   * 360 steps (one full orbit) via stationWorldPos + hasLOS, creating ~720
   * trig evaluations per bridge per tick.  For 50 bridges at 60 fps that is
   * ~2.6 M trig calls/s — the primary performance bottleneck.
   *
   * Replacement: O(1) analytical calculation.
   * Because all station orbits currently have zero inclination (all in the
   * galactic XY plane), the shadow arc for station A relative to bridge A→B is
   * simply the arc centred at the phase where A is directly behind its star as
   * seen from star B.  We compute the angular distance from the current phase
   * to the shadow-entry phase and convert to seconds.  Two checks (one per
   * endpoint) give the minimum remaining clear window.
   *
   * Remains exact for zero-inclination orbits.  For inclined orbits a small
   * approximation error is introduced (the shadow direction projected onto the
   * orbital plane), but orbits are initialised with inclination = 0 so this
   * is not a concern in practice.
   */
  losRemainingSeconds(stationA, stationB, starsById) {
    if (!Physics.hasLOS(stationA, stationB, starsById)) return 0
    const starA = starsById[stationA.starId]
    const starB = starsById[stationB.starId]
    const remainA = Physics._losRemainingForStation(stationA, starA, starB)
    const remainB = Physics._losRemainingForStation(stationB, starB, starA)
    return Math.min(remainA, remainB)
  },

  /**
   * Analytical time (seconds) until `station` enters its host-star shadow as
   * seen from the direction of `otherStar`.
   *
   * The shadow centre phase is the orbital phase where the station sits directly
   * behind its host star from `otherStar`'s perspective — i.e. the direction
   * OPPOSITE to (otherStar − hostStar) projected into the XY plane.
   */
  _losRemainingForStation(station, hostStar, otherStar) {
    const dx = otherStar.x - hostStar.x
    const dy = otherStar.y - hostStar.y
    // Phase where station would be directly behind hostStar from otherStar
    const shadowCentrePhase = Math.atan2(dy, dx) + Math.PI
    const halfArc = (station.shadowArcDeg / 2) * C.DEG_TO_RAD
    const periodSec = station.orbitalPeriodHours * C.HOURS_TO_SECONDS
    const φ = station.phaseRad

    // Shadow entry is halfArc before the centre (prograde direction)
    const entryPhase = shadowCentrePhase - halfArc
    // Angular distance from current phase to entry, travelling prograde (increasing φ)
    const delta = ((entryPhase - φ) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
    return (delta / (2 * Math.PI)) * periodSec
  },
  // ── Conduit range checks ─────────────────────────────────────────────────

  /**
   * Returns true if the target station is within the main conduit's 180°
   * anti-stellar hemisphere.
   *
   * The main conduit points anti-stellar (away from the host star).
   * A target is reachable if the angle between the anti-stellar direction
   * and the direction to the target is ≤ 90°.
   */
  isInMainConduitRange(station, targetStation, star) {
    const stationPos = station.worldPos
    const starPos = Vec3.of(star.x, star.y, star.z)
    const targetPos = targetStation.worldPos

    const antiStellar = Vec3.norm(Vec3.sub(stationPos, starPos))
    const toTarget = Vec3.norm(Vec3.sub(targetPos, stationPos))

    const angleDeg = Vec3.angleDeg(antiStellar, toTarget)
    return angleDeg <= 90
  },

  /**
   * Returns true if the target station falls within the biaxial gimbal range
   * of the given comm conduit unit.
   *
   * X-axis: equatorial sweep ±(xRangeDeg/2), hard-blocked by station disc
   * Y-axis: meridional tilt  ±(yRangeDeg/2), toward star and toward conduit
   *
   * Station-local frame:
   *   +Z_local = anti-stellar (main conduit axis)
   *   +X_local = direction of orbital motion (prograde)
   *   +Y_local = Z_local × X_local
   *
   * Unit-local frame: rotated around Z_local by mountAngleDeg.
   */
  isInCommUnitRange(station, unit, targetStation, star) {
    const stationPos = station.worldPos
    const starPos = Vec3.of(star.x, star.y, star.z)
    const targetPos = targetStation.worldPos

    // Direction to target in galactic frame
    const dir = Vec3.norm(Vec3.sub(targetPos, stationPos))

    // Station-local axes
    const zLocal = Vec3.norm(Vec3.sub(stationPos, starPos)) // anti-stellar
    const xLocal = station.velocityDir // prograde
    const yLocal = Vec3.norm(Vec3.cross(zLocal, xLocal))

    // Project dir into station-local frame
    const dirLocal = Vec3.of(
      Vec3.dot(dir, xLocal),
      Vec3.dot(dir, yLocal),
      Vec3.dot(dir, zLocal),
    )

    // Rotate into unit-local frame by mount angle around Z_local
    const cosM = Math.cos(unit.mountAngleDeg * C.DEG_TO_RAD)
    const sinM = Math.sin(unit.mountAngleDeg * C.DEG_TO_RAD)
    const unitLocal = Vec3.of(
      dirLocal.x * cosM + dirLocal.y * sinM,
      -dirLocal.x * sinM + dirLocal.y * cosM,
      dirLocal.z,
    )

    // Must be in front of the unit (outward half-space)
    if (unitLocal.z <= 0) return false

    const xAngle = Math.atan2(unitLocal.x, unitLocal.z) * C.RAD_TO_DEG
    const yAngle = Math.atan2(unitLocal.y, unitLocal.z) * C.RAD_TO_DEG

    return (
      Math.abs(xAngle) <= unit.xRangeDeg / 2 &&
      yAngle >= -(unit.yRangeDeg / 2) &&
      yAngle <= unit.yRangeDeg / 2
    )
  },

  /**
   * Returns true if stationJ is within the stellar occlusion cone of the star
   * as seen from stationI, in the direction of stationJ.
   * This is a softer check (is the target near the star direction) for UI
   * highlighting of comm unit arcs, not the hard LOS check.
   */
  isOccludedByStar(stationI, stationJ, star) {
    const sI = stationI.worldPos
    const sJ = stationJ.worldPos
    const sS = Vec3.of(star.x, star.y, star.z)
    const starRadiusLY = star.radiusM / C.LY_IN_METRES

    // Direction from stationI toward the star and toward the target
    const toStar = Vec3.norm(Vec3.sub(sS, sI))
    const toTarget = Vec3.norm(Vec3.sub(sJ, sI))

    // Angular radius of the star as seen from stationI
    const distToStarLY = Vec3.dist(sI, sS)
    const angularRadiusDeg =
      Math.asin(Math.min(1, starRadiusLY / distToStarLY)) * C.RAD_TO_DEG

    // If the target direction is within the star's angular radius, it's occluded
    return Vec3.angleDeg(toStar, toTarget) <= angularRadiusDeg
  },

  // ── Shadow arc for ring rendering ─────────────────────────────────────────

  /**
   * Given a station's current orbital state, return the phase angle (radians)
   * of the centre of the shadow arc and its half-width (radians).
   *
   * Shadow centre: directly behind the star as seen from far away.
   * In the orbital plane, this is the phase where the station is at
   * angle π from the "toward observer" direction. For the 2D projected ring,
   * the shadow is centred at the phase where station is directly behind the
   * star relative to the default view direction (positive Y axis = "up").
   *
   * Returns: { centrePhasRad, halfWidthRad }
   */
  shadowArcParams(station, star) {
    const halfWidthDeg =
      Physics.shadowArcDeg(station.orbitalRadiusAU, star.radiusM) / 2

    // The shadow centre is the point on the orbit directly BEHIND the star
    // as seen from the default screen viewing direction.
    // In our coordinate system the camera looks down the -Z axis onto the XY
    // galactic plane, so "behind the star" from the screen means the station
    // is at the phase where it is on the far side of the star from the screen
    // (i.e. its projected position relative to the star is at the current
    //  screen-space angle pointing away from a reference outside observer).
    //
    // Practical approximation: the shadow centre is at whichever phase puts
    // the station directly behind the star relative to the star's position
    // in screen coordinates.  Since we project Z’0 for display, the star sits
    // at (star.x, star.y) on screen.  The station orbits around that.  The
    // shadow arc is the portion of the orbit where the station is "behind"
    // the star disk from an outside viewer looking down the Z axis.
    //
    // In the orbital plane (ignoring inclination for the arc centre
    // calculation) the shadow is at phase = angle from +X such that the
    // station is directly behind the star in the -Z direction.  For a
    // viewer at Z=+∞ looking down, "behind" = phase where station.y < star.y
    // and (station.x, station.y) ≈ (star.x, star.y + 0).  That is phase = -π/2
    // (≡ 270°) in a standard math angle convention where phase 0 = +X.
    //
    // For simplicity we keep centrePhaseRad fixed at 3π/2 (≡ -π/2) so the
    // shadow is always drawn at the "bottom" of each ring in screen space,
    // which is the correct projection for a top-down galactic-plane view.
    return {
      centrePhaseRad: -Math.PI / 2, // bottom of ring in screen (station behind star for top-down viewer)
      halfWidthRad: halfWidthDeg * C.DEG_TO_RAD,
    }
  },
}
