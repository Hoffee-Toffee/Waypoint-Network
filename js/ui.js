// ui.js — control panel bindings, station inspector, playback controls

'use strict'

const UI = {
  _inspectorStation: null,
  _highlightedMsgId: null, // message whose path is highlighted on the map

  init() {
    // Playback controls
    document
      .getElementById('btn-play')
      .addEventListener('click', () => this.play())
    document
      .getElementById('btn-pause')
      .addEventListener('click', () => this.pause())
    document
      .getElementById('btn-step')
      .addEventListener('click', () => this.step())
    document
      .getElementById('btn-reset')
      .addEventListener('click', () => this.reset())
    document
      .getElementById('btn-fit')
      .addEventListener('click', () => Renderer.zoomToFit())
    document
      .getElementById('btn-save')
      .addEventListener('click', () => this.saveState())
    document
      .getElementById('btn-load')
      .addEventListener('click', () =>
        document.getElementById('input-load-file').click(),
      )
    document
      .getElementById('input-load-file')
      .addEventListener('change', (e) => this.loadState(e))

    // Speed multiplier
    document.getElementById('sel-speed').addEventListener('change', (e) => {
      Sim.speedMultiplier = parseFloat(e.target.value)
    })

    // Time step size
    document.getElementById('sel-timestep').addEventListener('change', (e) => {
      const map = { '1s': 1, '1min': 60, '1hr': 3600, '1day': 86400 }
      Sim.deltaSec = map[e.target.value] ?? 1
    })

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
      if (e.code === 'Space') {
        e.preventDefault()
        Sim.paused ? this.play() : this.pause()
      }
      if (e.code === 'Period') this.step()
      if (e.code === 'KeyF') Renderer.zoomToFit()
      if (e.code === 'KeyR') this.reset()
      if (e.code === 'KeyS' && e.ctrlKey) {
        e.preventDefault()
        this.saveState()
      }
    })

    // Global physics inputs
    this._bindNumberInput('input-kappa', (v) => {
      Sim.settings.kappa = v
    })
    this._bindNumberInput('input-lambda', (v) => {
      Sim.settings.lambda = v
    })
    this._bindNumberInput('input-drone-mass', (v) => {
      Sim.settings.droneMassKg = v
    })
    this._bindNumberInput('input-drone-bubble', (v) => {
      Sim.settings.droneBubbleRadiusM = v
    })
    this._bindNumberInput('input-vessel-mass', (v) => {
      Sim.settings.vesselMassKg = v
    })
    this._bindNumberInput('input-vessel-bubble', (v) => {
      Sim.settings.vesselBubbleRadiusM = v
    })
    this._bindRangeInput('input-eta', (v) => {
      Sim.settings.eta = v
      document.getElementById('lbl-eta').textContent = v.toFixed(2)
    })

    // Background signal controls
    document
      .getElementById('input-bg-enable')
      .addEventListener('change', (e) => {
        Sim.settings.backgroundSignals.enabled = e.target.checked
      })
    document.getElementById('input-bg-rate').addEventListener('input', (e) => {
      Sim.settings.backgroundSignals.ratePerHour =
        parseFloat(e.target.value) || 0
    })
    this._bindNumberInput('input-bg-mix-check', (v) => {
      Sim.settings.backgroundSignals.typeMix.base_check = Math.max(
        0,
        Math.min(1, v / 100),
      )
    })
    this._bindNumberInput('input-bg-mix-data', (v) => {
      Sim.settings.backgroundSignals.typeMix.data = Math.max(
        0,
        Math.min(1, v / 100),
      )
    })
    this._bindNumberInput('input-bg-mix-drone', (v) => {
      Sim.settings.backgroundSignals.typeMix.drone_transit = Math.max(
        0,
        Math.min(1, v / 100),
      )
    })
    this._bindNumberInput('input-bg-mix-vessel', (v) => {
      Sim.settings.backgroundSignals.typeMix.vessel_transit = Math.max(
        0,
        Math.min(1, v / 100),
      )
    })
    const distSel = document.getElementById('input-bg-dist')
    if (distSel)
      distSel.addEventListener('change', (e) => {
        Sim.settings.backgroundSignals.distribution = e.target.value
      })

    // Display range — controls which stars have active stations
    this._bindNumberInput('input-display-range', (v) => {
      Sim.settings.displayDistanceLY = Math.max(5, Math.min(50, v))
      _rebuildActiveStations()
      tickUpdatePositions()
      rebuildBridgeList()
      Scheduler.init()
      document.getElementById('lbl-active-stars').textContent =
        Object.keys(Sim.stations).length + ' stars active'
      Renderer.draw()
    })
    // Initialise the label
    setTimeout(() => {
      const lbl = document.getElementById('lbl-active-stars')
      if (lbl)
        lbl.textContent = Object.keys(Sim.stations).length + ' stars active'
    }, 50)

    // Global max bridge distance
    this._bindNumberInput('input-global-max-bridge', (v) => {
      for (const s of Object.values(Sim.stations)) s.maxBridgeDistanceLY = v
      rebuildBridgeList()
      Scheduler.init()
      Renderer.draw()
    })
    this._bindNumberInput('input-global-max-connections', (v) => {
      const n = Math.max(1, Math.round(v))
      for (const s of Object.values(Sim.stations)) s.maxBridgeConnections = n
      rebuildBridgeList()
      Scheduler.init()
      Renderer.draw()
    })
    this._bindNumberInput('input-global-comm-count', (v) => {
      const n = Math.max(1, Math.min(8, Math.round(v)))
      for (const s of Object.values(Sim.stations)) {
        s.commConduitCount = n
        s.commConduits = makeCommConduits(n)
      }
      Scheduler.init()
      Renderer.draw()
    })
    this._bindNumberInput('input-global-cadence', (v) => {
      const c = Math.max(10, Math.min(300, Math.round(v)))
      for (const s of Object.values(Sim.stations)) s.baseCadenceSeconds = c
    })

    // Bridge filter buttons
    const setFilter = (f) => {
      Renderer.bridgeFilter = f
      document
        .getElementById('btn-filter-both')
        .classList.toggle('active', f === 'both')
      document
        .getElementById('btn-filter-comm')
        .classList.toggle('active', f === 'comm')
      document
        .getElementById('btn-filter-main')
        .classList.toggle('active', f === 'main')
      Renderer.draw()
    }
    document
      .getElementById('btn-filter-both')
      .addEventListener('click', () => setFilter('both'))
    document
      .getElementById('btn-filter-comm')
      .addEventListener('click', () => setFilter('comm'))
    document
      .getElementById('btn-filter-main')
      .addEventListener('click', () => setFilter('main'))

    // Tabs
    const tabManifest = document.getElementById('tab-manifest')
    const tabAnalyst = document.getElementById('tab-analyst')
    const panelManifest = document.getElementById('manifest-panel')
    const panelAnalyst = document.getElementById('analyst-panel')

    tabManifest.addEventListener('click', () => {
      tabManifest.classList.add('active')
      tabAnalyst.classList.remove('active')
      panelManifest.style.display = 'block'
      panelAnalyst.style.display = 'none'
      Renderer.analysisModePath = null
      Renderer.draw()
    })
    tabAnalyst.addEventListener('click', () => {
      tabAnalyst.classList.add('active')
      tabManifest.classList.remove('active')
      panelAnalyst.style.display = 'block'
      panelManifest.style.display = 'none'
      Analyst.init()
    })

    this._tickDisplay()
  },

  play() {
    Sim.paused = false
    startTick()
    document.getElementById('btn-play').classList.add('active')
    document.getElementById('btn-pause').classList.remove('active')
  },

  pause() {
    Sim.paused = true
    document.getElementById('btn-pause').classList.add('active')
    document.getElementById('btn-play').classList.remove('active')
  },

  step() {
    if (!Sim.paused) this.pause()
    // Advance one deltaSec
    const saved = Sim.paused
    Sim.paused = false
    tickFrame()
    Sim.paused = saved
  },

  reset() {
    stopTick()
    Sim.paused = true
    Sim.simTimeSec = 0
    Sim.signals = []
    Sim.messages = []
    // Re-randomise phases and clear state
    for (const s of Object.values(Sim.stations)) {
      s.phaseRad = Math.random() * 2 * Math.PI
      s.lastCheckinByNeighbour = {}
      s.outboundQueue = new Set()
      s.pendingCheckinDests = new Set()
      s.inboundQueue = []
    }
    Scheduler.init()
    tickUpdatePositions()
    tickUpdateLOS()
    // Clear log
    document.getElementById('log-entries').innerHTML = ''
    UI.refreshManifest()
    Renderer.draw()
    this._tickDisplay()
  },

  // ── Sim time display ──────────────────────────────────────────────────

  _tickDisplay() {
    const lbl = document.getElementById('lbl-sim-time')
    const update = () => {
      const t = Sim.simTimeSec
      const days = Math.floor(t / 86400)
      const hrs = Math.floor((t % 86400) / 3600)
      const mins = Math.floor((t % 3600) / 60)
      const secs = Math.floor(t % 60)
      const doy = (days % 365) + 1
      const year = Math.floor(days / 365) + 2400
      lbl.textContent =
        `UST ${year}.${String(doy).padStart(3, '0')} ` +
        `${String(hrs).padStart(2, '0')}:` +
        `${String(mins).padStart(2, '0')}:` +
        `${String(secs).padStart(2, '0')}`
      requestAnimationFrame(update)
    }
    requestAnimationFrame(update)
  },

  // ── Log panel ──────────────────────────────────────────────────────────

  appendLog(type, text) {
    const el = document.getElementById('log-entries')
    const entry = document.createElement('div')
    entry.className = 'log-entry ' + type
    const t = Sim.simTimeSec
    const hrs = String(Math.floor((t % 86400) / 3600)).padStart(2, '0')
    const mins = String(Math.floor((t % 3600) / 60)).padStart(2, '0')
    const secs = String(Math.floor(t % 60)).padStart(2, '0')
    entry.textContent = `[${hrs}:${mins}:${secs}] ${text}`
    el.appendChild(entry)
    // Trim to max entries
    while (el.children.length > C.MAX_LOG_ENTRIES) el.removeChild(el.firstChild)
    el.scrollTop = el.scrollHeight
  },

  // ── Manifest panel ─────────────────────────────────────────────────────

  _lastManifestRefreshWall: 0,

  maybeRefreshManifest() {
    const now = Date.now()
    if (now - this._lastManifestRefreshWall < 500) return // refresh at most 2/sec
    this._lastManifestRefreshWall = now
    this.refreshManifest()
  },

  refreshManifest() {
    const tbody = document.getElementById('manifest-tbody')
    const recent = [...Sim.messages].reverse().slice(0, 40)
    if (recent.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="color:#444;padding:8px 4px;">No items</td></tr>'
      return
    }
    tbody.innerHTML = ''
    for (const msg of recent) {
      const from =
        Sim.stations[msg.sourceId]?.name.replace(' Station', '') ?? msg.sourceId
      const to =
        Sim.stations[msg.destinationId]?.name.replace(' Station', '') ??
        msg.destinationId
      const statusColor =
        msg.status === 'delivered'
          ? 'color:#44ff88'
          : msg.status === 'failed'
            ? 'color:#ff4444'
            : msg.status === 'in_transit' || msg.status === 'scheduled'
              ? 'color:#ffcc44'
              : 'color:#aaa'
      const sigCol = C.SIGNAL_COLORS[msg.type] ?? '#aaa'
      const hopStr =
        msg.path && msg.path.length > 2
          ? msg.path
              .map((id) => Sim.stations[id]?.name.replace(' Station', '') ?? id)
              .join(' → ')
          : ''
      const tr = document.createElement('tr')
      tr.style.cursor = 'pointer'
      if (msg.id === UI._highlightedMsgId) tr.style.background = '#1a1a2e'
      tr.innerHTML =
        `<td>P${msg.priority}</td>` +
        `<td style="color:${sigCol}">${msg.type.replace(/_/g, ' ')}</td>` +
        `<td>${from}→${to}</td>` +
        `<td style="${statusColor}">${msg.status}</td>` +
        `<td style="color:#606075;font-size:10px">${hopStr}</td>`
      tr.title = hopStr || `${from} → ${to}`
      tr.addEventListener('click', () => {
        UI._highlightedMsgId = msg.id === UI._highlightedMsgId ? null : msg.id
        UI.refreshManifest()
        Renderer.draw()
      })
      tbody.appendChild(tr)
    }
  },

  // ── Inspector live refresh ─────────────────────────────────────────────

  refreshInspectorLive() {
    // Only update the fields that change during simulation (not the controls)
    const station = this._inspectorStation
    if (!station) return
    const bar = document.getElementById('insp-reserve-bar')
    if (bar) bar.value = station.energyReserveFraction
  },

  // ── Station inspector ─────────────────────────────────────────────────

  showStationInspector(station) {
    this._inspectorStation = station
    const panel = document.getElementById('inspector-panel')
    panel.style.display = 'block'
    this._renderInspector(station)
  },

  hideStationInspector() {
    this._inspectorStation = null
    document.getElementById('inspector-panel').style.display = 'none'
  },

  _renderInspector(station) {
    const star = Sim.stars[station.starId]

    document.getElementById('insp-name').textContent = station.name
    document.getElementById('insp-star').textContent =
      `${star.name} (${star.spectralType})`
    document.getElementById('insp-period').textContent =
      station.orbitalPeriodHours.toFixed(1) + ' h'
    document.getElementById('insp-speed').textContent =
      station.orbitalSpeedKmS.toFixed(0) + ' km/s'
    document.getElementById('insp-shadow').textContent =
      station.shadowDurationHours.toFixed(2) + ' h/orbit'
    document.getElementById('insp-uptime').textContent =
      (station.uptimeFraction * 100).toFixed(1) + '%'
    document.getElementById('insp-flux').textContent =
      (station.solarFluxWm2 / 1e6).toFixed(2) + ' MW/m²'

    // Orbital radius slider
    const slider = document.getElementById('insp-orbit-slider')
    const input = document.getElementById('insp-orbit-input')
    slider.value = station.orbitalRadiusAU
    input.value = station.orbitalRadiusAU

    const updateOrbit = (v) => {
      const val = Math.max(0.005, Math.min(1.0, parseFloat(v)))
      station.orbitalRadiusAU = val
      Physics.recomputeDerivedOrbit(station, star)
      rebuildBridgeList()
      this._renderInspector(station)
      Renderer.draw()
    }
    slider.oninput = (e) => {
      input.value = e.target.value
      updateOrbit(e.target.value)
    }
    input.oninput = (e) => {
      slider.value = e.target.value
      updateOrbit(e.target.value)
    }

    // Inclination
    const incSlider = document.getElementById('insp-inc-slider')
    const incInput = document.getElementById('insp-inc-input')
    incSlider.value = station.orbitInclinationDeg
    incInput.value = station.orbitInclinationDeg
    const updateInc = (v) => {
      station.orbitInclinationDeg = parseFloat(v)
      tickUpdatePositions()
      tickUpdateLOS()
      this._renderInspector(station)
      Renderer.draw()
    }
    incSlider.oninput = (e) => {
      incInput.value = e.target.value
      updateInc(e.target.value)
    }
    incInput.oninput = (e) => {
      incSlider.value = e.target.value
      updateInc(e.target.value)
    }

    // LAN
    const lanInput = document.getElementById('insp-lan-input')
    lanInput.value = station.orbitLANDeg
    lanInput.oninput = (e) => {
      station.orbitLANDeg = parseFloat(e.target.value) || 0
      tickUpdatePositions()
      tickUpdateLOS()
      Renderer.draw()
    }

    // Energy reserve bar
    const bar = document.getElementById('insp-reserve-bar')
    bar.value = station.energyReserveFraction
    bar.max = 1

    // Cadence — now global; no per-station input

    // Max bridge distance
    const bridgeInput = document.getElementById('insp-max-bridge-input')
    bridgeInput.value = station.maxBridgeDistanceLY
    bridgeInput.oninput = (e) => {
      station.maxBridgeDistanceLY = parseFloat(e.target.value) || 10
      rebuildBridgeList()
      Renderer.draw()
    }

    // Max bridge connections
    const connInput = document.getElementById('insp-max-connections-input')
    connInput.value = station.maxBridgeConnections
    connInput.oninput = (e) => {
      station.maxBridgeConnections = Math.max(1, parseInt(e.target.value) || 5)
      rebuildBridgeList()
      Renderer.draw()
    }

    // Comm conduit count — now global; no per-station input
  },
  // ── Save / Load ──────────────────────────────────────────────────

  saveState() {
    const payload = {
      version: 1,
      simTimeSec: Sim.simTimeSec,
      settings: Sim.settings,
      stations: Object.fromEntries(
        Object.entries(Sim.stations).map(([id, s]) => [
          id,
          {
            orbitalRadiusAU: s.orbitalRadiusAU,
            orbitInclinationDeg: s.orbitInclinationDeg,
            orbitLANDeg: s.orbitLANDeg,
            phaseRad: s.phaseRad,
            baseCadenceSeconds: s.baseCadenceSeconds,
            maxBridgeDistanceLY: s.maxBridgeDistanceLY,
            commConduitCount: s.commConduitCount,
            solarCollectorAreaKm2: s.solarCollectorAreaKm2,
            stellarMaterialWeightFactor: s.stellarMaterialWeightFactor,
            reserveFloor: s.reserveFloor,
            energyReserveFraction: s.energyReserveFraction,
          },
        ]),
      ),
      rendererScale: Renderer.scale,
      rendererOffsetX: Renderer.offsetX,
      rendererOffsetY: Renderer.offsetY,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'ftl-network-save.json'
    a.click()
    URL.revokeObjectURL(a.href)
    UI.appendLog('info', 'State saved.')
  },

  loadState(event) {
    const file = event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const d = JSON.parse(e.target.result)
        stopTick()
        Sim.paused = true
        Sim.simTimeSec = d.simTimeSec ?? 0
        Sim.signals = []
        Sim.messages = []
        if (d.settings)
          Object.assign(
            Sim.settings.backgroundSignals,
            d.settings.backgroundSignals ?? {},
          )
        for (const [id, sv] of Object.entries(d.stations ?? {})) {
          const st = Sim.stations[id]
          if (!st) continue
          Object.assign(st, sv)
          st.commConduits = makeCommConduits(st.commConduitCount)
          Physics.recomputeDerivedOrbit(st, Sim.stars[st.starId])
        }
        if (d.rendererScale) Renderer.scale = d.rendererScale
        if (d.rendererOffsetX !== undefined)
          Renderer.offsetX = d.rendererOffsetX
        if (d.rendererOffsetY !== undefined)
          Renderer.offsetY = d.rendererOffsetY
        rebuildBridgeList()
        Scheduler.init()
        tickUpdatePositions()
        document.getElementById('log-entries').innerHTML = ''
        UI.appendLog('info', 'State loaded.')
        UI.refreshManifest()
        Renderer.draw()
      } catch (err) {
        UI.appendLog('error', 'Load failed: ' + err.message)
      }
    }
    reader.readAsText(file)
    // reset the input so the same file can be re-loaded
    event.target.value = ''
  },
  // ── Helper binders ────────────────────────────────────────────────────

  _bindNumberInput(id, setter) {
    const el = document.getElementById(id)
    if (!el) return
    el.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value)
      if (!isNaN(v)) setter(v)
    })
  },

  _bindRangeInput(id, setter) {
    const el = document.getElementById(id)
    if (!el) return
    el.addEventListener('input', (e) => setter(parseFloat(e.target.value)))
  },
}

