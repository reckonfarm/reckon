'use client'

import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, Polygon, Popup, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { forestGreen } from '@/lib/brand-colors'
import { BOUNDARY_CONFIG } from '@/lib/jobs/boundary'
import { sweepRuns } from '@/lib/jobs/sweep'
import type { JobMapProps } from './JobMapLoader'

// ─── The job map — draw exactly what the ledger holds, nothing more ────────────
// Track points in seq order; SOLID segments only between seq-adjacent recorded
// impacts (link==='solid', decided by the deriver), DASHED connectors across
// every discontinuity — evicted events, silence, or lost fix. A dashed hop
// reads as "the machine got from A to B; we did not watch it happen."
//
// Impact size = color + radius (sequential rust ramp, light→dark; dataviz
// method: magnitude gets ONE hue). Color alone never carries it — bigger hits
// get bigger markers, and every marker has a popup with the numbers.
//
// Basemap: Esri World Imagery by default — a rancher reads their own ground
// from the air — with an OSM street fallback (also the lighter option on one
// bar of 3G). Track styling follows the basemap: white-with-dark-casing over
// imagery (forest green vanishes on irrigated ground), forest green on street.
// The choice lives in the URL (?base=street; satellite is the unmarked
// default) via history.replaceState — no router round-trip, and it composes
// with whatever other params the page carries.
//
// Live follow: while the view is untouched we re-fit to the track as it grows;
// the moment the user pans or zooms, follow stops — the map is read one-handed
// in a moving tractor and must never yank. A Recenter button re-arms it.

type Basemap = 'satellite' | 'street'

const BASEMAPS: Record<Basemap, {
  url: string
  attribution: string
  maxNativeZoom: number
  maxZoom: number
}> = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Imagery &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    // Rural imagery thins out past ~z17 — overzoom native tiles instead of
    // serving gray.
    maxNativeZoom: 17,
    maxZoom: 19,
  },
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
    maxZoom: 19,
  },
}

const MG_BUCKETS = [
  { min: 6000, color: '#5C2013', radius: 7, label: '≥ 6 g' },
  { min: 4000, color: '#8B3A2B', radius: 6, label: '4–6 g' },
  { min: 3000, color: '#B4664A', radius: 5, label: '3–4 g' },
  { min: 2500, color: '#D28E6E', radius: 4, label: '2.5–3 g' },
  { min: 0,    color: '#EAB8A2', radius: 3, label: '< 2.5 g' },
] as const

function bucketFor(mg: number | null) {
  if (mg == null) return MG_BUCKETS[MG_BUCKETS.length - 1]
  return MG_BUCKETS.find(b => mg >= b.min) ?? MG_BUCKETS[MG_BUCKETS.length - 1]
}

const GAP_GRAY = '#6B7280'
const CASING_DARK = '#111827'

// Per-basemap track styling. White over imagery reads on almost any aerial
// ground; the casing keeps it visible over snow, gravel, and bale rows. Gap
// dashes get no casing — a solid casing under a dash reads as a solid line.
const TRACK_STYLE: Record<Basemap, {
  path: string
  casing: string | null
  gap: string
  // Field boundary ring: heavier dash rhythm than the thin '2 8' gap dash so
  // the two never read as the same idea (gap = missing data; boundary = the
  // field's edge, traced from the outside rounds).
  boundary: string
  // The swept swath — a header-width translucent ribbon. Light over imagery
  // (cut ground reads lighter from the air), brand green on the street map.
  sweep: string
  sweepOpacity: number
}> = {
  satellite: { path: '#FFFFFF', casing: CASING_DARK, gap: '#FFFFFF', boundary: '#FDFBF7', sweep: '#FFFFFF', sweepOpacity: 0.3 },
  street:    { path: forestGreen, casing: null, gap: GAP_GRAY, boundary: forestGreen, sweep: forestGreen, sweepOpacity: 0.18 },
}

const fmtTime = (t: number) =>
  new Date(t * 1000).toLocaleTimeString('en-US', {
    timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit', second: '2-digit',
  })

type Bounds = [[number, number], [number, number]]

function readBasemapFromUrl(): Basemap {
  if (typeof window === 'undefined') return 'satellite'
  return new URLSearchParams(window.location.search).get('base') === 'street'
    ? 'street'
    : 'satellite'
}

