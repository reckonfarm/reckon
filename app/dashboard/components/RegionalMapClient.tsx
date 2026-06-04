'use client'

import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Feature, FeatureCollection } from 'geojson'
import OfficialMap, { type OfficialMapRecord } from './OfficialMap'

// ─── Regional map (Slice B) ────────────────────────────────────────────────────
// ONE map section with a layer toggle, inside the "Regional context" accordion.
//
//   • Drought Monitor — a TRUE interactive, zoomable Leaflet layer: the current
//     USDM polygons (D0–D4) from /api/usdm (the official ArcGIS FeatureServer,
//     generalized), centered on the rancher's county. Honest about freshness
//     ("As of …") and failure ("temporarily unavailable" / the latest static
//     USDM image) — never a blank/false map.
//   • Monthly / Seasonal Drought Outlook — CPC national products. These are only
//     published as pre-rendered national images (no clean public tile/feature
//     service), so they stay as their existing images here, with source + as-of.
//     (See the slice notes / the fork surfaced to the user.)

const DROUGHT_COLORS: Record<number, string> = {
  4: '#730000', 3: '#E60000', 2: '#FFAA00', 1: '#FCD37F', 0: '#FFFF00',
}

// Official USDM palette, translucent, non-interactive overlay.
function droughtStyle(feature?: Feature) {
  const dm = feature?.properties?.DM as number | undefined
  const color = dm != null ? (DROUGHT_COLORS[dm] ?? '#999999') : '#999999'
  return { fillColor: color, fillOpacity: 0.5, color, weight: 0.5, opacity: 0.5, interactive: false }
}

function fmtEpoch(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const CONUS: [number, number] = [39.5, -98.5]
const RUST = '#C2410C'

const LEGEND = [
  { tier: 4, label: 'D4 Exceptional' },
  { tier: 3, label: 'D3 Extreme' },
  { tier: 2, label: 'D2 Severe' },
  { tier: 1, label: 'D1 Moderate' },
  { tier: 0, label: 'D0 Abnormally dry' },
]

export interface RegionalMapClientProps {
  center:                [number, number] | null
  countyLabel:           string
  monthlyMap:            OfficialMapRecord | null
  seasonalMap:           OfficialMapRecord | null
  usdmFallbackUrl:       string | null
  usdmFallbackSourceUrl: string
}

type Tab = 'usdm' | 'monthly' | 'seasonal'
type UsdmStatus = 'loading' | 'ok' | 'error'

export default function RegionalMapClient({
  center, countyLabel, monthlyMap, seasonalMap, usdmFallbackUrl, usdmFallbackSourceUrl,
}: RegionalMapClientProps) {
  const [tab, setTab]                 = useState<Tab>('usdm')
  const [drought, setDrought]         = useState<FeatureCollection | null>(null)
  const [status, setStatus]           = useState<UsdmStatus>('loading')
  const [releaseDate, setReleaseDate] = useState<number | null>(null)

  // Current USDM polygons — same proxied + cached source the hay map uses.
  useEffect(() => {
    let cancelled = false
    fetch('/api/usdm')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((geo: FeatureCollection & { releaseDate?: number; error?: boolean }) => {
        if (cancelled) return
        if (geo.error || !Array.isArray(geo.features) || geo.features.length === 0) { setStatus('error'); return }
        setDrought(geo)
        setReleaseDate(geo.releaseDate ?? null)
        setStatus('ok')
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [])

  const mapCenter = center ?? CONUS
  const mapZoom   = center ? 6 : 4
  const asOf      = releaseDate ? fmtEpoch(releaseDate) : null

  return (
    <div>
      {/* Layer toggle */}
      <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-forest-green/5 p-1">
        {([['usdm', 'Drought Monitor'], ['monthly', 'Monthly Outlook'], ['seasonal', 'Seasonal Outlook']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`rounded-md px-3 py-1.5 font-dm-sans text-sm font-medium transition-colors ${
              tab === key ? 'bg-forest-green text-cream' : 'text-forest-green/60 hover:text-forest-green'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'usdm' ? (
        status === 'error' && usdmFallbackUrl ? (
          // Interactive layer failed → show the latest static USDM map (honest, never blank).
          <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white">
            <div className="border-b border-forest-green/10 px-4 py-3">
              <h3 className="font-fraunces text-base font-semibold text-forest-green">U.S. Drought Monitor</h3>
              <p className="mt-0.5 font-dm-sans text-xs" style={{ color: RUST }}>
                Interactive map temporarily unavailable — showing the latest static map.
              </p>
            </div>
            <div className="p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={usdmFallbackUrl} alt={`U.S. Drought Monitor — ${countyLabel}`} className="w-full rounded-lg object-contain" loading="lazy" />
              <p className="mt-3 font-dm-sans text-xs text-forest-green/50">
                Source:{' '}
                <a href={usdmFallbackSourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-forest-green/70">
                  U.S. Drought Monitor
                </a>
              </p>
            </div>
          </div>
        ) : (
          <div className="relative h-[400px] overflow-hidden rounded-xl border border-forest-green/10">
            <MapContainer center={mapCenter} zoom={mapZoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {drought && <GeoJSON key={releaseDate ?? 'usdm'} data={drought} style={droughtStyle} />}
            </MapContainer>

            {/* Legend + freshness/failure note */}
            <div className="absolute bottom-3 right-3 z-[1000] rounded-lg border border-black/10 bg-white/95 px-3 py-2 font-dm-sans shadow-sm">
              <div className="text-xs font-semibold text-forest-green">U.S. Drought Monitor</div>
              <div className="mb-1.5 text-[10px] text-forest-green/50">
                {status === 'ok' && asOf
                  ? `As of ${asOf}`
                  : status === 'loading'
                    ? 'Loading drought layer…'
                    : <span style={{ color: RUST }}>Layer temporarily unavailable</span>}
              </div>
              {LEGEND.map(({ tier, label }) => (
                <div key={tier} className="mb-0.5 flex items-center gap-1.5 text-[11px] text-forest-green/70">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: DROUGHT_COLORS[tier], border: '1px solid rgba(0,0,0,0.15)' }} />
                  {label}
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        <OfficialMap
          map={tab === 'monthly' ? monthlyMap : seasonalMap}
          title={tab === 'monthly' ? 'Monthly Drought Outlook' : 'Seasonal Drought Outlook'}
        />
      )}

      <p className="mt-2 font-dm-sans text-xs text-forest-green/45">
        {tab === 'usdm'
          ? 'Interactive U.S. Drought Monitor, centered on your county. Base map © OpenStreetMap.'
          : 'CPC national drought outlook — issued monthly.'}
      </p>
    </div>
  )
}
