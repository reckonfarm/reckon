'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, AttributionControl, Tooltip, Circle, CircleMarker, Marker, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { IMAGERY_KEY_MISSING, IMAGERY_KEY_MISSING_LINE, PLAIN_GROUND, type Basemap } from '@/lib/map-basemaps'
import ImageryLayer from '@/app/components/map/ImageryLayer'
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

// ─── The pin (Block 7A) ───────────────────────────────────────────────────────
// A dropped point is shown three ways at once, because they are three facts:
//   · the FIX — a small dot exactly where the phone said, never moved;
//   · the ACCURACY — a circle in real metres around the fix (a Leaflet Circle,
//     not a CircleMarker: a CircleMarker's radius is pixels and would claim a
//     different accuracy at every zoom);
//   · the PIN — where the place will be recorded. It starts on the fix and
//     goes where the thumb drags it. The drag is recorded in provenance as
//     what it is: original fix, final position, distance moved.
// The pin is a DivIcon — plain HTML, no image assets to bundle — with a 44 px
// hit box around a 22 px head, so a thumb can pick it up on a 390 px phone.
const PIN_SIZE = 44
const pinIcon = (draggable: boolean) => L.divIcon({
  className: '',
  iconSize: [PIN_SIZE, PIN_SIZE],
  iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
  html: `<div data-audit="map-pin" style="width:${PIN_SIZE}px;height:${PIN_SIZE}px;display:flex;align-items:center;justify-content:center;cursor:${draggable ? 'grab' : 'default'}">
    <div style="width:22px;height:22px;border-radius:9999px;background:${DRAFT_COLOR};border:3px solid ${cream};box-shadow:0 0 0 2px #111827, 0 2px 6px rgba(0,0,0,.5)"></div>
  </div>`,
})

// Block 26 — a place with no shape. Same 44 px thumb box as the draft pin, a
// square head so it never reads as "you are here", filled with its bunch's colour.
const placeIcon = (fill: string) => L.divIcon({
  className: '',
  iconSize: [PIN_SIZE, PIN_SIZE],
  iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
  html: `<div data-audit="map-place-pin" style="width:${PIN_SIZE}px;height:${PIN_SIZE}px;display:flex;align-items:center;justify-content:center;cursor:pointer">
    <div style="width:20px;height:20px;border-radius:4px;background:${fill};border:3px solid ${cream};box-shadow:0 0 0 2px #111827, 0 2px 6px rgba(0,0,0,.5)"></div>
  </div>`,
})

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

// Block 26 — frame ONE place. Picked from the key, a place may be a speck on a
// ranch-wide view; this brings it up to fill the map. It ends "whole ranch"
// follow (or the next render would fit everything again) and flags its own
// move so it is not read as a finger.
function FocusPlace({ focus, shapes, markers, setAuto, onFocus }: { focus: { id: string; n: number } | null; shapes: PlaceMapProps['shapes']; markers: NonNullable<PlaceMapProps['markers']>; setAuto: (v: boolean) => void; onFocus: () => void }) {
  const map = useMap()
  useEffect(() => {
    if (!focus) return
    const shape = shapes.find(s => s.id === focus.id), marker = markers.find(m => m.id === focus.id)
    if (!shape && !marker) return
    onFocus()
    setAuto(true)
    if (shape) map.fitBounds(shape.ring.map(c => [c.lat, c.lng] as LL), { padding: [30, 30], animate: false })
    else map.setView([marker!.position.lat, marker!.position.lng], Math.max(map.getZoom(), 16), { animate: false })
    const t = setTimeout(() => setAuto(false), 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fires on focus.n only; shapes are read at that moment
  }, [map, focus?.id, focus?.n])
  return null
}

// A check that reads the painted outline has to know where the ring's edge
// landed on the canvas. The map instance is hung on its own container for
// that projection — nothing about what was drawn is claimed here.
function AuditHandle() {
  const map = useMap()
  useEffect(() => { (map.getContainer() as HTMLElement & { __leafletMap?: L.Map }).__leafletMap = map }, [map])
  return null
}

// Block 26c — motion only on change: a move that landed moments ago draws its
// destination once, bright and wide, and settles to the steady style over a
// second. Nothing blinks. A phone that asks for reduced motion gets no settle.
function Settle({ ring, color }: { ring: LatLng[]; color: string }) {
  const [t, setT] = useState(() => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : 0))
  useEffect(() => {
    if (t >= 1) return
    const t0 = Date.now(), id = setInterval(() => { const k = Math.min(1, (Date.now() - t0) / 1100); setT(k); if (k >= 1) clearInterval(id) }, 40)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; t only ends it
  }, [])
  if (t >= 1) return null
  return <Polygon positions={ring.map(c => [c.lat, c.lng] as LL)} interactive={false} pathOptions={{ color, weight: 3.5 + 9 * (1 - t), opacity: 0.9 * (1 - t), fill: false }} />
}

