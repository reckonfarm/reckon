'use client'

import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, Polygon, Popup, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { forestGreen, warning } from '@/lib/brand-colors'
import { BALE_VERIFY_BELOW } from '@/lib/detections/detect-bales'
import type { JobMapProps } from './JobMapLoader'

// ─── The job map — a product view with a diagnostic behind a toggle ────────────
// Which field, and how much of it is done. That is the whole question this map
// answers, and it answers it differently by mode (JobMapLoader):
//
//   MAPPING — the track draws itself while the outside rounds tie off. The
//   line is the story; impact dots are small, uniform, single-color. Nobody
//   reading this map needs g-forces.
//   WORKING — a qualified boundary exists. The outline plus swept cells
//   lighting up; the unfilled interior is the shrinking uncut area. Track,
//   dots, and their legend disappear entirely — behind the Track toggle,
//   default OFF (?track=1, same URL-state pattern as ?base=).
//   PLAIN — a finished job with no field story: the track, plainly.
//
// Baling jobs stay pins-first: pins render alone by default and Track reveals
// the path. Bales never get connecting lines — they are a scatter on the
// ground, not a path the machine drove.
//
// Basemap: Esri World Imagery by default — a rancher reads their own ground
// from the air — with an OSM street fallback (also the lighter option on one
// bar of 3G). Styling follows the basemap; the choice lives in the URL
// (?base=street; satellite is the unmarked default) via history.replaceState.
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

const GAP_GRAY = '#6B7280'
const CASING_DARK = '#111827'

