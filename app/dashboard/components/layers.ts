import type { Feature, FeatureCollection } from 'geojson'
import type { PathOptions } from 'leaflet'
import { getAlertStyle, NON_RENDERING_EVENTS } from '@/lib/nws-alert-colors'

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
  // Decouples "is a toggle button" from "is a registered layer". Default true (a tab).
  // false = the layer stays registered (its data + LayerRuntime endpoint flow normally)
  // but gets NO toggle button — e.g. alerts, which renders as an overlay on the radar
  // view rather than as its own segment.
  inToggle?:    boolean
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

// ─── AHPS observed-precipitation RASTER (NOAA RFC QPE export service) ───────────
// A dynamic ArcGIS MapServer raster (export-only, NOT tile-cached) served in Web
// Mercator (3857) — so it aligns NATIVELY with the OSM base, radar, and the county
// grid (no reprojection). Rendered as <img> export tiles fetched per-tile-bbox
// straight from NOAA (same direct-load path as the radar tiles), behind its own
// thin /api/layers/<id> proxy for honest availability + the "as of" ending date.
// Multi-window: one toggle tab, with a 30-day / 90-day segmented control IN the view
// (the same in-view-control pattern as radar's play/pause).
export interface RasterWindow {
  label:    string         // segmented-control text ('30-day' / '90-day' / '6–10 day')
  layerId:  number         // ArcGIS export sublayer id
  legend:   LegendItem[]   // condensed, EXACT service colors (decoded from /legend?f=json)
  // Per-window service override. AHPS/QPF windows are all one MapServer (omit this), but
  // the CPC outlook's horizons live on DIFFERENT MapServers, so each window names its own.
  service?: string
  // Key into the proxy's per-horizon metadata ({issued, valid}). Omit for layers whose
  // windows share one flat asOf (AHPS/QPF); set for per-horizon dates (the outlooks).
  key?:     string
}

export interface RasterLayer extends BaseLayer {
  type:        'raster'                                  // proxy returns { ok, asOf, error }
  service:     string                                    // ArcGIS MapServer base (…/MapServer)
  windows:     RasterWindow[]                            // ≥1; the in-view control switches them
  opacity:     number                                    // drawn ABOVE the base map, UNDER the county grid
  legendTitle: string                                    // short legend heading ('Observed precip' / 'Forecast precip')
  asOfPrefix:  string                                    // freshness framing ('as of' for observed, 'issued' for forecast)
  defaultWindow?: number                                 // index of the window to open on (default 0)
  defaultZoom?:   number                                 // override the shared county zoom (e.g. a broad outlook opens wider)
}

export type LayerDefinition = VectorLayer | TileLayer | ImageLayer | RadarLayer | RasterLayer

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
// Per-event official NWS colors (the WWA table in lib/nws-alert-colors.ts) so a
// rancher reads "pink = winter storm" the way every weather app/TV station shows it —
// a stroke + faint fill that reads as a warning OUTLINE over the drought palette.
// County-dynamic: the real endpoint (?area=ST) is injected via LayerRuntime per render.
// Honest-empty: a quiet day shows "No active alerts", never a false "unavailable".

// Per-FEATURE style: Leaflet calls GeoJSON `style` once per feature, so each alert
// polygon gets the official color for its own NWS `event` (feature.properties.event,
// the api.weather.gov field). Unknown events fall to NWS_UNKNOWN_ALERT_STYLE gray via
// getAlertStyle — NEVER red — so we never paint an unrecognized alert as a tornado
// warning. Civil NON_RENDERING_EVENTS (Child Abduction Emergency, Blue Alert) are
// non-geographic: drawn transparent (no stroke/fill), surfaced via the clickInfo popup
// only. interactive:true so polygons still receive taps → the popup (USDM's usdmStyle
// stays interactive:false, so they don't share that behaviour).
function alertsStyle(feature?: Feature): PathOptions {
  const event = (feature?.properties?.event as string | undefined) ?? ''
  if (NON_RENDERING_EVENTS.has(event)) {
    return { stroke: false, fill: false, interactive: true }
  }
  const { color } = getAlertStyle(event)
  return { color, weight: 2, fillColor: color, fillOpacity: 0.08, opacity: 0.9, interactive: true }
}