// Once a job has bale detections, the bales ARE the story — pins render alone
// by default and the raw impact track goes behind a toggle (?track=1, same
// URL-state pattern as ?base=). Jobs without detections keep the track: it is
// the only thing there is to see. Bales never get connecting lines — they are
// a scatter on the ground, not a path the machine drove.
function readShowTrackFromUrl(hasBales: boolean): boolean {
  if (!hasBales) return true
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('track') === '1'
}

// Re-fit while following; disarm follow on any user pan/zoom. Programmatic
// fits also fire zoomstart, so a short-lived flag separates our own moves from
// the user's (with a timeout fallback in case an identical-view fit never
// fires moveend). Bounds travel as a value key ("minLat,minLng,maxLat,maxLng")
// — a refresh that changes object identity but not the bbox never re-fits.
function FollowController({ boundsKey, following, onUserMove }: {
  boundsKey: string
  following: boolean
  onUserMove: () => void
}) {
  const map = useMap()
  const programmatic = useRef(false)

  useEffect(() => {
    if (!following) return
    const [minLat, minLng, maxLat, maxLng] = boundsKey.split(',').map(Number)
    programmatic.current = true
    map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [30, 30] })
    const t = setTimeout(() => { programmatic.current = false }, 600)
    return () => clearTimeout(t)
  }, [map, following, boundsKey])

  useMapEvents({
    dragstart() { onUserMove() },
    zoomstart() { if (!programmatic.current) onUserMove() },
    moveend() { programmatic.current = false },
  })
  return null
}

// The swath — the machine's cutting runs drawn at TRUE header width, so the
// fill IS the swept area the percent describes. Leaflet polyline weight is in
// pixels, so the weight re-derives from zoom on every zoomend: weight =
// header-width metres ÷ metres-per-pixel at the map's latitude.
function SwathLayer({ runs, centerLat, color, opacity }: {
  runs: [number, number][][]
  centerLat: number
  color: string
  opacity: number
}) {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend() { setZoom(map.getZoom()) } })
  const mPerPx = (156543.03392 * Math.cos((centerLat * Math.PI) / 180)) / 2 ** zoom
  const weight = Math.max(2, BOUNDARY_CONFIG.headerWidthM / mPerPx)
  return (
    <>
      {runs.map((r, i) => (
        <Polyline
          key={`swath-${i}`}
          positions={r}
          interactive={false}
          pathOptions={{ color, weight, opacity, lineCap: 'round', lineJoin: 'round' }}
        />
      ))}
    </>
  )
}

// Bale pins: cream fill + dark ring reads on both basemaps (white track line
// already owns "path"; the pin must not be confusable with an impact dot).
// Weaker-evidence bales render hollow — the map never flattens confidence.
const BALE_STYLE = {
  fill: '#FDFBF7',
  ring: CASING_DARK,
  radius: 8,
  strongMin: 0.7,
} as const

