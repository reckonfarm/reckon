'use client'

import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { FeatureCollection } from 'geojson'
import OfficialMap, { type OfficialMapRecord } from './OfficialMap'
import { LAYERS, type VectorLayer, type LayerRuntime } from './layers'

// ─── Regional map — registry-driven (layer-platform STEP 1) ────────────────────
// Renders the active layer GENERICALLY from the registry (./layers.ts). Map layers
// (currently just USDM) come from LAYERS; the CPC Monthly/Seasonal drought-tendency
// outlooks are national reference images (not map layers) shown via OfficialMap in
// the same toggle. Adding a registry layer = +1 definition + 1 proxy route, 0 changes
// here.

const CONUS: [number, number] = [39.5, -98.5]
const RUST = '#C2410C'

function fmtEpoch(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Defensive HTML-escape for popup text (NWS event/headline is plain text, but escape so
// no upstream content can inject markup into the Leaflet popup).
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}

// Per-endpoint cache so toggling away to an outlook image and back doesn't re-fetch /
// re-flash the (national, county-independent) vector data. Keyed by endpoint.
const layerCache = new Map<string, { geo: FeatureCollection; asOfMs: number | null }>()

export interface RegionalMapClientProps {
  center:      [number, number] | null
  countyLabel: string
  monthlyMap:  OfficialMapRecord | null
  seasonalMap: OfficialMapRecord | null
  // Per-layer, county-dynamic extras keyed by layer id (e.g. USDM's static-image fallback).
  runtime?:    Record<string, LayerRuntime>
}

type Status = 'loading' | 'ok' | 'empty' | 'error'

// Shared legend / freshness card for a vector layer.
function LegendCard({ layer, status, asOf, count }: { layer: VectorLayer; status: Status; asOf: string | null; count: number }) {
  // Status line, in priority order. 'empty' (honest-good, e.g. "No active alerts") is
  // distinct from 'error' (honest-degraded, "temporarily unavailable"). An 'ok' layer
  // with no asOf (e.g. alerts) shows a live count instead of a date.
  const line =
    status === 'loading'
      ? (layer.loadingNote ?? 'Loading…')
      : status === 'error'
        ? <span style={{ color: RUST }}>{layer.failure.note}</span>
        : status === 'empty'
          ? <span className="text-forest-green/60">{layer.emptyNote ?? 'None active'}</span>
          : asOf
            ? `As of ${asOf}`
            : <span className="text-forest-green/70">{count} active</span>
  return (
    <div className="absolute bottom-3 right-3 z-[1000] rounded-lg border border-black/10 bg-white/95 px-3 py-2 font-dm-sans shadow-sm">
      <div className="text-xs font-semibold text-forest-green">{layer.attribution}</div>
      <div className="mb-1.5 text-[10px] text-forest-green/50">{line}</div>
      {layer.legend.map(({ color, label }) => (
        <div key={label} className="mb-0.5 flex items-center gap-1.5 text-[11px] text-forest-green/70">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color, border: '1px solid rgba(0,0,0,0.15)' }} />
          {label}
        </div>
      ))}
    </div>
  )
}

