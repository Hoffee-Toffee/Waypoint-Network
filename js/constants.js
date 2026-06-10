// constants.js — physical constants, unit conversions, and simulation defaults

'use strict'

const C = {
  // ── Unit conversions ──────────────────────────────────────────────────────
  AU_IN_LY: 1.5812e-5, // 1 AU in light-years
  LY_IN_METRES: 9.4607e15, // 1 light-year in metres
  AU_IN_METRES: 1.496e11, // 1 AU in metres
  GM_SOL: 1.327e20, // GM of Sol, m³/s²
  DEG_TO_RAD: Math.PI / 180,
  RAD_TO_DEG: 180 / Math.PI,
  HOURS_TO_SECONDS: 3600,
  SECONDS_TO_HOURS: 1 / 3600,

  // ── FTL physics defaults (uncalibrated; set via UI) ───────────────────────
  KAPPA: 1.0, // drive constant κ  (W·c³ / kg·m²) — calibrate from reference
  LAMBDA: 1.0, // bridge constant λ  (W / LY·m²)   — calibrate from reference
  DRIVE_EFFICIENCY: 0.85, // η_drive default
  BRIDGE_EFFICIENCY: 0.9, // η_bridge default
  SPEED_EXPONENT: 3, // n in P_drive = κ·M·R²·(v/c)^n / η

  // ── Speed constants ─────────────────────────────────────────────────────────
  YEAR_IN_SECONDS: 31557600, // 365.25 × 24 × 3600
  COMM_SIGNAL_SPEED_C: 100000, // comm conduit transmissions (bridge-effect, very fast)
  DRONE_SPEED_C: 3000, // physical FTL comm drones in free space

  // ── Drone defaults ────────────────────────────────────────────────────────
  DRONE_MASS_KG: 50,
  DRONE_BUBBLE_RADIUS_M: 1.5,

  // ── Vessel defaults ───────────────────────────────────────────────────────
  VESSEL_MASS_KG: 1e6,
  VESSEL_BUBBLE_RADIUS_M: 100,

  // ── Station defaults ──────────────────────────────────────────────────────
  DEFAULT_ORBITAL_RADIUS_AU: 0.03,
  DEFAULT_COLLECTOR_AREA_KM2: 1000,
  DEFAULT_RESERVE_FLOOR: 0.2,
  DEFAULT_MATERIAL_WEIGHT: 1.0,
  DEFAULT_BASE_CADENCE_S: 3600,
  DEFAULT_MAX_BRIDGE_LY: 12,
  DEFAULT_MAX_BRIDGE_CONNECTIONS: 1000,
  DEFAULT_COMM_CONDUIT_COUNT: 8,

  // Main conduit
  MAIN_CONDUIT_SLEW_RATE_S_DEG: 15, // seconds per degree of rotation
  MAIN_CONDUIT_RANGE_DEG: 180, // anti-stellar hemisphere

  // Comm conduit
  COMM_CONDUIT_SLEW_RATE_S_DEG: 0.25, // seconds per degree
  COMM_CONDUIT_X_RANGE_DEG: 180, // equatorial sweep (±90°)
  COMM_CONDUIT_Y_RANGE_DEG: 240, // meridional tilt (±120°)
  COMM_CONDUIT_TUNNEL_RADIUS_M: 0.15,
  COMM_CONDUIT_MAX_MASS_KG: 2.0,

  // ── Main conduit dock count ───────────────────────────────────────────────
  MAIN_CONDUIT_DOCK_COUNT: 25, // assume always free for now

  // ── Scheduling ────────────────────────────────────────────────────────────
  MIN_CADENCE_S: 1,
  MAX_CADENCE_S: 86400,
  OFFLINE_MISS_COUNT: 3, // consecutive missed check-ins before marking offline
  MAX_LOG_ENTRIES: 500,
  MAX_MESSAGES: 5000, // accommodate heartbeats for large networks

  // ── Rendering ────────────────────────────────────────────────────────────
  // Colours
  COL_BACKGROUND: '#000000',
  COL_STAR: '#ffee44',
  COL_ORBIT_RING: '#404040',
  COL_STATION: '#ffffff',
  COL_BRIDGE_ACTIVE: 'rgba(255,255,255,0.75)',
  COL_BRIDGE_INACTIVE: 'rgba(255,255,255,0.25)',
  COL_PATH_PLANNED: 'rgba(68,136,255,0.80)',
  COL_ARC_VISIBLE: 'rgba(68,255,68,0.70)',
  COL_ARC_SHADOW: 'rgba(255,68,68,0.70)',
  COL_BEAM_MAIN: '#ffaa00',
  COL_BEAM_COMM: '#00ccff',
  COL_DRONE_COMM: '#00ccff',
  COL_DRONE_CARGO: '#ffffff',
  COL_SIGNAL_COMM: 'rgba(0,204,255,0.95)',
  COL_SIGNAL_DATA: 'rgba(68,136,255,0.95)',

  // Per-message-type signal colours (used by renderer)
  SIGNAL_COLORS: {
    base_check: 'rgba(0, 204, 255, 0.95)', // cyan
    manifest: 'rgba(68, 255, 136, 0.95)', // green
    data: 'rgba(68, 136, 255, 0.95)', // blue
    ship_route: 'rgba(0,  200, 180, 0.95)', // teal
    drone_transit: 'rgba(255,180,   0, 0.95)', // amber
    vessel_transit: 'rgba(255,100,   0, 0.95)', // orange
    multi_hop_coordination: 'rgba(200,100, 255, 0.95)', // purple
    manifest_ack: 'rgba(200, 100, 255, 0.95)',
    main_booking: 'rgba(255, 200, 0, 0.95)',
    main_booking_ack: 'rgba(255, 200, 0, 0.95)',
  },

  SIGNAL_GLOW_COLORS: {
    base_check: 'rgba(0,   220, 255, 0.5)',
    manifest: 'rgba(68,  255, 136, 0.5)',
    data: 'rgba(68,  136, 255, 0.5)',
    ship_route: 'rgba(0,   200, 180, 0.5)',
    drone_transit: 'rgba(255, 180,   0, 0.5)',
    vessel_transit: 'rgba(255, 100,   0, 0.5)',
    multi_hop_coordination: 'rgba(200, 100, 255, 0.5)',
    manifest_ack: 'rgba(200, 100, 255, 0.5)',
    main_booking: 'rgba(255, 200, 0, 0.5)',
    main_booking_ack: 'rgba(255, 200, 0, 0.5)',
  },

  // Pixel sizes
  SOL_RADIUS_M: 6.957e8, // reference for star-to-scale rendering
  STAR_SCREEN_REF_PX: 8, // Sol renders at this many pixels
  STAR_RADIUS_MIN_PX: 4,
  STAR_RADIUS_MAX_PX: 14,
  STATION_DOT_RADIUS_PX: 4,

  // Display scale: how many pixels per light-year (adjustable via zoom)
  INITIAL_SCALE_PX_PER_LY: 40,
}

// Make immutable
Object.freeze(C)