// Block 26/26c — a tap on open ground takes the overview full screen, and a tap
// takes it back (PK: full screen is a tap on the map, not a button). A tap on a
// place never reaches here: the shape stops it and opens its sheet instead.
function GroundTap({ onTap }: { onTap: () => void }) {
  useMapEvents({ click() { onTap() } })
  return null
}

// Block 26 — Follow me: keep the person centred while they have not taken the map.
// Its own moves are flagged so they are never mistaken for a finger: a zoom the
// map makes for itself fires zoomstart exactly as a pinch does.
function MeFollower({ here, setAuto }: { here: LatLng | null; setAuto: (v: boolean) => void }) {
  const map = useMap()
  useEffect(() => {
    if (!here) return
    setAuto(true)
    map.setView([here.lat, here.lng], Math.max(map.getZoom(), 15), { animate: true })
    const t = setTimeout(() => setAuto(false), 800)
    return () => clearTimeout(t)
  }, [map, here, setAuto])
  return null
}

// Block 21 — keep the rider on screen. Pans only when the latest fix leaves
// the middle of the view, and only while the operator has not taken the map.
function TrackFollower({ here, following }: { here: LatLng | null; following: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (!here || !following) return
    const b = map.getBounds().pad(-0.25)
    if (!b.contains([here.lat, here.lng])) map.panTo([here.lat, here.lng], { animate: true })
  }, [map, here, following])
  return null
}

