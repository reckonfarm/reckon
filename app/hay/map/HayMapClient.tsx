'use client'

import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, GeoJSON, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import Link from 'next/link'
import 'leaflet/dist/leaflet.css'
import type { Feature, FeatureCollection } from 'geojson'
import { warning } from '@/lib/brand-colors'

export interface MapListing {
  id: string
  hay_type: string | null
  listing_type: string
  price_per_ton: number | null
  tonnage: number | null
  lat: number
  lon: number
  drought_tier: number | null
  county_name: string
  state: string
}

// Official U.S. Drought Monitor palette (matches the dashboard and the real
// USDM map). Used for BOTH the drought polygons and the hay pins so the map
// reads as one consistent drought scale. D0 yellow is distinct from the
// forest-green "no drought" pin.
const DROUGHT_COLORS: Record<number, string> = {
  4: '#730000',
  3: '#E60000',
  2: '#FFAA00',
  1: '#FCD37F',
  0: '#FFFF00',
}
const NO_DROUGHT = '#1B4332'

// Shared legend rows (D-scale, dry → wet). Used by BOTH the full legend and the
// compact collapsible one so they never drift; text labels keep it colorblind-safe.
const LEGEND_ROWS: { tier: number; label: string }[] = [
  { tier: 4, label: 'D4 Exceptional' },
  { tier: 3, label: 'D3 Extreme' },
  { tier: 2, label: 'D2 Severe' },
  { tier: 1, label: 'D1 Moderate' },
  { tier: 0, label: 'D0 Abnormally dry' },
  { tier: -1, label: 'No drought' },
]

function pinColor(tier: number | null): string {
  if (tier === null) return NO_DROUGHT
  return DROUGHT_COLORS[tier] ?? NO_DROUGHT
}

// ── Toggleable overlays — self-contained layer registry for THIS map ─────────────
// Data-driven like the regional map's layers.ts, but deliberately NOT on that system
// (no RasterLayerView, no regional map). Adding the future hay-score layer = ONE entry
// here + one render gate keyed on its id (see the {overlayVisible.<id>} gate below).
// Pins are NOT overlays — they always render regardless of these toggles.
interface HayMapOverlay {
  id:    'drought'   // widen the union as layers are added (e.g. | 'hayScore')
  label: string
  defaultVisible: boolean
}
const HAY_MAP_OVERLAYS: HayMapOverlay[] = [
  { id: 'drought', label: 'Drought Monitor', defaultVisible: false },
  // future: { id: 'hayScore', label: 'Hay score', defaultVisible: false },
]

function clusterColor(markers: { options: { fillColor?: string } }[]): string {
  const priority = ['#730000', '#E60000', '#FFAA00', '#FCD37F', '#FFFF00']
  for (const color of priority) {
    if (markers.some(m => m.options?.fillColor === color)) return color
  }
  return NO_DROUGHT
}

function createClusterIcon(cluster: { getChildCount: () => number; getAllChildMarkers: () => { options: { fillColor?: string } }[] }) {
  const count = cluster.getChildCount()
  const markers = cluster.getAllChildMarkers()
  const color = clusterColor(markers)
  // D0 yellow needs dark text for legibility; darker categories use white.
  const textColor = color === '#FFFF00' || color === '#FCD37F' ? '#451A00' : 'white'
  const size = count < 10 ? 32 : count < 50 ? 38 : 44
  const L = (window as unknown as { L: { divIcon: (opts: object) => object } }).L
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:2.5px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;color:${textColor};font-size:11px;font-weight:600;font-family:var(--font-dm-sans);box-shadow:0 1px 4px rgba(0,0,0,0.25)">${count}</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function ResetButton() {
  const map = useMap()
  return (
    <div className="leaflet-bottom leaflet-left" style={{ marginBottom: 24, marginLeft: 12 }}>
      <div className="leaflet-control">
        <button
          onClick={() => map.setView([39.5, -98.5], 4)}
          className="rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs font-dm-sans text-forest-green shadow-sm hover:bg-gray-50"
        >
          Reset view
        </button>
      </div>
    </div>
  )
}

