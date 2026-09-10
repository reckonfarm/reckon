'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { BASEMAPS, type Basemap } from '@/lib/map-basemaps'
import { cream, forestGreen, warning } from '@/lib/brand-colors'
import { fmtAcres, polygonAreaAcres, validateRing, type LatLng } from '@/lib/places/geo'
import type { PlaceMapProps } from './PlaceMapLoader'

// ─── The places map — read the ground, or draw on it ──────────────────────────
//
// Two states, one map:
//   READ  — the places that have a shape, on satellite imagery.
//   DRAW  — tap each corner, undo the last, use the shape.
//
// NO leaflet-draw / leaflet-geoman / leaflet-editable. Each brings its own
// toolbar, control convention and gesture model, and all three fight rules
// this codebase set on purpose. The interaction is a pointer handler, a point
// array, and an undo button.
//
// THE FIVE THINGS IT HAS TO FIGHT, all known before a line was written:
//
//  1. FOLLOW. JobMapClient re-fits bounds while `following` and disarms on
//     dragstart/zoomstart. Here follow is DISARMED OUTRIGHT for the whole of
//     draw mode — a re-fit under a half-placed polygon moves the ground out
//     from under the operator's thumb. It re-arms when draw mode closes.
//  2. CONTROLS OUTSIDE THE LEAFLET TREE. Every button is a plain absolutely
//     positioned sibling above the panes, never a Leaflet control, so a tap on
//     a control can never also be a tap on the map (JobMapClient:384). The one
//     control that needs the map — recentring on a fix — does it by setting a
//     target that a tiny in-tree component applies.
//  3. TAP vs PAN. Touch fires `click` at the end of a drag. A corner lands only
//     when the pointer moved less than TAP_SLOP_PX between down and up AND the
//     map reported no move in between — otherwise every pan drops a corner in
//     the middle of the field.
//  4. POPUPS EAT TAPS. Saved places bind popups elsewhere; here, in draw mode,
//     everything already on the map is `interactive={false}` so a tap over an
//     existing shape still reaches the map.
//  5. react-leaflet 5 — everything map-shaped is a child of MapContainer.
//
// AND A SIXTH, found by driving the real page on a 390x844 phone rather than
// reading the source: an inline 420 px map on the places list opens BELOW THE
// FOLD, and its toolbar lands underneath the fixed bottom tab bar (z-50) and
// the two FABs (Feedback bottom-left, Record bottom-right). The operator taps
// "Draw a place" and nothing appears to happen; when they scroll to it, Save
// is under the nav. So DRAW MODE TAKES THE SCREEN — fixed inset-0 above the
// tab bar, page scroll locked, toolbar clear of the safe area. Reading mode
// stays inline, where it belongs.
//
// The map never writes. It hands a validated ring upward and the parent
// decides what to do with it.

const TAP_SLOP_PX = 12

// Harvest gold for the draft, the same choice the job map's cut fill makes:
// high contrast against green ground, and what worked ground looks like from
// the air.
const DRAFT_COLOR = '#D4A017'

// SAVED shapes are styled PER BASEMAP, for the reason JobMapClient already
// learned the hard way ("grey-green over green ground was mush"): forest green
// at 14% over Montana rangeland imagery is very nearly invisible — the first
// real polygon rendered on a phone proved it. Over imagery a place gets a
// cream edge with a dark casing under it, which reads on grass, stubble, snow
// and gravel alike; over the pale street map, brand green carries it.
const SAVED_STYLE: Record<Basemap, { color: string; casing: string | null; fill: string; fillOpacity: number }> = {
  satellite: { color: cream, casing: '#111827', fill: cream, fillOpacity: 0.10 },
  street:    { color: forestGreen, casing: null, fill: forestGreen, fillOpacity: 0.14 },
}

type LL = [number, number]

