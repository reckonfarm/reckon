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

export type LayerDefinition = VectorLayer | TileLayer | ImageLayer

// Per-render, county-dynamic extras keyed by layer id, injected by the page (e.g. the
// USDM static-image fallback URL, which is computed server-side per county).
export interface LayerRuntime {
  fallbackImage?: { url: string | null; sourceUrl: string }
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

export const LAYERS: LayerDefinition[] = [usdm]