// Self-contained on-map layer control (mirrors ResetButton's leaflet-control pattern).
// One checkbox per overlay in the registry — a new layer needs no control changes.
// Top-right, clear of the legend (bottom-right), Reset (bottom-left), and zoom (top-left).
function LayerControl({
  overlays,
  visible,
  onToggle,
}: {
  overlays: HayMapOverlay[]
  visible: Record<string, boolean>
  onToggle: (id: string) => void
}) {
  return (
    <div className="leaflet-top leaflet-right" style={{ marginTop: 12, marginRight: 12 }}>
      <div className="leaflet-control">
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
          <p className="mb-1.5 font-dm-sans text-[10px] font-semibold uppercase tracking-wide text-forest-green/40">
            Layers
          </p>
          {overlays.map(o => (
            <label
              key={o.id}
              className="flex cursor-pointer items-center gap-2 font-dm-sans text-xs text-forest-green"
            >
              <input
                type="checkbox"
                checked={visible[o.id] ?? false}
                onChange={() => onToggle(o.id)}
                className="h-3.5 w-3.5 accent-forest-green"
              />
              {o.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

// Translucent fill per drought category, non-interactive so it never steals
// clicks from the pins/clusters above it.
function droughtLayerStyle(feature?: Feature) {
  const dm = feature?.properties?.DM as number | undefined
  const color = dm != null ? DROUGHT_COLORS[dm] ?? '#999999' : '#999999'
  return {
    fillColor: color,
    fillOpacity: 0.35,
    color,
    weight: 0.5,
    opacity: 0.4,
    interactive: false,
  }
}

type DroughtStatus = 'loading' | 'ok' | 'error'

interface HayMapClientProps {
  listings: MapListing[]
  // Preview mode (homepage): fixed view, all interaction off, no pins/legend.
  // Defaults preserve the full interactive listing-map behavior.
  center?: [number, number]
  zoom?: number
  height?: string
  interactive?: boolean
  showLegend?: boolean
  // Compact legend — a collapsed-by-default "Legend" chip that expands on demand,
  // for small embeds (the dashboard hay map) where the full panel covers the canvas.
  // Defaults false so the full-screen /hay/map keeps its existing always-open legend.
  compactLegend?: boolean
  // Show the on-map layer control and make the drought overlay toggleable (default off
  // when control is shown). Defaults false so the full-screen /hay/map keeps drought
  // always-on with no control — byte-identical to today.
  layerControl?: boolean
  // Fires once the base tiles AND the drought overlay have actually loaded — lets
  // the homepage cross-fade the live map in only when it's fully painted (no flash).
  onReady?: () => void
}

export default function HayMapClient({
  listings,
  center = [39.5, -98.5],
  zoom = 4,
  height = 'calc(100vh - 64px)',
  interactive = true,
  showLegend = true,
  compactLegend = false,
  layerControl = false,
  onReady,
}: HayMapClientProps) {
  const [drought, setDrought] = useState<FeatureCollection | null>(null)
  const [releaseDate, setReleaseDate] = useState<number | null>(null)
  const [status, setStatus] = useState<DroughtStatus>('loading')
  const [tilesLoaded, setTilesLoaded] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)   // compact legend: collapsed by default

  // Per-overlay visibility, seeded from the registry defaults. Only consulted when the
  // layer control is shown; /hay/map (layerControl=false) keeps drought always-on below.
  const [overlayVisible, setOverlayVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(HAY_MAP_OVERLAYS.map(o => [o.id, o.defaultVisible])),
  )
  const toggleOverlay = (id: string) =>
    setOverlayVisible(v => ({ ...v, [id]: !v[id] }))

  // /hay/map (no control) keeps the overlay always-on; the dashboard embed follows the toggle.
  const showDrought = layerControl ? overlayVisible.drought : true
  const readyFired = useRef(false)

  // Signal "fully painted" once the basemap tiles have loaded AND the drought
  // overlay has settled (rendered, or definitively failed). Fires at most once.
  useEffect(() => {
    if (readyFired.current || !onReady) return
    const droughtSettled = status === 'ok' ? !!drought : status === 'error'
    if (tilesLoaded && droughtSettled) {
      readyFired.current = true
      onReady()
    }
  }, [tilesLoaded, status, drought, onReady])

  useEffect(() => {
    // Fix leaflet default icon paths in Next.js
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).L?.Icon?.Default?.prototype?._getIconUrl
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/usdm')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((geo: FeatureCollection & { releaseDate?: number; error?: boolean }) => {
        if (cancelled) return
        if (geo.error || !Array.isArray(geo.features) || geo.features.length === 0) {
          setStatus('error')
          return
        }
        setDrought(geo)
        setReleaseDate(geo.releaseDate ?? null)
        setStatus('ok')
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [])

  const asOf = releaseDate
    ? new Date(releaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div style={{ height, width: '100%', position: 'relative' }}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={interactive}
        dragging={interactive}
        doubleClickZoom={interactive}
        touchZoom={interactive}
        boxZoom={interactive}
        keyboard={interactive}
        zoomControl={interactive}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{ load: () => setTilesLoaded(true) }}
        />

        {/* Drought layer — rendered first so it sits beneath the pins/clusters.
            Toggleable via the layer control on the dashboard embed; always-on elsewhere. */}
        {showDrought && drought && (
          <GeoJSON
            key={releaseDate ?? 'usdm'}
            data={drought}
            style={droughtLayerStyle}
            interactive={false}
          />
        )}

        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createClusterIcon}
          maxClusterRadius={50}
          showCoverageOnHover={false}
          zoomToBoundsOnClick
        >
          {listings.map(l => (
            <CircleMarker
              key={l.id}
              center={[l.lat, l.lon]}
              radius={8}
              pathOptions={{
                fillColor: pinColor(l.drought_tier),
                fillOpacity: 0.85,
                color: '#fff',
                weight: 1.5,
              }}
            >
              <Popup>
                <div style={{ fontFamily: 'var(--font-dm-sans)', minWidth: 160 }}>
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>
                    {l.hay_type ?? 'Hay'} — {l.county_name}, {l.state}
                  </p>
                  {l.tonnage && <p style={{ fontSize: 12, color: '#555' }}>{l.tonnage} tons</p>}
                  {l.price_per_ton && <p style={{ fontSize: 12, color: '#555' }}>${l.price_per_ton}/ton</p>}
                  <Link
                    href={`/hay/${l.id}`}
                    style={{ fontSize: 12, color: '#1B4332', textDecoration: 'underline', display: 'block', marginTop: 6 }}
                  >
                    View listing →
                  </Link>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MarkerClusterGroup>
        {interactive && <ResetButton />}
        {layerControl && (
          <LayerControl overlays={HAY_MAP_OVERLAYS} visible={overlayVisible} onToggle={toggleOverlay} />
        )}
      </MapContainer>

      {/* Legend — drought layer (shaded regions) + pins, one shared D-scale.
          Full (always-open) panel for the full-screen /hay/map; compact collapsible
          chip for small embeds (compactLegend) so it never covers the canvas. */}
      {showLegend && !compactLegend && (
      <div style={{
        position: 'absolute', bottom: 32, right: 12, zIndex: 1000,
        background: 'white', border: '1px solid rgba(0,0,0,0.1)',
        borderRadius: 8, padding: '8px 12px', fontSize: 11,
        fontFamily: 'var(--font-dm-sans)', maxWidth: 210,
      }}>
        <div style={{ fontWeight: 600, color: '#1B4332', marginBottom: 1 }}>
          U.S. Drought Monitor
        </div>
        <div style={{ color: '#888', marginBottom: 6, fontSize: 10 }}>
          {status === 'ok' && asOf && `As of ${asOf}`}
          {status === 'loading' && 'Loading drought layer…'}
          {status === 'error' && (
            <span style={{ color: warning }}>Drought layer temporarily unavailable</span>
          )}
        </div>

        {LEGEND_ROWS.map(({ tier, label }) => (
          <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <div style={{
              width: 11, height: 11, borderRadius: 2,
              background: pinColor(tier === -1 ? null : tier),
              border: '1px solid rgba(0,0,0,0.15)',
            }} />
            <span style={{ color: '#444' }}>{label}</span>
          </div>
        ))}

        <div style={{ color: '#888', marginTop: 6, fontSize: 10, lineHeight: 1.35, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 6 }}>
          Shaded regions show drought severity. Pins are hay listings, colored by their county&apos;s level.
        </div>
      </div>
      )}

      {/* Compact legend — collapsed-by-default chip; expands to the same D-scale. */}
      {showLegend && compactLegend && (
      <div style={{
        position: 'absolute', bottom: 32, right: 12, zIndex: 1000,
        fontFamily: 'var(--font-dm-sans)', fontSize: 11,
      }}>
        {legendOpen ? (
          <div style={{
            background: 'white', border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: 8, padding: '8px 10px', maxWidth: 180,
            boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
              <span style={{ fontWeight: 600, color: '#1B4332' }}>Drought Monitor</span>
              <button
                onClick={() => setLegendOpen(false)}
                aria-label="Hide legend"
                style={{ border: 'none', background: 'none', color: '#888', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
              >
                ✕
              </button>
            </div>
            <div style={{ color: '#888', marginBottom: 6, fontSize: 10 }}>
              {status === 'ok' && asOf && `As of ${asOf}`}
              {status === 'loading' && 'Loading…'}
              {status === 'error' && (
                <span style={{ color: warning }}>Layer unavailable</span>
              )}
            </div>
            {LEGEND_ROWS.map(({ tier, label }) => (
              <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <div style={{
                  width: 11, height: 11, borderRadius: 2,
                  background: pinColor(tier === -1 ? null : tier),
                  border: '1px solid rgba(0,0,0,0.15)',
                }} />
                <span style={{ color: '#444' }}>{label}</span>
              </div>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setLegendOpen(true)}
            aria-label="Show drought legend"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'white', border: '1px solid rgba(0,0,0,0.1)',
              borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
              color: '#1B4332', fontWeight: 600, fontSize: 11,
              fontFamily: 'var(--font-dm-sans)', boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            }}
          >
            {/* Mini D-scale swatch strip so the chip reads as a legend at a glance */}
            <span style={{ display: 'inline-flex', borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.15)' }}>
              {[0, 1, 2, 3, 4].map(t => (
                <span key={t} style={{ width: 7, height: 11, background: pinColor(t) }} />
              ))}
            </span>
            Legend
          </button>
        )}
      </div>
      )}
    </div>
  )
}
