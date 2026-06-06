import type { Feature, FeatureCollection } from 'geojson'
import type { PathOptions } from 'leaflet'

// ─── Regional-map layer registry (the platform contract) ───────────────────────
// Every layer is one of three Leaflet archetypes and gets its data through its own
// cached /api/layers/<id> proxy (timeout + honest error — the /api/usdm pattern).
// RegionalMapClient renders any LayerDefinition GENERICALLY, so adding a layer =
// +1 definition here + 1 proxy route, with 0 changes to the map component.

export type LayerCategory = 'drought' | 'water' | 'vegetation' | 'hazard' | 'dryline'

export interface LegendItem { color: string; label: string }

interface BaseLayer {
  id:           string
  label:        string             // toggle text
  category:     LayerCategory
  endpoint:     string             // our cached /api/layers/<id> proxy
  attribution:  string             // also the legend title
  legend:       LegendItem[]
  failure:      { note: string }   // honest "temporarily unavailable" copy
  loadingNote?: string             // optional; defaults to "Loading…"
}

export interface VectorLayer extends BaseLayer {
  type:       'vector'                                   // proxy returns GeoJSON + asOf (or error:true)
  style:      (feature?: Feature) => PathOptions
  clickInfo?: (feature: Feature) => { title: string; body?: string }
  asOfFrom?:  (geo: FeatureCollection & { releaseDate?: number }) => number | null
  // When true, an empty result (features:[] with error:false) is a GOOD, honest state
  // — render `emptyNote` ("No active alerts"), NOT the failure note. Layers WITHOUT
  // this flag (e.g. USDM) keep treating empty as an error, unchanged.
  emptyIsHonest?: boolean
  emptyNote?:     string
}

export interface TileLayer extends BaseLayer {
  type:     'tile'                                       // proxy templates upstream {z}/{x}/{y}
  maxZoom?: number
  opacity?: number
}

export interface ImageLayer extends BaseLayer {
  type:     'image'                                      // proxy exportImage → georeferenced overlay
  bounds:   'conus' | [[number, number], [number, number]]
  opacity?: number
}

// Animated raster RADAR layer (RainViewer). Structurally different from the vector
// layers: it's a Leaflet TileLayer cycling timestamped frames, not GeoJSON. ALL the
// provider knobs live here as explicit config — the swap point for a future custom
// renderer (change this def, not the map component).
export interface RadarLayer extends BaseLayer {
  type:            'radar'                 // proxy returns { host, frames:[{time,path}] }
  tileUrlTemplate: string                  // {host}{path}/{size}/{z}/{x}/{y}/{palette}/{smooth}_{snow}.png
  palette:         number                  // RainViewer color scheme (6 = NEXRAD, NWS-style)
  size:            256 | 512
  smooth:          0 | 1
  snow:            0 | 1
  opacity:         number                  // drawn ABOVE the base map
  frameCount:      number                  // how many recent frames the loop uses (cab-tunable)
  loopSpeedMs:     number                  // ms per frame while playing (the cadence knob)
  fadeMs:          number                  // cross-fade duration between frames while playing
  defaultMode:     'latest' | 'loop'       // 'latest' = open on newest frame only (light for 3G)
}

export type LayerDefinition = VectorLayer | TileLayer | ImageLayer | RadarLayer

// Per-render, county-dynamic extras keyed by layer id, injected by the page (e.g. the
// USDM static-image fallback URL, which is computed server-side per county).
export interface LayerRuntime {
  fallbackImage?: { url: string | null; sourceUrl: string }
  // Per-county dynamic endpoint override (the registry `endpoint` is a static string;
  // alerts need ?area=ST). When present, the renderer fetches this instead.
  endpoint?: string
}

// ─── USDM — the first registry layer (official D0–D4 palette) ──────────────────

export const DROUGHT_COLORS: Record<number, string> = {
  4: '#730000', 3: '#E60000', 2: '#FFAA00', 1: '#FCD37F', 0: '#FFFF00',
}

function usdmStyle(feature?: Feature): PathOptions {
  const dm = feature?.properties?.DM as number | undefined
  const color = dm != null ? (DROUGHT_COLORS[dm] ?? '#999999') : '#999999'
  return { fillColor: color, fillOpacity: 0.5, color, weight: 0.5, opacity: 0.5, interactive: false }
}

