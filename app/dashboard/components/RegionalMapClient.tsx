'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { FeatureCollection } from 'geojson'
import { LAYERS, type VectorLayer, type RadarLayer, type LayerRuntime } from './layers'
import { timeoutSignal } from '@/lib/external-fetch'

// alerts stays REGISTERED (its data + LayerRuntime endpoint flow normally) but is NOT a
// toggle tab (inToggle:false) — it renders only as the radar overlay. Resolve its static
// registry def once; the county-dynamic endpoint is passed in per render.
const ALERTS_LAYER: VectorLayer | null =
  (LAYERS.find((l): l is VectorLayer => l.id === 'alerts' && l.type === 'vector')) ?? null

// ─── Regional map — registry-driven (layer-platform STEP 1) ────────────────────
// Renders the active layer GENERICALLY from the registry (./layers.ts). Every toggle
// segment is a map layer from LAYERS (radar, USDM, alerts). The CPC Monthly/Seasonal
// drought outlooks are national reference IMAGES (not map layers), so they live in the
// "Forecast" deep-dive accordion on the dashboard, not in this toggle. Adding a registry
// layer = +1 definition + 1 proxy route, 0 changes here.

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
  // Selected county FIPS (5-char zero-padded, matches the grid's GEOID) — highlights that
  // county in the base grid. Optional: national/no-county view passes none → uniform grid.
  fips?:       string
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

// ─── County-boundary base grid (always-on, UNDER every layer) ──────────────────
// Static cattle-belt county outlines (1,169 counties, GEOID-only, ~42 KB gzipped),
// fetched ONCE and drawn as a thin stroke-only reference grid on a CANVAS renderer
// (~1,169 paths drawn to one canvas, NOT 1,169 SVG nodes — smooth on the cab). The
// grid is interactive:false → it captures no taps, so alert popups still fire and the
// grid never eats a tap; the data layers keep their own (default SVG) renderer, so
// USDM/alerts draw exactly as before. Inserted as the FIRST child of each MapContainer
// → its renderer container is created first, so the grid sits at the BOTTOM of the
// overlay stack (under drought fills / alert polygons) and above the base + radar tiles
// (which live in the lower tilePane). Honest-degraded: if the asset fails to load, the
// map renders normally WITHOUT the grid — it's a reference overlay, not data, so there
// is no error state, just no lines.
const COUNTY_LINES_SRC = '/geo/cattle-belt-counties.json'

// Module-level cache so toggling tabs / re-mounting either map never re-fetches the
// (static, county-independent) grid.
let countyGeoCache: FeatureCollection | null = null

function CountyLines({ selectedFips }: { selectedFips?: string }) {
  const [geo, setGeo] = useState<FeatureCollection | null>(countyGeoCache)
  // Per-instance canvas renderer (a renderer binds to one map; only one map is mounted
  // at a time, but each CountyLines gets its own to be safe).
  const renderer = useMemo(() => L.canvas(), [])

  useEffect(() => {
    if (countyGeoCache) return            // already loaded this session — no re-fetch
    let cancelled = false
    fetch(COUNTY_LINES_SRC)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((g: FeatureCollection) => {
        if (cancelled) return
        countyGeoCache = g
        setGeo(g)
      })
      .catch(() => { /* reference overlay — on failure just render no grid, no error UI */ })
    return () => { cancelled = true }
  }, [])

  if (!geo) return null
  // Per-feature style: the SELECTED county (GEOID === selectedFips, both 5-char zero-padded
  // strings — no normalization) draws a heavier near-black outline so the rancher finds it
  // at a glance; every other county keeps the thin gray grid. Still stroke-only and
  // interactive:false (no fill to fight the data, never eats an alert tap). The closure is
  // a fresh reference each render, so on a county change react-leaflet's GeoJSON re-applies
  // it via setStyle — no key bump, no re-fetch (the cached `data` ref is unchanged).
  return (
    <GeoJSON
      data={geo}
      interactive={false}
      style={(feature) =>
        feature?.properties?.GEOID === selectedFips
          ? { color: '#1f2937', weight: 1.75, opacity: 0.9, fill: false, interactive: false, renderer }
          : { color: '#9ca3af', weight: 0.5,  opacity: 0.5, fill: false, interactive: false, renderer }
      }
    />
  )
}

