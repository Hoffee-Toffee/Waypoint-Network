// analyst.js — network statistics and scenario playback

'use strict'

const Analyst = {
  activePath: null, // [stationId, ...]

  init() {
    // Only populate if not already done, to preserve user selection
    if (document.getElementById('analyst-source').options.length === 0) {
      this._populateSelectors()
    }

    // Remove existing listener to avoid duplication if init is called multiple times
    const btn = document.getElementById('btn-analyst-run')
    const newBtn = btn.cloneNode(true)
    btn.parentNode.replaceChild(newBtn, btn)
    newBtn.addEventListener('click', () => this.runAnalysis())
  },

  _populateSelectors() {
    const ids = Object.keys(Sim.stations).sort((a, b) =>
      Sim.stations[a].name.localeCompare(Sim.stations[b].name)
    )
    const selSrc = document.getElementById('analyst-source')
    const selDest = document.getElementById('analyst-dest')
    if (!selSrc || !selDest) return

    selSrc.innerHTML = ''
    selDest.innerHTML = ''
    for (const id of ids) {
      const optA = document.createElement('option')
      optA.value = id
      optA.textContent = Sim.stations[id].name
      selSrc.appendChild(optA)

      const optB = document.createElement('option')
      optB.value = id
      optB.textContent = Sim.stations[id].name
      selDest.appendChild(optB)
    }
    if (ids.length >= 2) {
      selSrc.value = ids[0]
      selDest.value = ids[ids.length - 1]
    }
  },

  runAnalysis() {
    const fromId = document.getElementById('analyst-source').value
    const toId = document.getElementById('analyst-dest').value
    const type = document.getElementById('analyst-type').value
    const priority = parseInt(document.getElementById('analyst-priority').value, 10)

    if (fromId === toId) {
      alert('Source and destination must be different.')
      return
    }

    const path = Scheduler._resolvePath(fromId, toId)
    if (!path) {
      alert('No bridge path found between selected stations.')
      return
    }

    this.activePath = path
    Renderer.analysisModePath = path
    Renderer.zoomToPath(path)
    document.getElementById('analyst-results').style.display = 'block'

    // 1. Calculate stats
    let totalDist = 0
    let avgUptime = 0
    for (let i = 0; i < path.length - 1; i++) {
      const b = getBridgeForPair(path[i], path[i+1])
      totalDist += b.lengthLY
      const stA = Sim.stations[path[i]]
      const stB = Sim.stations[path[i+1]]
      avgUptime += (stA.uptimeFraction + stB.uptimeFraction) / 2
    }
    avgUptime /= (path.length - 1)

    // Estimate coordination delay (heuristic)
    // - Each hop needs a comm cycle (cadence/2 wait on avg)
    // - Slew costs (~10s per hop)
    // - High priority reduces wait
    const baseCadence = Sim.stations[path[0]].baseCadenceSeconds
    const priorityWeight = { 1: 0.1, 2: 0.3, 3: 0.5, 4: 0.8, 5: 1.0 }[priority] || 0.5
    const coordDelay = (path.length - 1) * (baseCadence * priorityWeight + 10)

    // Travel time
    const sampleMsg = { type }
    const speedC = Scheduler._getMsgSpeed(sampleMsg, Sim.stations[path[0]])
    const travelSec = (totalDist / speedC) * C.YEAR_IN_SECONDS
    const totalTime = coordDelay + travelSec

    // Display
    document.getElementById('res-hops').textContent = path.length - 1
    document.getElementById('res-dist').textContent = totalDist.toFixed(2) + ' LY'
    document.getElementById('res-uptime').textContent = (avgUptime * 100).toFixed(1) + '%'
    document.getElementById('res-coord').textContent = this._formatTime(coordDelay)
    document.getElementById('res-total').textContent = this._formatTime(totalTime)

    // 2. Play Scenario
    UI.appendLog('info', `Scenario: ${type} ${fromId} → ${toId}`)
    Scheduler.enqueue(fromId, toId, type, priority, path)

    // Ensure simulation is running
    if (Sim.paused) UI.play()

    Renderer.draw()
  },

  _formatTime(s) {
    if (s < 60) return Math.floor(s) + 's'
    if (s < 3600) return Math.floor(s/60) + 'm ' + Math.floor(s%60) + 's'
    return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm'
  }
}