export const usdm: VectorLayer = {
  id:          'usdm',
  label:       'Drought Monitor',
  category:    'drought',
  type:        'vector',
  endpoint:    '/api/layers/usdm',
  attribution: 'U.S. Drought Monitor',
  loadingNote: 'Loading drought layer…',
  failure:     { note: 'Layer temporarily unavailable' },
  legend: [
    { color: DROUGHT_COLORS[4], label: 'D4 Exceptional' },
    { color: DROUGHT_COLORS[3], label: 'D3 Extreme' },
    { color: DROUGHT_COLORS[2], label: 'D2 Severe' },
    { color: DROUGHT_COLORS[1], label: 'D1 Moderate' },
    { color: DROUGHT_COLORS[0], label: 'D0 Abnormally dry' },
  ],
  style:    usdmStyle,
  asOfFrom: geo => geo.releaseDate ?? null,
}

// ─── NWS active alerts — the hazard vector layer ───────────────────────────────
// Single warning-red stroke with a faint fill so it reads as a warning OUTLINE on
// top of (and distinct from) the filled drought palette. County-dynamic: the real
// endpoint (?area=ST) is injected via LayerRuntime per render. Honest-empty: a quiet
// day shows "No active alerts", never a false "unavailable" (see the proxy + renderer).

const ALERT_RED = '#DC2626'

// interactive:true so the polygons receive taps → the clickInfo popup (below). USDM's
// usdmStyle stays interactive:false (no popup), so they don't share this behaviour.
function alertsStyle(): PathOptions {
  return { color: ALERT_RED, weight: 2, fillColor: ALERT_RED, fillOpacity: 0.08, opacity: 0.9, interactive: true }
}

export const alerts: VectorLayer = {
  id:            'alerts',
  label:         'Alerts',
  category:      'hazard',
  type:          'vector',
  endpoint:      '/api/layers/alerts', // static default; the per-county ?area=ST comes via runtime
  attribution:   'NWS Active Alerts',
  loadingNote:   'Loading alerts…',
  failure:       { note: 'Alerts temporarily unavailable' },
  emptyIsHonest: true,
  emptyNote:     'No active alerts',
  legend: [{ color: ALERT_RED, label: 'Active warning / advisory' }],
  style: alertsStyle,
  // Tap-to-identify: event name + NWS headline (+ area). The renderer binds a popup
  // ONLY when a layer has clickInfo — USDM has none, so it stays popup-free.
  clickInfo: feature => {
    const p = (feature.properties ?? {}) as { event?: string; headline?: string; areaDesc?: string }
    return {
      title: p.event ?? 'Active alert',
      body:  [p.headline, p.areaDesc].filter(Boolean).join(' · ') || undefined,
    }
  },
}

// ─── RainViewer radar — the default map layer ──────────────────────────────────
// NEXRAD palette (NWS-style), 65% opacity over the base. Opens on the latest frame
// (one tile-set, light for 3G); a play control loops the recent frames on demand.

export const radar: RadarLayer = {
  id:              'radar',
  label:           'Radar',
  category:        'water',
  type:            'radar',
  endpoint:        '/api/layers/radar',     // frame-list proxy (host + timestamped frames)
  attribution:     'RainViewer Radar',
  loadingNote:     'Loading radar…',
  failure:         { note: 'Radar temporarily unavailable' },
  legend: [
    { color: '#fd0000', label: 'Intense' },
    { color: '#fdf802', label: 'Heavy' },
    { color: '#02fd02', label: 'Moderate' },
    { color: '#04e9e7', label: 'Light' },
  ],
  tileUrlTemplate: '{host}{path}/{size}/{z}/{x}/{y}/{palette}/{smooth}_{snow}.png',
  palette:         6,      // NEXRAD Level III
  size:            256,
  smooth:          1,
  snow:            1,
  opacity:         0.65,
  frameCount:      13,     // RainViewer's full past set (~2h of 10-min frames)
  loopSpeedMs:     450,    // cadence that feels smooth once the cross-fades overlap
  fadeMs:          200,    // cross-fade between outgoing/incoming frame (< loopSpeedMs)
  defaultMode:     'latest',
}

// Radar FIRST → LAYERS[0] is the default active tab the map opens on; the vector
// layers (USDM, alerts) and the outlook images stay as switchable tabs after it.
export const LAYERS: LayerDefinition[] = [radar, usdm, alerts]