// ─── Shared vector-layer fetch (hook) ──────────────────────────────────────────
// The fetch half of a vector layer: proxy → GeoJSON + asOf, the three-state honesty
// contract, and the per-endpoint session cache. NON-BLOCKING (runs in an effect AFTER
// paint, so it never delays the map render) and REQUEST-TIMED-OUT via timeoutSignal()
// (the standing external-fetch rule) — a hung/slow upstream becomes an honest 'error'
// instead of a permanent 'loading', never a false-empty. Used by BOTH the Drought
// Monitor view and the radar alerts overlay, so they share ONE fetch path, not two.
// Null endpoint/layer is tolerated (defensive: if alerts were ever unregistered) — it
// simply fetches nothing.
function useVectorLayer(endpoint: string | null, layer: VectorLayer | null) {
  const cached = endpoint ? layerCache.get(endpoint) : undefined
  const [geo, setGeo]       = useState<FeatureCollection | null>(cached?.geo ?? null)
  const [status, setStatus] = useState<Status>(cached ? 'ok' : 'loading')
  const [asOfMs, setAsOfMs] = useState<number | null>(cached?.asOfMs ?? null)

  // Reset to the new endpoint's cached state (or loading) the instant endpoint changes,
  // so a county switch on a NON-remounting host (the radar view) never shows the previous
  // county's polygons while the new fetch runs. React's sanctioned "adjust state when a
  // prop changes" pattern: compare a tracked STATE value during render (no extra paint).
  // Drought Monitor is keyed/remounted by its parent, so prevEndpoint already matches
  // there → this never fires, leaving that path byte-for-byte unchanged.
  const [prevEndpoint, setPrevEndpoint] = useState(endpoint)
  if (prevEndpoint !== endpoint) {
    setPrevEndpoint(endpoint)
    const c = endpoint ? layerCache.get(endpoint) : undefined
    setGeo(c?.geo ?? null)
    setAsOfMs(c?.asOfMs ?? null)
    setStatus(c ? 'ok' : 'loading')
  }

  useEffect(() => {
    if (!endpoint || !layer) return
    if (layerCache.has(endpoint)) return  // already loaded this session — no re-fetch / no flash
    let cancelled = false
    fetch(endpoint, { signal: timeoutSignal() })
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
      .catch(() => { if (!cancelled) setStatus('error') })  // includes AbortError (timeout) → honest error
    return () => { cancelled = true }
  }, [endpoint, layer])

  return { geo, status, asOfMs }
}

// ─── Shared vector GeoJSON overlay ─────────────────────────────────────────────
// The drawable half: one <GeoJSON> with the layer's style (or a per-host override, e.g.
// the radar alerts' heavier fill) and the alerts-scoped popup. Droppable as a child of
// ANY MapContainer — the Drought Monitor map and the radar map both render it, so the
// GeoJSON + popup code lives in exactly one place.
function VectorOverlay({ layer, geo, styleOverride }: {
  layer:          VectorLayer
  geo:            FeatureCollection
  styleOverride?: VectorLayer['style']
}) {
  return (
    <GeoJSON
      data={geo}
      style={styleOverride ?? layer.style}
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
  )
}

// Generic VECTOR layer view — its OWN MapContainer (Drought Monitor). Fetches via the
// shared hook, draws via the shared overlay; behaviour is identical to before the
// extraction (same condition, same key on the GeoJSON via the keyed overlay, same style).
function VectorLayerView({ layer, runtime, center, zoom, countyLabel, selectedFips }: {
  layer:        VectorLayer
  runtime?:     LayerRuntime
  center:       [number, number]
  zoom:         number
  countyLabel:  string
  selectedFips?: string
}) {
  // County-dynamic endpoint (e.g. alerts ?area=ST) is injected via runtime; layers
  // without one (USDM) fall back to their static registry endpoint, unchanged.
  const endpoint = runtime?.endpoint ?? layer.endpoint
  const { geo, status, asOfMs } = useVectorLayer(endpoint, layer)

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
        {/* County base grid FIRST → bottom of the overlay stack, under the data layer. */}
        <CountyLines selectedFips={selectedFips} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {status === 'ok' && geo && (
          // Keyed by asOfMs (USDM: release date) ?? layer.id — remounts the GeoJSON on new
          // data so Leaflet redraws, exactly as the inline GeoJSON key did before extraction.
          <VectorOverlay key={asOfMs ?? layer.id} layer={layer} geo={geo} />
        )}
      </MapContainer>
      <LegendCard layer={layer} status={status} asOf={asOf} count={geo?.features.length ?? 0} />
    </div>
  )
}