export default function PlaceMapClient({
  shapes,
  initialCenter,
  height = 420,
  drawing = false,
  pin,
  track,
  onShape,
  onCancel,
  useLabel = 'Use this shape',
  markers = [],
  onPlaceTap,
  overview = false,
  focus = null,
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
  // Pin mode is the same rule: the pin is the subject, and a re-fit to the
  // ranch's shapes would pull the ground out from under it.
  const following = !drawing && !pin && followUser
  const tappable = !drawing && !!onPlaceTap

  // Block 26 — the overview takes the screen on a tap and gives it back.
  const [expanded, setExpanded] = useState(false)
  const full = drawing || expanded
  // Follow me: foreground location only — a watch that lives exactly as long
  // as the control is on and the map is mounted. A finger on the map PAUSES
  // it (the dot keeps moving, the map stays put) until Recenter.
  const [followMe, setFollowMe] = useState(false)
  const [mePaused, setMePaused] = useState(false)
  const autoMove = useRef(false)
  const setAuto = useCallback((v: boolean) => { autoMove.current = v }, [])
  const [me, setMe] = useState<{ p: LatLng; accuracyM: number } | null>(null)
  useEffect(() => {
    if (!followMe || typeof navigator === 'undefined' || !navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      pos => setMe({ p: { lat: pos.coords.latitude, lng: pos.coords.longitude }, accuracyM: pos.coords.accuracy }),
      () => { setFollowMe(false); setNote('Could not get your position.') },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [followMe])

  // Fight #6: while the screen belongs to the map, the page behind it must not
  // scroll under the operator's finger. Syncing one bit of React state to the
  // document is what an effect is FOR — this is not derived state.
  useEffect(() => {
    if (!full) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [full])

  const addCorner = useCallback((p: LatLng) => {
    setNote(null)
    setCorners(prev => [...prev, p])
  }, [])

  const allShapePts = useMemo(() => [...shapes.flatMap(s => s.ring), ...markers.map(m => m.position)], [shapes, markers])

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

  // Block 26: with no picture under them — no key, or no signal — shapes are
  // styled for plain ground, which is the street map's style.
  const [plain, setPlain] = useState(false)
  const saved = SAVED_STYLE[plain ? 'street' : basemap]
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
    <div className={full
      ? 'fixed inset-0 z-[60] flex flex-col bg-white'
      : 'relative overflow-hidden rounded-xl border border-forest-green/10'}
      role={drawing ? 'dialog' : undefined}
      aria-label={drawing ? 'Draw a place' : undefined}
      aria-modal={drawing || undefined}
    >
      <MapContainer
        {...(pin
          ? { center: [pin.position.lat, pin.position.lng] as LL, zoom: 18 }
          : track?.here
          ? { center: [track.here.lat, track.here.lng] as LL, zoom: 17 }
          : initialBounds
          ? { bounds: initialBounds, boundsOptions: { padding: [30, 30] as [number, number] } }
          : { center: [initialCenter.lat, initialCenter.lng] as LL, zoom: 14 })}
        preferCanvas
        attributionControl={false}
        style={{ ...(full ? { flex: '1 1 auto', minHeight: 0, width: '100%' } : { height, width: '100%' }), background: PLAIN_GROUND }}
        scrollWheelZoom={false}
      >
        <ImageryLayer basemap={basemap} onPlain={setPlain} />
        <AttributionControl prefix={false} position="bottomleft" />

        <FollowController boundsKey={boundsKey} following={following && !track && !followMe} onUserMove={() => { if (autoMove.current) return; setFollowUser(false); if (followMe) setMePaused(true) }} />
        <MeFollower here={followMe && !mePaused ? me?.p ?? null : null} setAuto={setAuto} />
        <SizeKeeper key={full ? 'full' : 'inline'} />
        <AuditHandle />
        {track && <TrackFollower here={track.here} following={followUser} />}
        <CornerPlacer active={drawing} onCorner={addCorner} />
        <FlyTo target={flyTo} />
        <FocusPlace focus={focus} shapes={shapes} markers={markers} setAuto={setAuto} onFocus={() => setFollowUser(false)} />
        {overview && !drawing && <GroundTap onTap={() => setExpanded(e => !e)} />}

        {/* Fight #4: nothing already on the map is interactive while drawing. */}
        {shapes.map(s => (
          <Fragment key={s.id}>
            {/* Casing first, under the edge — the job map's rule for a line
                that has to survive any ground under it. */}
            {/* Block 26c: an OCCUPIED place is a steady bright outline in its bunch's
                colour over a dark backing stroke, a light fill of the same colour,
                and its label inside — head · bunch name. An EMPTY place is a thin
                neutral outline. Occupancy never fades with age. */}
            {!s.draft && (s.fill || saved.casing) && (
              <Polygon
                positions={s.ring.map(c => [c.lat, c.lng] as LL)}
                interactive={false}
                pathOptions={{ color: '#111827', weight: s.fill ? 7 : 3, opacity: s.fill ? 0.7 : 0.35, fill: false }}
              />
            )}
            <Polygon
              positions={s.ring.map(c => [c.lat, c.lng] as LL)}
              interactive={tappable && !s.draft}
              eventHandlers={tappable && !s.draft ? { click: e => { L.DomEvent.stopPropagation(e); onPlaceTap!(s.id) } } : {}}
              pathOptions={s.draft
                ? { color: DRAFT_COLOR, weight: 3, fillColor: DRAFT_COLOR, fillOpacity: 0.2 }
                : s.fill
                ? { color: s.fill, weight: 3.5, opacity: 1, fillColor: s.fill, fillOpacity: 0.10 }
                : { color: saved.color, weight: 1.5, opacity: 0.8, fill: false }}
            >
              {s.label && (
                <Tooltip permanent direction="center" interactive={false} className="dryline-place-label" opacity={1}>
                  <span style={{ color: s.fill }}>{s.label}</span>
                </Tooltip>
              )}
            </Polygon>
            {s.pulse && <Settle ring={s.ring} color={s.fill ?? saved.color} />}
          </Fragment>
        ))}

        {/* Block 26: a place with no shape is a pin — the same tap, the same colour rule. */}
        {markers.map(m => (
          <Marker
            key={m.id}
            position={[m.position.lat, m.position.lng]}
            icon={placeIcon(m.fill ?? cream)}
            interactive={tappable}
            eventHandlers={tappable ? { click: e => { L.DomEvent.stopPropagation(e); onPlaceTap!(m.id) } } : {}}
          />
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

        {/* Block 21 — the ride as it is laid: the line so far, where it began,
            and the phone's fix with its accuracy. Dashed because nothing has
            closed; the outline traces itself, which is the point of riding. */}
        {track && track.points.length >= 2 && (
          <Polyline
            positions={track.points.map(c => [c.lat, c.lng] as LL)}
            interactive={false}
            pathOptions={{ color: DRAFT_COLOR, weight: 4, dashArray: '10 6', opacity: 0.95 }}
          />
        )}
        {track && track.points.length >= 1 && (
          <CircleMarker
            center={[track.points[0].lat, track.points[0].lng]}
            radius={8}
            interactive={false}
            pathOptions={{ color: cream, weight: 2, fillColor: DRAFT_COLOR, fillOpacity: 1 }}
          />
        )}
        {track?.here && (
          <>
            {track.accuracyM != null && (
              <Circle
                center={[track.here.lat, track.here.lng]}
                radius={Math.max(1, track.accuracyM)}
                interactive={false}
                pathOptions={{ color: '#2563EB', weight: 1, fillColor: '#2563EB', fillOpacity: 0.12 }}
              />
            )}
            <CircleMarker
              center={[track.here.lat, track.here.lng]}
              radius={7}
              interactive={false}
              pathOptions={{ color: cream, weight: 2, fillColor: '#2563EB', fillOpacity: 1 }}
            />
          </>
        )}
        {pin && (
          <>
            {/* The accuracy, in metres, around the fix — the phone's own claim. */}
            <Circle
              center={[pin.fix.lat, pin.fix.lng]}
              radius={Math.max(1, pin.accuracyM)}
              interactive={false}
              pathOptions={{ color: '#2563EB', weight: 1.5, fillColor: '#2563EB', fillOpacity: 0.12 }}
            />
            <CircleMarker
              center={[pin.fix.lat, pin.fix.lng]}
              radius={5}
              interactive={false}
              pathOptions={{ color: cream, weight: 2, fillColor: '#2563EB', fillOpacity: 1 }}
            />
            <Marker
              position={[pin.position.lat, pin.position.lng]}
              icon={pinIcon(!!pin.onMove)}
              draggable={!!pin.onMove}
              interactive={!!pin.onMove}
              eventHandlers={pin.onMove ? { dragend: e => { const ll = (e.target as L.Marker).getLatLng(); pin.onMove!({ lat: ll.lat, lng: ll.lng }) } } : {}}
            />
          </>
        )}

        {followMe && me && (
          <>
            <Circle center={[me.p.lat, me.p.lng]} radius={Math.max(1, me.accuracyM)} interactive={false} pathOptions={{ color: '#2563EB', weight: 1, fillColor: '#2563EB', fillOpacity: 0.12 }} />
            <CircleMarker center={[me.p.lat, me.p.lng]} radius={7} interactive={false} pathOptions={{ color: cream, weight: 2, fillColor: '#2563EB', fillOpacity: 1 }} />
          </>
        )}
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
      {basemap === 'satellite' && IMAGERY_KEY_MISSING && !drawing && (
        <p className="pointer-events-none absolute inset-x-3 bottom-3 z-[1000] rounded-lg bg-white/95 px-3 py-2 font-dm-sans text-[15px] text-ink" data-audit="imagery-key-missing">{IMAGERY_KEY_MISSING_LINE}</p>
      )}
      {/* Block 26c (PK, Apple Maps as the reference): at most TWO controls on the
          map, Layers and Locate, in one small pill top-right. Small on screen,
          full-size to the thumb (the hit box is 48 px; the pill is 36). Nothing
          else floats: full screen is a tap on the map, and the ranch re-frames
          itself when the place goes back. */}
      <div className="pointer-events-none absolute right-2 top-2 z-[1000] flex flex-col items-end gap-2">
        {!drawing && (
          <div className="pointer-events-auto flex flex-col overflow-hidden rounded-xl border border-black/10 bg-white/95 shadow-sm" data-audit="map-pill">
            <button type="button" onClick={() => setBasemap(b => (b === 'satellite' ? 'street' : 'satellite'))} aria-label={basemap === 'satellite' ? 'Layers — show the street map' : 'Layers — show the satellite picture'}
              className="relative flex h-9 w-9 items-center justify-center text-forest-green before:absolute before:-inset-1.5 before:content-['']" data-audit="map-layers">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" /></svg>
            </button>
            {geolocatable && overview && (
              <button type="button" onClick={() => { if (!followMe) { setFollowMe(true); setMePaused(false) } else if (mePaused) setMePaused(false); else setFollowMe(false) }}
                aria-label={!followMe ? 'Locate me' : mePaused ? 'Recenter on me' : 'Stop following me'} aria-pressed={followMe && !mePaused}
                className={`relative flex h-9 w-9 items-center justify-center border-t border-black/10 before:absolute before:-inset-1.5 before:content-[''] ${followMe && !mePaused ? 'bg-forest-green text-white' : 'text-forest-green'}`} data-audit="map-locate" data-state={!followMe ? 'off' : mePaused ? 'paused' : 'following'}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>
              </button>
            )}
          </div>
        )}
        {note && !drawing && <p role="status" className="pointer-events-auto max-w-[13.5rem] rounded-lg bg-white/95 px-3 py-2 font-dm-sans text-[15px] font-semibold" style={{ color: warning }} data-audit="map-note">{note}</p>}
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