// ─── Follow, and its off switch ───────────────────────────────────────────────
function FollowController({ boundsKey, following, onUserMove }: {
  boundsKey: string | null
  following: boolean
  onUserMove: () => void
}) {
  const map = useMap()
  const programmatic = useRef(false)

  useEffect(() => {
    if (!following || !boundsKey) return
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

// ─── Corner placement ─────────────────────────────────────────────────────────
function CornerPlacer({ active, onCorner }: { active: boolean; onCorner: (p: LatLng) => void }) {
  const map = useMap()
  const down = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)

  useMapEvents({
    movestart() { moved.current = true },
    zoomstart() { moved.current = true },
  })

  useEffect(() => {
    if (!active) return
    const el = map.getContainer()
    const onDown = (e: PointerEvent) => {
      down.current = { x: e.clientX, y: e.clientY }
      moved.current = false
    }
    const onUp = (e: PointerEvent) => {
      const d = down.current
      down.current = null
      if (!d || moved.current) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP_PX) return
      const rect = el.getBoundingClientRect()
      const pt = map.containerPointToLatLng([e.clientX - rect.left, e.clientY - rect.top])
      onCorner({ lat: pt.lat, lng: pt.lng })
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [active, map, onCorner])

  return null
}

// Leaflet measures its container once, at init. In draw mode the container is
// a flex child of a fixed full-screen box, which can be laid out a tick after
// the map initialises — so tell it to measure again, and again on rotate.
// Without this the map can come up at zero height and no tap ever lands.
function SizeKeeper() {
  const map = useMap()
  useEffect(() => {
    const fix = () => map.invalidateSize()
    const t = setTimeout(fix, 0)
    window.addEventListener('resize', fix)
    window.addEventListener('orientationchange', fix)
    return () => { clearTimeout(t); window.removeEventListener('resize', fix); window.removeEventListener('orientationchange', fix) }
  }, [map])
  return null
}

// The one thing an out-of-tree control can't do for itself: move the map.
function FlyTo({ target }: { target: { p: LatLng; n: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.setView([target.p.lat, target.p.lng], Math.max(map.getZoom(), 16))
  }, [map, target])
  return null
}

export default function PlaceMapClient({
  shapes,
  initialCenter,
  height = 420,
  drawing = false,
  onShape,
  onCancel,
  useLabel = 'Use this shape',
}: PlaceMapProps) {
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const [followUser, setFollowUser] = useState(true)
  const [corners, setCorners] = useState<LatLng[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [here, setHere] = useState<LatLng | null>(null)
  const [flyTo, setFlyTo] = useState<{ p: LatLng; n: number } | null>(null)
  const flyCount = useRef(0)

  // Fight #1: draw mode disarms follow outright, for its whole duration.
  // DERIVED, not mirrored into an effect — an effect that writes state here
  // would re-fit the view one render after the operator's first tap, which is
  // exactly the yank this rule exists to prevent. The parent gives the map a
  // fresh key per step, so a draft never survives leaving draw mode.
  const following = !drawing && followUser

  // Fight #6: while the screen belongs to the map, the page behind it must not
  // scroll under the operator's finger. Syncing one bit of React state to the
  // document is what an effect is FOR — this is not derived state.
  useEffect(() => {
    if (!drawing) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [drawing])

  const addCorner = useCallback((p: LatLng) => {
    setNote(null)
    setCorners(prev => [...prev, p])
  }, [])

  const allShapePts = useMemo(() => shapes.flatMap(s => s.ring), [shapes])

  // Re-fit target in read mode. In draw mode following is off, so this is inert.
  const boundsKey = useMemo(() => {
    if (allShapePts.length < 2) return null
    const lats = allShapePts.map(p => p.lat), lngs = allShapePts.map(p => p.lng)
    return [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)].join(',')
  }, [allShapePts])

  const initialBounds = useMemo<[LL, LL] | null>(() => {
    if (allShapePts.length < 2) return null
    const lats = allShapePts.map(p => p.lat), lngs = allShapePts.map(p => p.lng)
    return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]]
  }, [allShapePts])

  // The running number, from three corners on, closed with the implicit edge
  // back to the start — which is what "use this shape" will do.
  const draftAcres = corners.length >= 3 ? polygonAreaAcres(corners) : null

  const tiles = BASEMAPS[basemap]
  const saved = SAVED_STYLE[basemap]
  const geolocatable = typeof navigator !== 'undefined' && !!navigator.geolocation

  const locate = () => {
    setNote(null)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setHere(p)
        flyCount.current += 1
        setFlyTo({ p, n: flyCount.current })
      },
      () => setNote('Could not get your position. Pan to the ground yourself.'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }

  const useShape = () => {
    const v = validateRing([...corners, corners[0]])
    if (!v.ok) { setNote(v.error); return }
    onShape?.(v.ring, v.acres)
  }

  return (
    <div className={drawing
      ? 'fixed inset-0 z-[60] flex flex-col bg-white'
      : 'relative overflow-hidden rounded-xl border border-forest-green/10'}
      role={drawing ? 'dialog' : undefined}
      aria-label={drawing ? 'Draw a place' : undefined}
      aria-modal={drawing || undefined}
    >
      <MapContainer
        {...(initialBounds
          ? { bounds: initialBounds, boundsOptions: { padding: [30, 30] as [number, number] } }
          : { center: [initialCenter.lat, initialCenter.lng] as LL, zoom: 14 })}
        preferCanvas
        style={drawing ? { flex: '1 1 auto', minHeight: 0, width: '100%' } : { height, width: '100%' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          key={basemap}
          url={tiles.url}
          attribution={tiles.attribution}
          maxNativeZoom={tiles.maxNativeZoom}
          maxZoom={tiles.maxZoom}
        />

        <FollowController boundsKey={boundsKey} following={following} onUserMove={() => setFollowUser(false)} />
        <CornerPlacer active={drawing} onCorner={addCorner} />
        <FlyTo target={flyTo} />
        <SizeKeeper />

        {/* Fight #4: nothing already on the map is interactive while drawing. */}
        {shapes.map(s => (
          <Fragment key={s.id}>
            {/* Casing first, under the edge — the job map's rule for a line
                that has to survive any ground under it. */}
            {!s.draft && saved.casing && (
              <Polygon
                positions={s.ring.map(c => [c.lat, c.lng] as LL)}
                interactive={false}
                pathOptions={{ color: saved.casing, weight: 6, opacity: 0.55, fill: false }}
              />
            )}
            <Polygon
              positions={s.ring.map(c => [c.lat, c.lng] as LL)}
              interactive={false}
              pathOptions={s.draft
                ? { color: DRAFT_COLOR, weight: 3, fillColor: DRAFT_COLOR, fillOpacity: 0.2 }
                : { color: saved.color, weight: 3, fillColor: saved.fill, fillOpacity: saved.fillOpacity }}
            />
          </Fragment>
        ))}

        {/* The live draft: dashed, because it hasn't closed yet. */}
        {corners.length >= 2 && (
          <Polyline
            positions={[...corners, ...(corners.length >= 3 ? [corners[0]] : [])].map(c => [c.lat, c.lng] as LL)}
            interactive={false}
            pathOptions={{ color: DRAFT_COLOR, weight: 3, dashArray: '8 6' }}
          />
        )}
        {corners.length >= 3 && (
          <Polygon
            positions={corners.map(c => [c.lat, c.lng] as LL)}
            interactive={false}
            pathOptions={{ color: DRAFT_COLOR, weight: 0, fillColor: DRAFT_COLOR, fillOpacity: 0.2 }}
          />
        )}
        {corners.map((c, i) => (
          <CircleMarker
            key={i}
            center={[c.lat, c.lng]}
            radius={i === 0 ? 8 : 6}
            interactive={false}
            pathOptions={{ color: cream, weight: 2, fillColor: DRAFT_COLOR, fillOpacity: 1 }}
          />
        ))}

        {here && (
          <CircleMarker
            center={[here.lat, here.lng]}
            radius={5}
            interactive={false}
            pathOptions={{ color: cream, weight: 2, fillColor: '#2563EB', fillOpacity: 1 }}
          />
        )}
      </MapContainer>

      {/* Fight #2: plain siblings above the panes, never Leaflet controls.
          Both stack in the top-RIGHT corner: Leaflet's own zoom control owns
          the top-left, and a button sitting on top of it was the first thing
          the rendered page showed. */}
      <div className="pointer-events-none absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2">
        <div className="pointer-events-auto flex overflow-hidden rounded-lg border border-gray-200 bg-white/95 font-dm-sans text-[14px] font-semibold">
          {(['satellite', 'street'] as const).map(b => (
            <button
              key={b}
              type="button"
              onClick={() => setBasemap(b)}
              className={`min-h-[44px] px-3 capitalize transition-colors ${basemap === b ? 'bg-forest-green text-white' : 'text-secondary-ink hover:text-forest-green'}`}
            >
              {b}
            </button>
          ))}
        </div>
        {/* The FIRST time Dryline ever asks for a location, and the people it
            asks are the pilot crew. The button does not stand alone: it says
            what it does and what happens to the answer, before the phone's own
            permission sheet appears. Both are true — the fix moves the map and
            drops the blue dot, and it is never written down, never sent, and
            gone when the map closes. */}
        {drawing && geolocatable && (
          <div className="pointer-events-auto max-w-[13.5rem] overflow-hidden rounded-lg border border-gray-200 bg-white/95">
            <p className="px-3 pt-2 font-dm-sans text-[13px] leading-snug text-secondary-ink" data-audit="draw-locate-note">
              Moves the map to where you&rsquo;re standing. Your location isn&rsquo;t saved or sent anywhere.
            </p>
            <button
              type="button"
              onClick={locate}
              className="min-h-[44px] w-full px-3 pb-1 text-right font-dm-sans text-[15px] font-semibold text-forest-green"
              data-audit="draw-locate"
            >
              Find me
            </button>
          </div>
        )}
      </div>

      {drawing && (
        <div className="z-[1000] shrink-0 border-t border-forest-green/10 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <p role="status" aria-live="polite" className="font-dm-sans text-[15px] leading-snug text-ink" data-audit="draw-status">
            {note ? (
              <span style={{ color: warning }} className="font-semibold">{note}</span>
            ) : corners.length === 0 ? (
              'Tap each corner of the ground. Drag to move the map — only a tap drops a corner.'
            ) : corners.length < 3 ? (
              `${corners.length} corner${corners.length === 1 ? '' : 's'} — a shape needs at least three.`
            ) : (
              <>
                <span className="font-semibold">{corners.length} corners</span>
                {draftAcres != null && <> · about {fmtAcres(draftAcres) ?? 'no ground yet'}</>}
              </>
            )}
          </p>
          <button
            type="button"
            onClick={useShape}
            disabled={corners.length < 3}
            className="mt-2 min-h-[52px] w-full rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-40"
            data-audit="draw-use"
          >
            {useLabel}
          </button>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => { setNote(null); setCorners(prev => prev.slice(0, -1)) }}
              disabled={corners.length === 0}
              className="min-h-[48px] flex-1 rounded-lg border border-forest-green/30 px-4 font-dm-sans text-[16px] font-semibold text-forest-green disabled:opacity-40"
              data-audit="draw-undo"
            >
              Undo corner
            </button>
            <button
              type="button"
              onClick={() => { setCorners([]); setNote(null); onCancel?.() }}
              className="min-h-[48px] shrink-0 rounded-lg px-4 font-dm-sans text-[16px] font-semibold text-secondary-ink underline underline-offset-2"
              data-audit="draw-cancel"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