// ─── Animated RADAR layer renderer (RainViewer) ────────────────────────────────
// Structurally separate from VectorLayerView: Leaflet TileLayers cycling timestamped
// frames over the base map (no GeoJSON). Opens on the LATEST frame only (ONE tile-set,
// light for 3G); a play control loops the recent frames on demand. While playing it
// renders TWO tile buffers and CROSS-FADES opacity between the outgoing/incoming frame
// (masking the ~10-min positional jump that a hard swap shows as a pop), and PRELOADS
// the loop's tiles so frames don't arrive in chunks — both opt-in on PLAY, so the cab
// open cost is unchanged. All provider knobs (frameCount, loopSpeedMs cadence, fadeMs)
// come from the RadarLayer def (the swap point). Honest-degraded: a failed frame-list
// fetch shows "temporarily unavailable" with the base map still live — never a stale
// frame labelled current.
interface RadarFrame { time: number; path: string }

function RadarLayerView({ layer, center, zoom, selectedFips, alertsEndpoint }: { layer: RadarLayer; center: [number, number]; zoom: number; selectedFips?: string; alertsEndpoint: string | null }) {
  const [host, setHost]       = useState<string | null>(null)
  const [frames, setFrames]   = useState<RadarFrame[]>([])
  const [status, setStatus]   = useState<'loading' | 'ok' | 'error'>('loading')
  const [idx, setIdx]         = useState(0)           // active (front) frame
  const [prevIdx, setPrevIdx] = useState(0)           // outgoing (fading-out) frame
  const [front, setFront]     = useState<'a' | 'b'>('a')   // which of the two buffers is on top
  const [playing, setPlaying] = useState(layer.defaultMode === 'loop')
  const mapRef = useRef<L.Map | null>(null)

  // ALERTS OVERLAY — same shared fetch path as the Drought Monitor view (NON-blocking +
  // timed-out), so a slow/hung api.weather.gov never delays the radar paint; the overlay
  // just arrives when ready (or shows an honest status). Polygons reuse commit-2's
  // per-event NWS colors with a HEAVIER fill (0.18 vs 0.08) so the radar reads through;
  // NON_RENDERING events stay non-drawing (fill:false wins over the override). Honest
  // status surfaced below — fetch-fail must never look like a quiet day.
  const { geo: alertsGeo, status: alertsStatus } = useVectorLayer(alertsEndpoint, ALERTS_LAYER)
  const radarAlertStyle: VectorLayer['style'] = (feature) =>
    ALERTS_LAYER ? { ...ALERTS_LAYER.style(feature), fillOpacity: 0.18 } : {}
  const alertsCount = alertsGeo?.features.length ?? 0

  // Fetch the frame list; open on the LATEST frame (no auto-loop unless defaultMode says).
  useEffect(() => {
    let cancelled = false
    fetch(layer.endpoint)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((d: { host?: string; frames?: RadarFrame[]; error?: boolean }) => {
        if (cancelled) return
        if (d.error || !d.host || !Array.isArray(d.frames) || d.frames.length === 0) { setStatus('error'); return }
        const recent = d.frames.slice(-layer.frameCount)           // most-recent N
        const last = recent.length - 1
        setHost(d.host); setFrames(recent); setIdx(last); setPrevIdx(last); setStatus('ok')   // latest
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [layer.endpoint, layer.frameCount])

  // Loop only while playing — advance the frame AND flip the front buffer, so the new
  // frame fades IN (0 → opacity) while the outgoing one fades OUT. The two-buffer swap is
  // what turns the old hard cut into a cross-fade.
  useEffect(() => {
    if (!playing || frames.length < 2) return
    const t = setInterval(() => {
      setIdx(i => { setPrevIdx(i); return (i + 1) % frames.length })
      setFront(f => (f === 'a' ? 'b' : 'a'))
    }, layer.loopSpeedMs)
    return () => clearInterval(t)
  }, [playing, frames.length, layer.loopSpeedMs])

  // PRELOAD — opt-in on PLAY only (cab open cost unchanged). Warm the browser cache for
  // the visible viewport across every loop frame, so frames don't arrive in chunks mid-
  // loop (the load-flash). Best-effort and capped, so a zoomed-out view can't fire a
  // tile storm; tiles the buffers then request come straight from cache.
  useEffect(() => {
    if (!playing || !host || frames.length < 2) return
    const map = mapRef.current
    if (!map) return
    const z = Math.round(map.getZoom())
    const b = map.getBounds()
    const nw = map.project(b.getNorthWest(), z).divideBy(256).floor()
    const se = map.project(b.getSouthEast(), z).divideBy(256).floor()
    const cols = Math.max(0, Math.min(se.x - nw.x + 1, 6))
    const rows = Math.max(0, Math.min(se.y - nw.y + 1, 6))
    const imgs: HTMLImageElement[] = []
    for (const f of frames) {
      for (let dx = 0; dx < cols; dx++) {
        for (let dy = 0; dy < rows; dy++) {
          const img = new Image()
          img.src = `${host}${f.path}/${layer.size}/${z}/${nw.x + dx}/${nw.y + dy}/${layer.palette}/${layer.smooth}_${layer.snow}.png`
          imgs.push(img)
        }
      }
    }
    return () => { imgs.forEach(i => { i.src = '' }) }
  }, [playing, host, frames, layer.size, layer.palette, layer.smooth, layer.snow])

  // Build a frame's full tile-URL template ({z}/{x}/{y} left for Leaflet to fill).
  const frameUrl = (f?: RadarFrame) =>
    host && f
      ? layer.tileUrlTemplate
          .replace('{host}', host).replace('{path}', f.path)
          .replace('{size}', String(layer.size))
          .replace('{palette}', String(layer.palette))
          .replace('{smooth}', String(layer.smooth)).replace('{snow}', String(layer.snow))
      : null

  const frame   = frames[idx]
  const tileUrl = frameUrl(frame)                                  // single layer (latest / paused)
  const aUrl    = frameUrl(frames[front === 'a' ? idx : prevIdx])  // buffer A
  const bUrl    = frameUrl(frames[front === 'b' ? idx : prevIdx])  // buffer B
  const asOf = frame ? new Date(frame.time * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null

  return (
    <div className="relative h-[400px] overflow-hidden rounded-xl border border-forest-green/10">
      {/* Cross-fade timing — the className lands on each radar buffer's Leaflet layer
          container, whose opacity setOpacity animates over fadeMs (a radar-def knob). */}
      <style dangerouslySetInnerHTML={{ __html: `.leaflet-radar-fade{transition:opacity ${layer.fadeMs}ms linear;}` }} />
      <MapContainer ref={mapRef} center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        {/* County base grid on the RADAR default view too — sits under the radar tiles. */}
        <CountyLines selectedFips={selectedFips} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {/* Paused / latest: ONE tile-set (light for the cab). Playing: TWO buffers that
            cross-fade — the new frame fades in as the old fades out. */}
        {status === 'ok' && !playing && tileUrl && (
          <TileLayer url={tileUrl} opacity={layer.opacity} zIndex={500} />
        )}
        {status === 'ok' && playing && aUrl && (
          <TileLayer className="leaflet-radar-fade" url={aUrl} opacity={front === 'a' ? layer.opacity : 0} zIndex={500} />
        )}
        {status === 'ok' && playing && bUrl && (
          <TileLayer className="leaflet-radar-fade" url={bUrl} opacity={front === 'b' ? layer.opacity : 0} zIndex={500} />
        )}
        {/* Alerts LAST → top of the stack (base → radar → county lines → alerts). Draws
            ONLY on 'ok'; keyed by endpoint so a county switch remounts it fresh (no bleed). */}
        {ALERTS_LAYER && alertsStatus === 'ok' && alertsGeo && (
          <VectorOverlay key={alertsEndpoint ?? 'alerts'} layer={ALERTS_LAYER} geo={alertsGeo} styleOverride={radarAlertStyle} />
        )}
      </MapContainer>

      {/* Play/pause (only when there's a loop to run). */}
      {status === 'ok' && frames.length > 1 && (
        <button
          type="button"
          onClick={() => setPlaying(p => !p)}
          aria-pressed={playing}
          className="absolute bottom-3 left-3 z-[1000] rounded-lg border border-black/10 bg-white/95 px-3 py-1.5 font-dm-sans text-xs font-semibold text-forest-green shadow-sm hover:bg-white"
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
      )}

      {/* Alerts honest-status chip (top-left) — the merge's honest-degraded guarantee:
          a fetch-fail must NOT look like a quiet day. SEPARATE from the radar legend
          (below) and NOT a per-event color legend (that's a held-back later slice).
          'ok' draws polygons + shows the count; 'empty' = a genuine quiet day; 'error'
          (incl. the request timeout) = rust "Alerts unavailable"; 'loading' stays silent
          so the radar never looks blocked while alerts load. */}
      {ALERTS_LAYER && alertsStatus !== 'loading' && (
        <div className="absolute top-3 left-3 z-[1000] rounded-lg border border-black/10 bg-white/95 px-3 py-1.5 font-dm-sans text-xs shadow-sm">
          {alertsStatus === 'error'
            ? <span style={{ color: RUST }}>Alerts unavailable</span>
            : alertsStatus === 'empty'
              ? <span className="text-forest-green/60">No active alerts</span>
              : <span className="text-forest-green/80">{alertsCount} active alert{alertsCount !== 1 ? 's' : ''}</span>}
        </div>
      )}

      {/* Legend + staleness ("Radar as of HH:MM") / honest-degraded note. */}
      <div className="absolute bottom-3 right-3 z-[1000] rounded-lg border border-black/10 bg-white/95 px-3 py-2 font-dm-sans shadow-sm">
        <div className="text-xs font-semibold text-forest-green">{layer.attribution}</div>
        <div className="mb-1.5 text-[10px] text-forest-green/50">
          {status === 'loading'
            ? (layer.loadingNote ?? 'Loading…')
            : status === 'error'
              ? <span style={{ color: RUST }}>{layer.failure.note}</span>
              : asOf
                ? `Radar as of ${asOf}`
                : ''}
        </div>
        {layer.legend.map(({ color, label }) => (
          <div key={label} className="mb-0.5 flex items-center gap-1.5 text-[11px] text-forest-green/70">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color, border: '1px solid rgba(0,0,0,0.15)' }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RegionalMapClient({ center, countyLabel, fips, runtime = {} }: RegionalMapClientProps) {
  const [tab, setTab] = useState<string>(LAYERS[0]?.id ?? 'usdm')
  const mapCenter = center ?? CONUS
  const mapZoom   = center ? 6 : 4

  const activeLayer = LAYERS.find(l => l.id === tab)

  // Toggle = registry layers flagged for the toggle only → Radar + Drought Monitor.
  // alerts is registered (inToggle:false) but gets NO tab — it renders as the radar
  // overlay. The CPC outlook images live in the dashboard "Forecast" accordion.
  const tabs = LAYERS.filter(l => l.inToggle !== false).map(l => ({ id: l.id, label: l.label }))

  // alerts' county-dynamic endpoint (runtime ?area=ST) → fed to the radar overlay.
  const alertsEndpoint = ALERTS_LAYER ? (runtime.alerts?.endpoint ?? ALERTS_LAYER.endpoint) : null

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

      {activeLayer?.type === 'vector' ? (
        // Key by the resolved endpoint (county-dynamic for alerts) so the view REMOUNTS
        // fresh on a layer OR county change — geo/status re-init per layer from the
        // per-endpoint cache, so no prior layer's/county's geometry can bleed through.
        <VectorLayerView key={runtime[activeLayer.id]?.endpoint ?? activeLayer.id} layer={activeLayer} runtime={runtime[activeLayer.id]} center={mapCenter} zoom={mapZoom} countyLabel={countyLabel} selectedFips={fips} />
      ) : activeLayer?.type === 'radar' ? (
        // Animated radar tiles + the alerts overlay (county-dynamic endpoint). Both toggle
        // segments are now one of these two branches.
        <RadarLayerView key={activeLayer.id} layer={activeLayer} center={mapCenter} zoom={mapZoom} selectedFips={fips} alertsEndpoint={alertsEndpoint} />
      ) : null}

      <p className="mt-2 font-dm-sans text-xs text-forest-green/45">
        {activeLayer
          ? `Interactive ${activeLayer.attribution}, centered on your county. Base map © OpenStreetMap.`
          : ''}
      </p>
    </div>
  )
}