// Generic VECTOR layer renderer — fetches the layer's proxy (GeoJSON + asOf) and draws it.
function VectorLayerView({ layer, runtime, center, zoom, countyLabel }: {
  layer:       VectorLayer
  runtime?:    LayerRuntime
  center:      [number, number]
  zoom:        number
  countyLabel: string
}) {
  // County-dynamic endpoint (e.g. alerts ?area=ST) is injected via runtime; layers
  // without one (USDM) fall back to their static registry endpoint, unchanged.
  const endpoint = runtime?.endpoint ?? layer.endpoint
  const cached = layerCache.get(endpoint)
  const [geo, setGeo]       = useState<FeatureCollection | null>(cached?.geo ?? null)
  const [status, setStatus] = useState<Status>(cached ? 'ok' : 'loading')
  const [asOfMs, setAsOfMs] = useState<number | null>(cached?.asOfMs ?? null)

  useEffect(() => {
    if (layerCache.has(endpoint)) return  // already loaded this session — no re-fetch / no flash
    let cancelled = false
    fetch(endpoint)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((g: FeatureCollection & { releaseDate?: number; error?: boolean }) => {
        if (cancelled) return
        // Three-state honesty: error:true is a real failure; features:[] WITHOUT error
        // is genuinely empty — honest-good for flagged layers (alerts → "No active
        // alerts"), but treated as error for others (USDM) exactly as before.
        // Clear any prior geometry on a non-ok result so the map never keeps drawing
        // a previous layer/county's polygons under a new status (the cross-layer bleed).
        if (g.error) { setGeo(null); setAsOfMs(null); setStatus('error'); return }
        if (!Array.isArray(g.features) || g.features.length === 0) {
          setGeo(null); setAsOfMs(null); setStatus(layer.emptyIsHonest ? 'empty' : 'error'); return
        }
        const ms = layer.asOfFrom ? layer.asOfFrom(g) : null
        layerCache.set(endpoint, { geo: g, asOfMs: ms })
        setGeo(g); setAsOfMs(ms); setStatus('ok')
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [endpoint, layer])

  const asOf          = asOfMs ? fmtEpoch(asOfMs) : null
  const fallbackImage = runtime?.fallbackImage

  // Honest failure: if the proxy errored and a static fallback image exists, show it.
  if (status === 'error' && fallbackImage?.url) {
    return (
      <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white">
        <div className="border-b border-forest-green/10 px-4 py-3">
          <h3 className="font-fraunces text-base font-semibold text-forest-green">{layer.attribution}</h3>
          <p className="mt-0.5 font-dm-sans text-xs" style={{ color: RUST }}>
            Interactive map temporarily unavailable — showing the latest static map.
          </p>
        </div>
        <div className="p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fallbackImage.url} alt={`${layer.attribution} — ${countyLabel}`} className="w-full rounded-lg object-contain" loading="lazy" />
          <p className="mt-3 font-dm-sans text-xs text-forest-green/50">
            Source:{' '}
            <a href={fallbackImage.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-forest-green/70">
              {layer.attribution}
            </a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-[400px] overflow-hidden rounded-xl border border-forest-green/10">
      <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {status === 'ok' && geo && (
          <GeoJSON
            key={asOfMs ?? layer.id}
            data={geo}
            style={layer.style}
            onEachFeature={(feature, lyr) => {
              // Tap-to-identify, ALERTS-SCOPED: bind a popup only for layers that define
              // clickInfo (alerts). USDM has no clickInfo → this no-ops, no behaviour change.
              if (!layer.clickInfo) return
              const { title, body } = layer.clickInfo(feature)
              lyr.bindPopup(
                `<strong>${escapeHtml(title)}</strong>${body ? `<br><span>${escapeHtml(body)}</span>` : ''}`,
              )
            }}
          />
        )}
      </MapContainer>
      <LegendCard layer={layer} status={status} asOf={asOf} count={geo?.features.length ?? 0} />
    </div>
  )
}

export default function RegionalMapClient({ center, countyLabel, monthlyMap, seasonalMap, runtime = {} }: RegionalMapClientProps) {
  const [tab, setTab] = useState<string>(LAYERS[0]?.id ?? 'usdm')
  const mapCenter = center ?? CONUS
  const mapZoom   = center ? 6 : 4

  const activeLayer = LAYERS.find(l => l.id === tab)

  // Toggle = registry map layers + the CPC outlook images.
  const tabs = [
    ...LAYERS.map(l => ({ id: l.id, label: l.label })),
    { id: 'monthly',  label: 'Monthly Outlook'  },
    { id: 'seasonal', label: 'Seasonal Outlook' },
  ]

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-forest-green/5 p-1">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`rounded-md px-3 py-1.5 font-dm-sans text-sm font-medium transition-colors ${
              tab === id ? 'bg-forest-green text-cream' : 'text-forest-green/60 hover:text-forest-green'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeLayer && activeLayer.type === 'vector' ? (
        // Key by the resolved endpoint (county-dynamic for alerts) so the view REMOUNTS
        // fresh on a layer OR county change — geo/status re-init per layer from the
        // per-endpoint cache, so no prior layer's/county's geometry can bleed through.
        <VectorLayerView key={runtime[activeLayer.id]?.endpoint ?? activeLayer.id} layer={activeLayer} runtime={runtime[activeLayer.id]} center={mapCenter} zoom={mapZoom} countyLabel={countyLabel} />
      ) : (
        <OfficialMap
          map={tab === 'monthly' ? monthlyMap : seasonalMap}
          title={tab === 'monthly' ? 'Monthly Drought Outlook' : 'Seasonal Drought Outlook'}
        />
      )}

      <p className="mt-2 font-dm-sans text-xs text-forest-green/45">
        {activeLayer
          ? `Interactive ${activeLayer.attribution}, centered on your county. Base map © OpenStreetMap.`
          : 'CPC national drought outlook — issued monthly.'}
      </p>
    </div>
  )
}