// Per-basemap styling. White over imagery reads on almost any aerial ground;
// the casing keeps lines visible over snow, gravel, and bale rows. Gap dashes
// get no casing — a solid casing under a dash reads as a solid line.
//
// The boundary is SOLID: it is a tied closed loop with no gaps by definition,
// and dashing it read as false uncertainty. The fill is one flat translucent
// color — harvest gold over imagery, because grey-green over green ground was
// mush: cut ground has to read at a glance, on a phone, in sunlight, and gold
// against green imagery is both high-contrast and what windrowed ground
// actually looks like from the air. Brand green carries it on the pale
// street map.
const MAP_STYLE: Record<Basemap, {
  path: string
  casing: string | null
  gap: string
  boundary: string
  boundaryCasing: string | null
  fill: string
  fillOpacity: number
}> = {
  satellite: { path: '#FFFFFF', casing: CASING_DARK, gap: '#FFFFFF', boundary: '#FDFBF7', boundaryCasing: CASING_DARK, fill: '#FFD166', fillOpacity: 0.5 },
  street:    { path: forestGreen, casing: null, gap: GAP_GRAY, boundary: forestGreen, boundaryCasing: null, fill: forestGreen, fillOpacity: 0.25 },
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

function readShowTrackFromUrl(defaultOn: boolean): boolean {
  if (defaultOn) return true
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

// Bale pins: cream fill + dark ring reads on both basemaps (white track line
// already owns "path"; the pin must not be confusable with an impact dot).
// Below BALE_VERIFY_BELOW the pin switches to the unverified style — dashed
// warning ring on a thin fill. "Unverified — go look" is an instruction, not
// a shade: the operator ground-checks after a field day, and the map must say
// WHICH pins want that look, not just that some number counted weaker.
const BALE_STYLE = {
  fill: '#FDFBF7',
  ring: CASING_DARK,
  unverifiedRing: warning,
  radius: 8,
} as const

// The legend explains only what needs explaining — pins and data gaps. The
// track is a line, the outline is a fence, the tint is cut ground; the page
// caption says so in a sentence and none of them need a legend row.
function Legend({ hasBales, hasUnverified, showGapChip, basemap }: {
  hasBales: boolean
  hasUnverified: boolean
  showGapChip: boolean
  basemap: Basemap
}) {
  if (!hasBales && !hasUnverified && !showGapChip) return null
  const style = MAP_STYLE[basemap]
  const onImagery = basemap === 'satellite'
  return (
    <div className="leaflet-bottom leaflet-right" style={{ marginBottom: 24, marginRight: 12 }}>
      <div className="leaflet-control rounded-lg border border-gray-200 bg-white/95 px-3 py-2 shadow-sm">
        {hasBales && (
          <div className="flex items-center gap-2">
            <span
              style={{
                width: 14, height: 14, borderRadius: '50%',
                background: BALE_STYLE.fill, border: `2.5px solid ${BALE_STYLE.ring}`,
              }}
            />
            <span className="font-dm-sans text-[11px] text-forest-green/70">bale</span>
          </div>
        )}
        {hasUnverified && (
          <div className="mt-1 flex items-center gap-2">
            <span
              style={{
                width: 14, height: 14, borderRadius: '50%',
                background: 'transparent', border: `2.5px dashed ${BALE_STYLE.unverifiedRing}`,
              }}
            />
            <span className="font-dm-sans text-[11px] text-forest-green/70">unverified — go look</span>
          </div>
        )}
        {showGapChip && (
          <div className={`flex items-center gap-2 ${hasBales || hasUnverified ? 'mt-1' : ''}`}>
            <span
              className="flex items-center justify-center rounded-sm"
              style={{ width: 22, height: 10, background: onImagery ? '#4B5563' : 'transparent' }}
            >
              <span style={{ width: 18, borderTop: `2px dashed ${style.gap}` }} />
            </span>
            <span className="font-dm-sans text-[11px] text-forest-green/70">gap in data</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function JobMapClient({ track, bbox, mode, bales, boundary, fill }: JobMapProps) {
  const hasBales = (bales ?? []).length > 0
  const hasUnverified = (bales ?? []).some(b => b.confidence < BALE_VERIFY_BELOW)
  // Track defaults ON only when it IS the story: mapping/plain with no pins.
  // Pins-first jobs and working mode put it behind the toggle.
  const trackDefaultOn = !hasBales && mode !== 'working'
  const [basemap, setBasemap] = useState<Basemap>(readBasemapFromUrl)
  const [showTrack, setShowTrack] = useState<boolean>(() => readShowTrackFromUrl(trackDefaultOn))
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
    // The param only means anything where the default is hidden.
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

  const style = MAP_STYLE[basemap]
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

        {/* Paint order tells the story bottom-up: cut ground, then the field
            edge, then (only when asked for) the track, then pins on top. */}
        {(fill ?? []).map((poly, i) => (
          <Polygon
            key={`cut-${i}`}
            positions={[
              poly.outer.map(p => [p.lat, p.lng] as [number, number]),
              ...poly.holes.map(h => h.map(p => [p.lat, p.lng] as [number, number])),
            ]}
            interactive={false}
            pathOptions={{
              color: style.fill,
              weight: 1.5,
              opacity: 0.65,
              fillColor: style.fill,
              fillOpacity: style.fillOpacity,
            }}
          />
        ))}
        {(boundary ?? []).length >= 3 && (
          <>
            {style.boundaryCasing && (
              <Polygon
                positions={(boundary ?? []).map(p => [p.lat, p.lng] as [number, number])}
                interactive={false}
                pathOptions={{ color: style.boundaryCasing, weight: 6, opacity: 0.5, fillOpacity: 0 }}
              />
            )}
            <Polygon
              positions={(boundary ?? []).map(p => [p.lat, p.lng] as [number, number])}
              interactive={false}
              pathOptions={{ color: style.boundary, weight: 3, opacity: 0.95, fillOpacity: 0 }}
            />
          </>
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

        {/* Impact dots: small, uniform, silent. Where the machine worked —
            not how hard it hit. The g-diagnostic left the product view. */}
        {showTrack && track.map(p => (
          <CircleMarker
            key={p.seq}
            center={[p.lat, p.lng]}
            radius={2.5}
            interactive={false}
            pathOptions={{ stroke: false, fillColor: style.path, fillOpacity: 0.75 }}
          />
        ))}

        {(bales ?? []).map((b, i) => {
          const verified = b.confidence >= BALE_VERIFY_BELOW
          return (
            <CircleMarker
              key={`bale-${i}`}
              center={[b.lat, b.lng]}
              radius={BALE_STYLE.radius}
              pathOptions={{
                color: verified ? BALE_STYLE.ring : BALE_STYLE.unverifiedRing,
                weight: verified ? 2.5 : 3,
                dashArray: verified ? undefined : '4 4',
                fillColor: BALE_STYLE.fill,
                fillOpacity: verified ? 0.95 : 0.45,
              }}
            >
              <Popup>
                <div className="font-dm-sans text-xs">
                  <p className="font-semibold">Bale · {fmtTime(Date.parse(b.ts) / 1000)} MT</p>
                  <p className="mt-0.5 text-gray-500">
                    {verified ? 'clear detection' : 'unverified — go look'} · confidence {Math.round(b.confidence * 100)}%
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}

        <Legend
          basemap={basemap}
          hasBales={hasBales}
          hasUnverified={hasUnverified}
          showGapChip={showTrack && gapHops.length > 0}
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
        {!trackDefaultOn && (
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