function Legend({ basemap, hasBales, showTrack, hasBoundary, hasSweep }: {
  basemap: Basemap
  hasBales: boolean
  showTrack: boolean
  hasBoundary: boolean
  hasSweep: boolean
}) {
  const style = TRACK_STYLE[basemap]
  const onImagery = basemap === 'satellite'
  // On satellite the line samples sit on a small dark chip — white-on-white
  // would show nothing.
  const chip = (line: React.CSSProperties) => (
    <span
      className="flex items-center justify-center rounded-sm"
      style={{ width: 22, height: 10, background: onImagery ? '#4B5563' : 'transparent' }}
    >
      <span style={{ width: 18, ...line }} />
    </span>
  )
  return (
    <div className="leaflet-bottom leaflet-right" style={{ marginBottom: 24, marginRight: 12 }}>
      <div className="leaflet-control rounded-lg border border-gray-200 bg-white/95 px-3 py-2 shadow-sm">
        {/* The legend explains only what is on the map right now. */}
        {showTrack && (
          <>
            <p className="font-dm-sans text-[11px] font-semibold text-forest-green">Impact strength</p>
            {MG_BUCKETS.map(b => (
              <div key={b.label} className="mt-1 flex items-center gap-2">
                <span
                  style={{
                    width: b.radius * 2, height: b.radius * 2, background: b.color,
                    borderRadius: '50%', border: '1.5px solid white', boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
                  }}
                />
                <span className="font-dm-sans text-[11px] text-forest-green/70">{b.label}</span>
              </div>
            ))}
          </>
        )}
        <div className={showTrack ? 'mt-2 border-t border-gray-100 pt-1.5' : ''}>
          {showTrack && (
            <>
              <div className="flex items-center gap-2">
                {chip({ borderTop: `3px solid ${style.path}` })}
                <span className="font-dm-sans text-[11px] text-forest-green/70">recorded path</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                {chip({ borderTop: `2px dashed ${style.gap}` })}
                <span className="font-dm-sans text-[11px] text-forest-green/70">gap in data</span>
              </div>
            </>
          )}
          {hasBoundary && (
            <div className={`flex items-center gap-2 ${showTrack ? 'mt-1' : ''}`}>
              {chip({ borderTop: `3.5px dashed ${style.boundary}` })}
              <span className="font-dm-sans text-[11px] text-forest-green/70">field boundary</span>
            </div>
          )}
          {hasSweep && (
            <div className="mt-1 flex items-center gap-2">
              {chip({ borderTop: `7px solid ${style.sweep}`, opacity: style.sweepOpacity + 0.25 })}
              <span className="font-dm-sans text-[11px] text-forest-green/70">cut so far</span>
            </div>
          )}
          {hasBales && (
            <div className="mt-1 flex items-center gap-2">
              <span
                style={{
                  width: 14, height: 14, borderRadius: '50%',
                  background: BALE_STYLE.fill, border: `2.5px solid ${BALE_STYLE.ring}`,
                }}
              />
              <span className="font-dm-sans text-[11px] text-forest-green/70">bale</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function JobMapClient({ track, bbox, bales, boundary, sweepFill }: JobMapProps) {
  const hasBales = (bales ?? []).length > 0
  const swathRuns: [number, number][][] = sweepFill
    ? sweepRuns(track).map(run => run.map(p => [p.lat, p.lng] as [number, number]))
    : []
  const [basemap, setBasemap] = useState<Basemap>(readBasemapFromUrl)
  const [showTrack, setShowTrack] = useState<boolean>(() => readShowTrackFromUrl(hasBales))
  const [following, setFollowing] = useState(true)

  const pickBasemap = (b: Basemap) => {
    setBasemap(b)
    const params = new URLSearchParams(window.location.search)
    if (b === 'satellite') params.delete('base')
    else params.set('base', b)
    const qs = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
  }

  const toggleTrack = () => {
    const next = !showTrack
    setShowTrack(next)
    const params = new URLSearchParams(window.location.search)
    // The param only means anything on a detections job (default hidden).
    if (next) params.set('track', '1')
    else params.delete('track')
    const qs = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
  }

  // Split the track into solid runs and dashed gap connectors.
  const solidRuns: [number, number][][] = []
  const gapHops: [number, number][][] = []
  let run: [number, number][] = []
  track.forEach((p, i) => {
    if (i > 0 && p.link === 'gap') {
      if (run.length >= 2) solidRuns.push(run)
      gapHops.push([[track[i - 1].lat, track[i - 1].lng], [p.lat, p.lng]])
      run = []
    }
    run.push([p.lat, p.lng])
  })
  if (run.length >= 2) solidRuns.push(run)

  const bounds: Bounds = bbox
    ? [[bbox.minLat, bbox.minLng], [bbox.maxLat, bbox.maxLng]]
    : [[track[0].lat, track[0].lng], [track[track.length - 1].lat, track[track.length - 1].lng]]
  const boundsKey = bounds.flat().join(',')

  const style = TRACK_STYLE[basemap]
  const tiles = BASEMAPS[basemap]

  return (
    <div className="relative overflow-hidden rounded-xl border border-forest-green/10">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [30, 30] }}
        preferCanvas
        style={{ height: 420, width: '100%' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          key={basemap}
          url={tiles.url}
          attribution={tiles.attribution}
          maxNativeZoom={tiles.maxNativeZoom}
          maxZoom={tiles.maxZoom}
        />

        <FollowController
          boundsKey={boundsKey}
          following={following}
          onUserMove={() => setFollowing(false)}
        />

        {/* Paint order tells the story bottom-up: swath fill (what's been
            cut), then boundary ring, then the track and its impacts on top. */}
        {swathRuns.length > 0 && (
          <SwathLayer
            runs={swathRuns}
            centerLat={bounds[0][0]}
            color={style.sweep}
            opacity={style.sweepOpacity}
          />
        )}
        {(boundary ?? []).length >= 3 && (
          <Polygon
            positions={(boundary ?? []).map(p => [p.lat, p.lng] as [number, number])}
            pathOptions={{
              color: style.boundary,
              weight: 3.5,
              opacity: 0.9,
              dashArray: '10 6',
              fillOpacity: 0,
            }}
          />
        )}

        {showTrack && style.casing && solidRuns.map((r, i) => (
          <Polyline
            key={`casing-${i}`}
            positions={r}
            pathOptions={{ color: style.casing!, weight: 5.5, opacity: 0.6 }}
          />
        ))}
        {showTrack && gapHops.map((hop, i) => (
          <Polyline
            key={`gap-${i}`}
            positions={hop}
            pathOptions={{ color: style.gap, weight: 2, opacity: basemap === 'satellite' ? 0.85 : 0.6, dashArray: '2 8' }}
          />
        ))}
        {showTrack && solidRuns.map((r, i) => (
          <Polyline
            key={`run-${i}`}
            positions={r}
            pathOptions={{ color: style.path, weight: 3, opacity: basemap === 'satellite' ? 0.95 : 0.8 }}
          />
        ))}

        {showTrack && track.map(p => {
          const b = bucketFor(p.mg)
          return (
            <CircleMarker
              key={p.seq}
              center={[p.lat, p.lng]}
              radius={b.radius}
              pathOptions={{ color: 'white', weight: 1.5, fillColor: b.color, fillOpacity: 0.85 }}
            >
              <Popup>
                <div className="font-dm-sans text-xs">
                  <p className="font-semibold">{fmtTime(p.t)} MT</p>
                  <p className="mt-0.5">
                    {p.mg != null ? `${(p.mg / 1000).toFixed(1)} g impact` : 'impact'}
                    {p.w != null && ` · width ${p.w}`}
                  </p>
                  <p className="mt-0.5 text-gray-500">seq {p.seq}</p>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}

        {(bales ?? []).map((b, i) => {
          const strong = b.confidence >= BALE_STYLE.strongMin
          return (
            <CircleMarker
              key={`bale-${i}`}
              center={[b.lat, b.lng]}
              radius={BALE_STYLE.radius}
              pathOptions={{
                color: BALE_STYLE.ring,
                weight: 2.5,
                fillColor: BALE_STYLE.fill,
                fillOpacity: strong ? 0.95 : 0.45,
              }}
            >
              <Popup>
                <div className="font-dm-sans text-xs">
                  <p className="font-semibold">Bale · {fmtTime(Date.parse(b.ts) / 1000)} MT</p>
                  <p className="mt-0.5 text-gray-500">
                    {strong ? 'clear detection' : 'weaker evidence'} · confidence {Math.round(b.confidence * 100)}%
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}

        <Legend
          basemap={basemap}
          hasBales={hasBales}
          showTrack={showTrack}
          hasBoundary={(boundary ?? []).length >= 3}
          hasSweep={swathRuns.length > 0}
        />
      </MapContainer>

      {/* Overlaid controls live OUTSIDE the Leaflet tree — plain siblings above
          the panes, so taps never fight the map's own event capture. */}
      <div className="absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2">
        <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white/95 font-dm-sans text-xs font-semibold shadow-sm">
          {(['satellite', 'street'] as const).map(b => (
            <button
              key={b}
              type="button"
              onClick={() => pickBasemap(b)}
              className={`px-3 py-2 capitalize transition-colors ${
                basemap === b ? 'bg-forest-green text-white' : 'text-forest-green/70 hover:text-forest-green'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        {hasBales && (
          <button
            type="button"
            onClick={toggleTrack}
            className={`rounded-lg border border-gray-200 px-3 py-2 font-dm-sans text-xs font-semibold shadow-sm transition-colors ${
              showTrack ? 'bg-forest-green text-white' : 'bg-white/95 text-forest-green/70 hover:text-forest-green'
            }`}
          >
            Track
          </button>
        )}
      </div>

      {!following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="absolute bottom-6 left-3 z-[1000] rounded-lg border border-gray-200 bg-white/95 px-3 py-2 font-dm-sans text-xs font-semibold text-forest-green shadow-sm hover:bg-white"
        >
          ⌖ Recenter
        </button>
      )}
    </div>
  )
}
