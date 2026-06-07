// renderer.js — canvas drawing: stars, rings, arcs, bridge lines, station dots

'use strict'

const Renderer = {
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,

  // Viewport transform: galactic LY → canvas pixels
  // origin is the canvas centre; scale is pixels per LY
  scale: C.INITIAL_SCALE_PX_PER_LY,
  offsetX: 0, // pan offset in pixels
  offsetY: 0,

  // Pan drag state
  _dragging: false,
  _dragStart: null,

  init() {
    this.canvas = document.getElementById('map-canvas')
    this.ctx = this.canvas.getContext('2d')
    this._resize()
    window.addEventListener('resize', () => this._resize())

    // Pan with mouse drag
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e))
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e))
    this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e))
    this.canvas.addEventListener('mouseleave', (e) => this._onMouseUp(e))

    // Zoom with scroll wheel
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), {
      passive: false,
    })

    // Click to select station
    this.canvas.addEventListener('click', (e) => this._onClick(e))
  },

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect()
    this.canvas.width = rect.width
    this.canvas.height = rect.height
    this.width = this.canvas.width
    this.height = this.canvas.height
  },

  // ── Coordinate transforms ─────────────────────────────────────────────

  /** Galactic LY {x, y} → canvas pixel {x, y} */
  lyToCanvas(lx, ly) {
    return {
      x: this.width / 2 + this.offsetX + lx * this.scale,
      y: this.height / 2 + this.offsetY - ly * this.scale, // Y axis up
    }
  },

  /** Canvas pixel → galactic LY */
  canvasToLy(cx, cy) {
    return {
      x: (cx - this.width / 2 - this.offsetX) / this.scale,
      y: -(cy - this.height / 2 - this.offsetY) / this.scale,
    }
  },

  // ── Main draw ─────────────────────────────────────────────────────────

  draw() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.height)

    // 1. Background
    ctx.fillStyle = C.COL_BACKGROUND
    ctx.fillRect(0, 0, this.width, this.height)

    // 2. Inactive bridge lines
    this._drawBridgeLines(false)

    // 3. Active bridge lines
    this._drawBridgeLines(true)

    // 4. Planned multi-hop path lines
    this._drawPlannedPaths()

    // 5. Orbital rings + visibility arcs
    for (const station of Object.values(Sim.stations)) {
      if (this.analysisModePath && !this.analysisModePath.includes(station.id))
        continue
      this._drawOrbitRing(station)
    }

    // 6. Stars
    for (const star of Object.values(Sim.stars)) {
      if (this.analysisModePath) {
        const hasStationOnPath = this.analysisModePath.some(
          (id) => Sim.stations[id]?.starId === star.id,
        )
        if (!hasStationOnPath) continue
      }
      this._drawStar(star)
    }

    // 7. Station dots + conduit beam indicators
    for (const station of Object.values(Sim.stations)) {
      if (this.analysisModePath && !this.analysisModePath.includes(station.id))
        continue
      this._drawStation(station)
    }

    // 8. In-transit signals
    this._drawSignals()

    // 9. Legend (always on top-left)
    this._drawLegend()
  },

  // ── In-transit comm signals ────────────────────────────────────────

  _drawSignals() {
    const ctx = this.ctx
    for (const sig of Sim.signals) {
      if (this.analysisModePath) {
        if (
          !this.analysisModePath.includes(sig.fromId) ||
          !this.analysisModePath.includes(sig.toId)
        )
          continue
      }
      // Use current screen-space positions of the station dots so the travelling
      // dot stays on the visible bridge line even as stations orbit.
      const fromSt = Sim.stations[sig.fromId]
      const toSt = Sim.stations[sig.toId]
      if (!fromSt || !toSt) continue
      const pFrom = this._stationScreenPos(fromSt)
      const pTo = this._stationScreenPos(toSt)
      const t = sig.t
      const p = {
        x: pFrom.x + (pTo.x - pFrom.x) * t,
        y: pFrom.y + (pTo.y - pFrom.y) * t,
      }
      const coreCol = C.SIGNAL_COLORS[sig.type] ?? C.COL_SIGNAL_COMM
      const glowCol = C.SIGNAL_GLOW_COLORS[sig.type] ?? 'rgba(0,220,255,0.4)'
      // Glow
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7)
      g.addColorStop(0, glowCol.replace('0.5', '0.8'))
      g.addColorStop(1, glowCol.replace('0.5', '0'))
      ctx.beginPath()
      ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI)
      ctx.fillStyle = g
      ctx.fill()
      // Core
      ctx.beginPath()
      ctx.arc(p.x, p.y, 2, 0, 2 * Math.PI)
      ctx.fillStyle = coreCol
      ctx.fill()
    }
  },

  // ── Planned path lines ─────────────────────────────────────────

  _drawPlannedPaths() {
    const ctx = this.ctx
    const seen = new Set()
    for (const msg of Sim.messages) {
      if (!msg.path || msg.path.length < 2) continue
      if (msg.status === 'delivered' || msg.status === 'failed') continue

      if (this.analysisModePath) {
        // In analysis mode, only show the path if it matches the active path
        const matches =
          msg.path.length === this.analysisModePath.length &&
          msg.path.every((v, i) => v === this.analysisModePath[i])
        if (!matches) continue
      }

      const isHighlighted = msg.id === UI._highlightedMsgId
      ctx.save()
      ctx.setLineDash(isHighlighted ? [6, 3] : [4, 5])
      ctx.strokeStyle = isHighlighted
        ? 'rgba(100,160,255,0.95)'
        : C.COL_PATH_PLANNED
      ctx.lineWidth = isHighlighted ? 2 : 1
      for (let i = 0; i < msg.path.length - 1; i++) {
        const key = msg.id + ':' + i // per-message segment key so overlapping paths both show
        if (seen.has(key)) continue
        seen.add(key)
        const sA = Sim.stations[msg.path[i]]
        const sB = Sim.stations[msg.path[i + 1]]
        if (!sA || !sB) continue
        const pA = this._stationScreenPos(sA)
        const pB = this._stationScreenPos(sB)
        ctx.beginPath()
        ctx.moveTo(pA.x, pA.y)
        ctx.lineTo(pB.x, pB.y)
        ctx.stroke()
      }
      ctx.restore()
    }
  },

  // ── Legend ─────────────────────────────────────────────────────

  _drawLegend() {
    const ctx = this.ctx
    const entries = [
      { col: C.COL_BRIDGE_ACTIVE, label: 'Bridge (LOS clear)' },
      { col: C.COL_BRIDGE_INACTIVE, label: 'Bridge (occluded)' },
      { col: C.COL_PATH_PLANNED, label: 'Planned path', dash: true },
      { col: C.COL_ARC_VISIBLE, label: 'Visible arc' },
      { col: C.COL_ARC_SHADOW, label: 'Shadow arc' },
      { col: C.COL_BEAM_MAIN, label: 'Main conduit dir' },
      ...Object.entries(C.SIGNAL_COLORS).map(([type, col]) => ({
        col,
        label: type.replace(/_/g, ' '),
        dot: true,
      })),
    ]

    const x0 = 8,
      y0 = 8,
      lineH = 16,
      swatchW = 18
    ctx.font = '10px monospace'
    ctx.textBaseline = 'middle'
    let y = y0
    for (const e of entries) {
      ctx.save()
      if (e.dot) {
        ctx.beginPath()
        ctx.arc(x0 + swatchW / 2, y + lineH / 2, 4, 0, 2 * Math.PI)
        ctx.fillStyle = e.col
        ctx.fill()
      } else {
        if (e.dash) ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(x0, y + lineH / 2)
        ctx.lineTo(x0 + swatchW, y + lineH / 2)
        ctx.strokeStyle = e.col
        ctx.lineWidth = e.dot ? 1 : 1.5
        ctx.stroke()
      }
      ctx.restore()
      ctx.fillStyle = 'rgba(200,200,220,0.75)'
      ctx.fillText(e.label, x0 + swatchW + 4, y + lineH / 2)
      y += lineH
    }
  },

  // ── Zoom to fit ────────────────────────────────────────────────

  zoomToFit() {
    // Fit to active (in-range) stars only; fall back to all stars if none are active
    const limit = Sim.settings.displayDistanceLY
    const active = Object.values(Sim.stars).filter(
      (s) => (s.distLY ?? 0) <= limit,
    )
    const stars = active.length > 0 ? active : Object.values(Sim.stars)
    this._zoomToStars(stars)
  },

  zoomToPath(path) {
    if (!path || path.length === 0) return
    const stars = path
      .map((stId) => Sim.stars[Sim.stations[stId]?.starId])
      .filter(Boolean)
    this._zoomToStars(stars)
  },

  _zoomToStars(stars) {
    if (stars.length === 0) return
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (const s of stars) {
      minX = Math.min(minX, s.x)
      maxX = Math.max(maxX, s.x)
      minY = Math.min(minY, s.y)
      maxY = Math.max(maxY, s.y)
    }
    const padFrac = 0.15
    const spanX = maxX - minX || 0.1
    const spanY = maxY - minY || 0.1
    const scaleX = (this.width * (1 - 2 * padFrac)) / spanX
    const scaleY = (this.height * (1 - 2 * padFrac)) / spanY
    this.scale = Math.max(5, Math.min(500, Math.min(scaleX, scaleY)))
    this.offsetX = -(((minX + maxX) / 2) * this.scale)
    this.offsetY = ((minY + maxY) / 2) * this.scale
    this.draw()
  },

  // ── Bridge lines ──────────────────────────────────────────────────────

  // ── Bridge line LOS flicker buffer ────────────────────────────────────
  // Maps bridgeId → real-time timestamp (ms) when LOS was last seen as true.
  // A bridge only renders dim after its LOS has been consistently false for
  // LOS_FLICKER_MS milliseconds of real time, preventing single-frame flicker.
  _losLastSeen: {},
  _LOS_FLICKER_MS: 120, // ~2 frames at 60fps real time; adjust if needed

  _isBridgeVisuallyActive(bridge) {
    if (bridge.los) {
      this._losLastSeen[bridge.id] = Date.now()
      return true
    }
    const last = this._losLastSeen[bridge.id] ?? 0
    return Date.now() - last < this._LOS_FLICKER_MS
  },

  _drawBridgeLines(activeOnly) {
    const ctx = this.ctx
    // Build a set of bridge IDs that currently have a signal in flight
    const bridgesWithSignal = new Set()
    for (const sig of Sim.signals) {
      const key1 = sig.fromId + '|' + sig.toId
      const key2 = sig.toId + '|' + sig.fromId
      if (Sim.bridges[key1]) bridgesWithSignal.add(key1)
      if (Sim.bridges[key2]) bridgesWithSignal.add(key2)
    }

    for (const bridge of Object.values(Sim.bridges)) {
      // Filter by analysis path
      if (this.analysisModePath) {
        const idxA = this.analysisModePath.indexOf(bridge.stationAId)
        const idxB = this.analysisModePath.indexOf(bridge.stationBId)
        const onPath =
          idxA !== -1 && idxB !== -1 && Math.abs(idxA - idxB) === 1
        if (!onPath) continue
      }

      // A bridge renders as "active" (bright) if it has LOS OR a signal is
      // currently in flight along it — never dim a line under a moving dot.
      // Also apply a short flicker buffer so rapid single-tick LOS drops don't flash.
      const hasSignal = bridgesWithSignal.has(bridge.id)
      const isActive = this._isBridgeVisuallyActive(bridge) || hasSignal
      if (activeOnly !== isActive) continue

      const hasCommSession =
        bridge.los && this._bridgeHasActiveCommSession(bridge)
      const hasMainSession = bridge.los && bridge.status === 'active'

      // Apply filter
      if (this.bridgeFilter === 'comm' && !hasCommSession) continue
      if (this.bridgeFilter === 'main' && !hasMainSession) continue

      const sA = Sim.stations[bridge.stationAId]
      const sB = Sim.stations[bridge.stationBId]
      const pA = this._stationScreenPos(sA)
      const pB = this._stationScreenPos(sB)

      ctx.beginPath()
      ctx.moveTo(pA.x, pA.y)
      ctx.lineTo(pB.x, pB.y)
      ctx.strokeStyle = isActive ? C.COL_BRIDGE_ACTIVE : C.COL_BRIDGE_INACTIVE
      ctx.lineWidth = hasMainSession ? 2 : 1
      ctx.stroke()

      // Cyan overlay for active comm sessions
      if (hasCommSession) {
        ctx.beginPath()
        ctx.moveTo(pA.x, pA.y)
        ctx.lineTo(pB.x, pB.y)
        ctx.strokeStyle = 'rgba(0,200,255,0.35)'
        ctx.lineWidth = 4
        ctx.stroke()
      }
    }
  },

  // Returns true if any comm conduit on either station has an active session with the other
  _bridgeHasActiveCommSession(bridge) {
    const now = Sim.simTimeSec
    const wins = Scheduler._windows
    const check = (stId, targetId) => {
      const st = wins[stId]
      if (!st) return false
      return Object.keys(st)
        .filter((k) => k !== 'main')
        .some((k) =>
          st[k].some(
            (w) =>
              w.targetId === targetId && w.startSec <= now && w.endSec >= now,
          ),
        )
    }
    return (
      check(bridge.stationAId, bridge.stationBId) ||
      check(bridge.stationBId, bridge.stationAId)
    )
  },

  // ── Orbital ring + shadow/visibility arcs ────────────────────────────

  _drawOrbitRing(station) {
    const ctx = this.ctx
    const star = Sim.stars[station.starId]

    const rLY = station.orbitalRadiusAU * C.AU_IN_LY
    const rPx = rLY * this.scale
    const incRad = station.orbitInclinationDeg * C.DEG_TO_RAD

    // Projected semi-axes: semi-major = rPx, semi-minor = rPx * cos(inc)
    const semiMajor = rPx
    const semiMinor = rPx * Math.cos(incRad)

    const starP = this.lyToCanvas(star.x, star.y)

    // Rotation of ellipse around centre = LAN (rotates the tilt axis projection)
    const lanRad = station.orbitLANDeg * C.DEG_TO_RAD

    ctx.save()
    ctx.translate(starP.x, starP.y)
    ctx.rotate(-lanRad) // rotate ellipse by LAN

    // Draw full ring first in ring colour
    ctx.beginPath()
    ctx.ellipse(0, 0, semiMajor, semiMinor, 0, 0, 2 * Math.PI)
    ctx.strokeStyle = C.COL_ORBIT_RING
    ctx.lineWidth = 1
    ctx.stroke()

    // Draw green (visible) arc and red (shadow) arc on top
    const { centrePhaseRad, halfWidthRad } = Physics.shadowArcParams(
      station,
      star,
    )
    const shadowStart = centrePhaseRad - halfWidthRad
    const shadowEnd = centrePhaseRad + halfWidthRad

    // Shadow arc (red)
    ctx.beginPath()
    // ellipse arc: we draw it as if it were a circle then scale Y
    ctx.save()
    ctx.scale(1, semiMinor / semiMajor)
    ctx.arc(0, 0, semiMajor, -shadowEnd, -shadowStart)
    ctx.restore()
    ctx.strokeStyle = C.COL_ARC_SHADOW
    ctx.lineWidth = 3
    ctx.stroke()

    // Visible arc (green) — the rest
    ctx.beginPath()
    ctx.save()
    ctx.scale(1, semiMinor / semiMajor)
    ctx.arc(0, 0, semiMajor, -shadowStart, -shadowEnd)
    ctx.restore()
    ctx.strokeStyle = C.COL_ARC_VISIBLE
    ctx.lineWidth = 3
    ctx.stroke()

    ctx.restore()
  },

  // ── Helpers ──────────────────────────────────────────────

  /** Star pixel radius proportional to physical radius, clamped to display range. */
  _starRadiusPx(star) {
    const r = (star.radiusM / C.SOL_RADIUS_M) * C.STAR_SCREEN_REF_PX
    return Math.max(C.STAR_RADIUS_MIN_PX, Math.min(C.STAR_RADIUS_MAX_PX, r))
  },

  /**
   * Canvas position of a station dot.
   * At interstellar map scale a station’s orbital radius is sub-pixel, so the
   * raw worldPos lands exactly on the star.  This helper guarantees the dot is
   * always at least (starRadius + stationRadius + gap) pixels away from the
   * star centre, in the correct orbital-phase direction.
   */
  _stationScreenPos(station) {
    const star = Sim.stars[station.starId]
    const rawP = this.lyToCanvas(station.worldPos.x, station.worldPos.y)
    const starP = this.lyToCanvas(star.x, star.y)
    const dx = rawP.x - starP.x
    const dy = rawP.y - starP.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const minSep = this._starRadiusPx(star) + C.STATION_DOT_RADIUS_PX + 3
    if (dist >= minSep) return rawP
    // Not far enough — push to minSep in the orbital-phase direction
    // Screen space: canvas-Y = -galactic-Y, so Y direction is flipped
    const ux = dist < 0.5 ? Math.cos(station.phaseRad) : dx / dist
    const uy = dist < 0.5 ? -Math.sin(station.phaseRad) : dy / dist
    return { x: starP.x + ux * minSep, y: starP.y + uy * minSep }
  },

  // ── Stars ─────────────────────────────────────────────────────────────

  _drawStar(star) {
    const ctx = this.ctx
    const p = this.lyToCanvas(star.x, star.y)
    const r = this._starRadiusPx(star)
    const inRange = (star.distLY ?? 0) <= Sim.settings.displayDistanceLY

    ctx.save()
    ctx.globalAlpha = inRange ? 1.0 : 0.25

    // Glow
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.5)
    gradient.addColorStop(0, 'rgba(255,238,68,0.9)')
    gradient.addColorStop(0.4, 'rgba(255,238,68,0.5)')
    gradient.addColorStop(1, 'rgba(255,238,68,0)')
    ctx.beginPath()
    ctx.arc(p.x, p.y, r * 2.5, 0, 2 * Math.PI)
    ctx.fillStyle = gradient
    ctx.fill()

    // Core dot
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI)
    ctx.fillStyle = C.COL_STAR
    ctx.fill()

    // Label — only for in-range stars
    if (inRange) {
      ctx.fillStyle = 'rgba(255,238,68,0.8)'
      ctx.font = '11px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(star.name, p.x, p.y + r + 14)
    }

    ctx.restore()
  },

  // ── Station dots ──────────────────────────────────────────────────────

  _drawStation(station) {
    const ctx = this.ctx
    const p = this._stationScreenPos(station)
    const r = C.STATION_DOT_RADIUS_PX

    // Selection ring
    if (station.selected) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, r + 5, 0, 2 * Math.PI)
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Station dot
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI)
    ctx.fillStyle = station.online ? C.COL_STATION : 'rgba(255,68,68,0.9)'
    ctx.fill()

    // Label (only if zoomed in enough)
    if (this.scale > 20) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = '10px monospace'
      ctx.textAlign = 'left'
      ctx.fillText(station.name, p.x + r + 4, p.y + 4)
    }

    // Active conduit beam indicators on station dot
    // Main conduit: amber spike pointing anti-stellar when a main session is open
    // Comm conduits: cyan arc segments for each active comm session
    if (this.scale > 8) {
      const star = Sim.stars[station.starId]
      const starP = this.lyToCanvas(star.x, star.y)
      const dx = p.x - starP.x
      const dy = p.y - starP.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const ux = dx / d
      const uy = dy / d

      // Main conduit — orange spike when session is live
      const mainSessionActive = this._stationHasMainSession(station)
      if (mainSessionActive) {
        ctx.beginPath()
        ctx.moveTo(p.x + ux * (r + 1), p.y + uy * (r + 1))
        ctx.lineTo(p.x + ux * (r + 11), p.y + uy * (r + 11))
        ctx.strokeStyle = C.COL_BEAM_MAIN
        ctx.lineWidth = 2.5
        ctx.stroke()
      } else if (this.scale > 15) {
        // Dim direction indicator when idle
        ctx.beginPath()
        ctx.moveTo(p.x + ux * (r + 1), p.y + uy * (r + 1))
        ctx.lineTo(p.x + ux * (r + 7), p.y + uy * (r + 7))
        ctx.strokeStyle = 'rgba(255,170,0,0.35)'
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // Comm conduits — cyan arcs for active sessions
      const now = Sim.simTimeSec
      const stWins = Scheduler._windows[station.id]
      if (stWins) {
        for (const key of Object.keys(stWins).filter((k) => k !== 'main')) {
          const active = stWins[key].some(
            (w) => w.startSec <= now && w.endSec >= now,
          )
          if (!active) continue
          const idx = parseInt(key.replace('comm', ''), 10)
          const unit = station.commConduits[idx]
          if (!unit) continue
          const mountRad = unit.mountAngleDeg * C.DEG_TO_RAD
          // In screen space: mount angle is measured from the anti-stellar direction
          // anti-stellar direction in screen = atan2(-uy, ux) but we already have (ux,uy)
          // Comm unit points roughly tangentially, offset by mountAngleDeg from prograde
          const baseAngle = Math.atan2(-uy, ux) // anti-stellar direction in screen
          const unitAngle = baseAngle + Math.PI / 2 + mountRad // tangential + mount
          const arcR = r + 6
          ctx.beginPath()
          ctx.arc(p.x, p.y, arcR, unitAngle - 0.5, unitAngle + 0.5)
          ctx.strokeStyle = C.COL_BEAM_COMM
          ctx.lineWidth = 2.5
          ctx.stroke()
        }
      }
    }
  },

  _stationHasMainSession(station) {
    const now = Sim.simTimeSec
    const wins = Scheduler._windows[station.id]?.main ?? []
    return wins.some((w) => w.startSec <= now && w.endSec >= now)
  },

  // ── Input handlers ────────────────────────────────────────────────────

  _onMouseDown(e) {
    this._dragging = true
    this._dragStart = {
      x: e.clientX - this.offsetX,
      y: e.clientY - this.offsetY,
    }
  },

  _onMouseMove(e) {
    if (!this._dragging) return
    this.offsetX = e.clientX - this._dragStart.x
    this.offsetY = e.clientY - this._dragStart.y
    this.draw()
  },

  _onMouseUp() {
    this._dragging = false
  },

  // Current display filter: 'both' | 'comm' | 'main'
  bridgeFilter: 'both',

  // If set to an array of station IDs, only render those and their connections
  analysisModePath: null,

  _onWheel(e) {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const rect = this.canvas.getBoundingClientRect()
    // Mouse position relative to canvas centre (matches lyToCanvas coordinate space)
    const mx = e.clientX - rect.left - this.width / 2
    const my = e.clientY - rect.top - this.height / 2
    const oldScale = this.scale
    const newScale = Math.max(5, Math.min(500, oldScale * factor))
    // Keep the world point under the cursor stationary:
    // screen_x = width/2 + offsetX + world_x * scale  ⇒  offsetX = mx - world_x * scale
    // world_x under cursor = (mx - offsetX) / oldScale
    // new offsetX = mx - world_x * newScale = mx - (mx - offsetX)/oldScale * newScale
    this.offsetX = mx - (mx - this.offsetX) * (newScale / oldScale)
    this.offsetY = my - (my - this.offsetY) * (newScale / oldScale)
    this.scale = newScale
    this.draw()
  },

  _onClick(e) {
    if (this._dragging) return
    const rect = this.canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top

    // Hit-test in screen space against the visual station dot positions
    let closest = null
    let closestDist = Infinity
    const HIT_PX = 12 // pixel hit radius

    for (const station of Object.values(Sim.stations)) {
      const sp = this._stationScreenPos(station)
      const dx = sp.x - cx
      const dy = sp.y - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < HIT_PX && d < closestDist) {
        closestDist = d
        closest = station
      }
    }

    // Deselect all, select clicked
    for (const s of Object.values(Sim.stations)) s.selected = false
    if (closest) {
      closest.selected = true
      UI.showStationInspector(closest)
    } else {
      UI.hideStationInspector()
    }
    this.draw()
  },
}