// FLAG-AND-HOLD: legend swatch only. The polygons are now per-event colored (above),
// so this single red swatch no longer represents the map — the per-event legend is its
// own later slice (the convention is tap-the-polygon, already wired via clickInfo).
// Left UNCHANGED this commit on purpose; kept solely so the existing legend still renders.
const ALERT_RED = '#DC2626'

export const alerts: VectorLayer = {
  id:            'alerts',
  label:         'Alerts',
  inToggle:      false,   // registered (data + endpoint flow) but NO tab — drawn as the radar overlay
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

// ─── AHPS observed precip vs normal — the drought-relevant raster layer ─────────
// "Am I short on water?" — multi-sensor QPE expressed as PERCENT OF NORMAL (QPE vs the
// PRISM 1991–2020 normal) over the window, NOT raw inches. % of normal is the drought-
// relevant metric (NOAA only produces it for 7+ day windows that have a stable normal).
// One SHARED diverging legend — the service uses the SAME % scale for both windows.
// CRITICAL: the raster is colored SERVER-SIDE, so the legend MUST match the colors the
// service paints (we can't remap a server-rendered raster). These are the EXACT service
// hex decoded from the /legend swatches; condensed so each band is one real service color
// and the FAMILY never contradicts the map (warm = below normal/short, gray ≈ normal,
// cool = above normal/surplus). The 17 service classes are folded into 7 bands; finer
// gradations the raster paints within a band stay in the same color family. DRY AT TOP —
// this is a drought product, so the alarming low end ("< 25% short") leads.
const AHPS_PCT_LEGEND: LegendItem[] = [
  { color: '#fa0000', label: '< 25% (short)' },
  { color: '#fa9600', label: '25–50%' },
  { color: '#ffd966', label: '50–75%' },
  { color: '#fafa00', label: '75–100%' },
  { color: '#dcdcdc', label: '≈100% normal' },     // service paints 100–110% gray near-normal
  { color: '#00fa14', label: '110–150%' },
  { color: '#14c8fa', label: '150%+ (surplus)' },
]

export const ahpsObserved: RasterLayer = {
  id:          'ahps',
  label:       'Observed Rain',
  category:    'water',
  type:        'raster',
  service:     'https://mapservices.weather.noaa.gov/raster/rest/services/obs/rfc_qpe/MapServer',
  endpoint:    '/api/layers/ahps',          // thin availability + asOf proxy (tiles load direct)
  attribution: 'NOAA/NWS AHPS — Precipitation, % of normal',
  loadingNote: 'Loading precip vs normal…',
  failure:     { note: 'Precip-vs-normal data temporarily unavailable' },
  opacity:     0.7,
  // % - of - normal Image sublayers: 227 (30-day) / 235 (90-day) — the Image children of the
  // "Last 30/90 Days Percent of Normal (%)" mosaics (224/232). Exporting Image-only keeps
  // the RFC boundary/footprint off our county grid. Both windows share AHPS_PCT_LEGEND.
  windows: [
    { label: '30-day', layerId: 227, legend: AHPS_PCT_LEGEND },
    { label: '90-day', layerId: 235, legend: AHPS_PCT_LEGEND },
  ],
  legendTitle: 'Precip vs normal',
  asOfPrefix:  '% of normal · as of',       // status → "30-day · % of normal · as of {date}"
  // Registry-level legend (the generic default); the view renders the active window's.
  legend: AHPS_PCT_LEGEND,
}

// ─── WPC QPF forecast precipitation — the FORECAST companion to AHPS observed ────
// NOAA Weather Prediction Center quantitative precipitation forecast. It's a vector
// (Feature) service in a non-3857 sphere CRS, but it rides the SAME export-tile path
// as AHPS: ArcGIS rasterizes + reprojects to 3857 server-side (imageSR=3857), so the
// PNG is web-mercator-aligned with the county grid — no client reprojection, no
// renderer change beyond the shared legendTitle/asOfPrefix fields. Dry areas export
// transparent (verified), so no qpf>0 filter is needed. One shared color scale across
// all windows (unlike AHPS's per-window scales).
//
// LOW-END WEIGHTED for the northern Plains: the WPC service ramp is a 19-class national
// scale running to 20" (Gulf-Coast-tuned), where eastern MT forecast totals (<1" across
// the window) collapse into the bottom couple of colors and the legend reads as broken.
// So we key off the AUTHORITATIVE service classes (pulled from /MapServer/11?f=json) but
// keep only the low-end breaks a rancher here actually sees, with a 1.5"+ catch-all for
// the rare wet window. Each swatch hex is the EXACT service color for that class value, so
// the legend matches the pixels the export tile renders (e.g. a 0.25" pixel is #088b00 on
// the map AND in the key) — the legend can't drift from the raster. Ordered heavy→light
// (catch-all on top), same as the prior QPF legend. Honest forecast framing: the legend
// says "Forecast precip · {window} · issued {date}" (real issue_time).
const QPF_LEGEND: LegendItem[] = [
  { color: '#8968cd', label: '1.5"+' },   // service 1.50" class — wet-window catch-all
  { color: '#00b2ee', label: '1"' },      // service 1.00" class
  { color: '#1e90ff', label: '0.75"' },   // service 0.75" class
  { color: '#104e8b', label: '0.5"' },    // service 0.50" class
  { color: '#088b00', label: '0.25"' },   // service 0.25" class
  { color: '#00ff00', label: '0.1"' },    // service 0.10" class
  { color: '#7fff00', label: 'trace' },   // service 0.01" class (0.01–0.1")
]

export const wpcQpf: RasterLayer = {
  id:          'qpf',
  label:       'Forecast Rain',
  category:    'water',
  type:        'raster',
  service:     'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer',
  endpoint:    '/api/layers/qpf',           // availability + real issuance date (tiles load direct)
  attribution: 'NOAA/NWS WPC — Forecast Precipitation',
  loadingNote: 'Loading forecast precipitation…',
  failure:     { note: 'Forecast precipitation temporarily unavailable' },
  opacity:     0.7,
  // Cumulative forecast windows (Feature layer ids on the WPC QPF service): Day-1 24hr,
  // Day 1–3 (72hr), Day 1–7 (168hr). Same QPF scale across all → one shared legend.
  windows: [
    { label: 'Next 24hr',   layerId: 1,  legend: QPF_LEGEND },
    { label: 'Next 3 days', layerId: 9,  legend: QPF_LEGEND },
    { label: 'Next 7 days', layerId: 11, legend: QPF_LEGEND },
  ],
  defaultWindow: 2,                          // open on the 7-day (least likely to look blank)
  legendTitle: 'Forecast precip',
  asOfPrefix:  'issued',
  legend: QPF_LEGEND,
}

// ─── CPC precip OUTLOOK — the probability-tilt layer (NOT inches) ───────────────
// CPC 6–10 day + monthly precipitation outlooks: a probability TILT (leaning wetter /
// equal chances / leaning drier), never an amount — so it gets its OWN diverging legend,
// never the AHPS/QPF inches scale, and "issued"/"outlook" framing so a rancher can't read
// a tilt as inches. Two horizons live on DIFFERENT MapServers (per-window `service`), both
// SR 4269 → reprojected to 3857 on export (same path as QPF), aligned with the county grid.
// Equal-Chances renders TRANSPARENT, so the legend carries an explicit "Equal chances" row
// (a hollow swatch) so transparent reads as "no strong signal", never as missing data.
// Seasonal precip is intentionally excluded — ~98% equal-chances over Montana reads empty.
// Colors are the EXACT service hex (decoded from /legend), condensed to a diverging key.
const OUTLOOK_BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks'
const OUTLOOK_LEGEND: LegendItem[] = [
  { color: '#007814',     label: 'Wetter (strong)' },
  { color: '#95ce7f',     label: 'Wetter (slight)' },
  { color: 'transparent', label: 'Equal chances' },   // EC = no fill on the map (hollow swatch here)
  { color: '#d8a74f',     label: 'Drier (slight)' },
  { color: '#804000',     label: 'Drier (strong)' },
]

export const cpcOutlook: RasterLayer = {
  id:          'outlook',
  label:       'Rain Outlook',
  category:    'water',
  type:        'raster',
  service:     `${OUTLOOK_BASE}/cpc_6_10_day_outlk/MapServer`,  // default; each window overrides
  endpoint:    '/api/layers/outlook',       // per-horizon { issued, valid } proxy
  attribution: 'NOAA/NWS CPC — Precipitation Outlook',
  loadingNote: 'Loading rain outlook…',
  failure:     { note: 'Rain outlook temporarily unavailable' },
  opacity:     0.6,                          // broad fills — a touch lighter so the base reads through
  windows: [
    { label: '6–10 day', key: '610',     layerId: 1, service: `${OUTLOOK_BASE}/cpc_6_10_day_outlk/MapServer`,     legend: OUTLOOK_LEGEND },
    { label: 'Monthly',  key: 'monthly', layerId: 0, service: `${OUTLOOK_BASE}/cpc_mthly_precip_outlk/MapServer`, legend: OUTLOOK_LEGEND },
  ],
  defaultWindow: 0,                          // open on 6–10 day (most signal, nearest term)
  defaultZoom:   5,                          // broad regional view (~5 states) — the tilt pattern needs context, not one county
  legendTitle: 'Rain outlook',
  asOfPrefix:  'issued',
  legend: OUTLOOK_LEGEND,
}

// ─── CPC DROUGHT outlook — categorical drought-DIRECTION forecast ───────────────
// CPC monthly + seasonal drought outlooks: a forecast of drought DIRECTION (develops /
// persists / improves / removes), not a probability tilt and not an amount — so it gets
// its OWN categorical legend. Both horizons live on ONE MapServer (cpc_drought_outlk),
// differing only by layerId (1 = monthly US&PR, 4 = seasonal US&PR), so no per-window
// service override is needed. SR 4326 → reprojected to 3857 on export (same path as the
// precip outlooks), aligned with the county grid. "No Drought" renders TRANSPARENT, so the
// legend carries an explicit hollow "No drought" row. Framing is "issued {date}" so it
// reads as a forecast of direction, never a certainty. Colors are the EXACT service hex.
const DROUGHT_OUTLOOK_SERVICE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_drought_outlk/MapServer'
const DROUGHT_OUTLOOK_LEGEND: LegendItem[] = [
  { color: '#ffde63',     label: 'Develops' },     // drought likely to develop
  { color: '#9b634a',     label: 'Persists' },     // drought continues
  { color: '#ded4bc',     label: 'Improves' },     // improves but remains
  { color: '#b2ad69',     label: 'Removal likely' },// drought likely removed
  { color: 'transparent', label: 'No drought' },   // no category → no fill on the map (hollow swatch)
]

export const cpcDroughtOutlook: RasterLayer = {
  id:          'drought-outlook',
  label:       'Drought Forecast',
  category:    'drought',
  type:        'raster',
  service:     DROUGHT_OUTLOOK_SERVICE,      // both windows share it (different layerIds only)
  endpoint:    '/api/layers/drought-outlook',
  attribution: 'NOAA/NWS CPC — Drought Outlook',
  loadingNote: 'Loading drought outlook…',
  failure:     { note: 'Drought outlook temporarily unavailable' },
  opacity:     0.6,
  windows: [
    { label: 'Monthly',  key: 'monthly',  layerId: 1, legend: DROUGHT_OUTLOOK_LEGEND },
    { label: 'Seasonal', key: 'seasonal', layerId: 4, legend: DROUGHT_OUTLOOK_LEGEND },
  ],
  defaultWindow: 0,                          // open on Monthly (nearer-term)
  defaultZoom:   5,                          // broad regional view, like Rain Outlook
  legendTitle: 'Drought forecast',
  asOfPrefix:  'issued',
  legend: DROUGHT_OUTLOOK_LEGEND,
}

// Radar FIRST → LAYERS[0] is the default active tab the map opens on; the vector layers
// (USDM, alerts), the three precip rasters (observed → forecast → outlook), and the
// drought outlook follow it. Six toggle tabs (a transitional flat bar — wraps cleanly).
// alerts is inToggle:false (radar overlay only), so it gets no tab.
export const LAYERS: LayerDefinition[] = [radar, usdm, ahpsObserved, wpcQpf, cpcOutlook, cpcDroughtOutlook, alerts]
