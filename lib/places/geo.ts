// ─── Places geometry — one spatial module, one projection ─────────────────────
//
// THE RULE THIS FILE EXISTS TO KEEP: places and fields must measure the same
// ground the same way. lib/jobs/boundary.ts locked its projection deliberately
// ("so the projection can never drift between the boundary and the sweep that
// is judged against it", boundary.ts:147) and everything here IMPORTS that
// convention rather than re-deriving it — meanLat, projectXY, pointInPolygon
// and loopSelfCrossings are boundary's own, re-exported. Equirectangular flat
// earth, M_PER_LAT = 111_132, longitude scaled by cos(lat0). If that ever
// changes it changes in ONE file and both layers move together.
//
// There were already three hand-rolled even-odd ray casts in this repo
// (boundary.ts, forecast-service.ts, scripts/prism-aggregate.ts). This is not
// a fourth; it is the one place a PLACE's geometry is measured or judged.
//
// No turf, no polygon-clipping, no martinez. Shoelace and a ray cast are the
// whole requirement, and both are already written and already regression-
// tested through scripts/field-report.ts.
//
// Pure module: no I/O, no Date.now(), no Supabase. Server routes and the draw
// surface both call it, so it must stay safe in a client bundle.

import {
  ACRE_M2,
  loopSelfCrossings,
  meanLat,
  pointInPolygon,
  projectXY,
  type Pt,
} from '@/lib/jobs/boundary'

export { ACRE_M2, meanLat, pointInPolygon, projectXY, type Pt }

export interface LatLng { lat: number; lng: number }

/** GeoJSON Polygon as it is stored in places.geometry (outer ring only). */
export interface GeoJSONPolygon {
  type: 'Polygon'
  coordinates: [number, number][][]
}

// ─── The plausibility window ──────────────────────────────────────────────────
// This is NOT a geography check and must never become one. It catches the
// three ways a coordinate arrives wrong — lat and lng swapped, a stray zero
// (the null island), and raw 1e-7 degrees straight off a Scout record
// (app/api/ingest/route.ts stores those unconverted in payload) — and it does
// that with room to spare.
//
// Deliberately wider than Montana. Dryline's ground is the northern plains,
// the hay score already spans five states, and rejecting the first North
// Dakota rancher's home pasture as "implausible" would be a worse bug than
// any this guard prevents. Every failure mode above is off by tens of degrees
// or more; none of them squeak through a window this size.
export const PLAUSIBLE = { minLat: 40, maxLat: 49.5, minLng: -117, maxLng: -95 } as const

// A payload guard, not a geometry rule: a tapped polygon is a dozen corners,
// and nothing legitimate in this slice is near this. A driven perimeter will
// want more and can raise it deliberately.
export const MAX_RING_POINTS = 1000

// Below this a "polygon" is three collinear taps, not ground. 1 m² — small
// enough that a real stackyard corner never trips it.
const MIN_AREA_M2 = 1

// ─── Conversion ───────────────────────────────────────────────────────────────
// GeoJSON is [lng, lat]; Leaflet and every other line in this repo is
// {lat, lng}. The swap lives here and nowhere else.

export function ringToGeoJSON(ring: LatLng[]): GeoJSONPolygon {
  return { type: 'Polygon', coordinates: [ring.map(p => [p.lng, p.lat] as [number, number])] }
}

/** Outer ring of a stored GeoJSON Polygon, or null if it isn't one. */
export function ringFromGeoJSON(geometry: unknown): LatLng[] | null {
  const g = geometry as GeoJSONPolygon | null
  if (!g || typeof g !== 'object' || g.type !== 'Polygon' || !Array.isArray(g.coordinates)) return null
  const outer = g.coordinates[0]
  if (!Array.isArray(outer)) return null
  const ring: LatLng[] = []
  for (const c of outer) {
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null
    ring.push({ lat: c[1], lng: c[0] })
  }
  return ring
}

// ─── Area ─────────────────────────────────────────────────────────────────────

/** Shoelace in projected metres. Unsigned — winding order is not a claim. */
export function polygonAreaM2(ring: LatLng[]): number {
  if (ring.length < 3) return 0
  // A closed ring repeats its first point; the shoelace wraps on its own, so
  // the duplicate would contribute a zero-length edge either way. Dropping it
  // keeps the vertex count honest for the crossings test below.
  const open = isClosed(ring) ? ring.slice(0, -1) : ring
  if (open.length < 3) return 0
  const pts = projectXY(open, meanLat(open))
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

/**
 * Acres of a drawn place. Unbuffered — unlike a cutting boundary, whose ring
 * is the machine's centreline and whose acreage is buffered outward by half a
 * header (boundary.ts:42), a drawn polygon IS the edge the person meant. There
 * is no header to add.
 */
export function polygonAreaAcres(ring: LatLng[]): number {
  return polygonAreaM2(ring) / ACRE_M2
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type RingValidation =
  | { ok: true; ring: LatLng[]; areaM2: number; acres: number }
  | { ok: false; error: string }

function isClosed(ring: LatLng[]): boolean {
  if (ring.length < 2) return false
  const a = ring[0]
  const b = ring[ring.length - 1]
  return a.lat === b.lat && a.lng === b.lng
}

/**
 * The one gate a shape passes before it is stored. Every rejection returns a
 * sentence a person could act on — this runs on a phone in a field, and
 * "Invalid geometry" is not a thing anyone can do anything about.
 *
 * Closed ring · at least 4 points (3 corners plus the repeat) · finite
 * coordinates inside the plausibility window · no self-intersection · more
 * than a degenerate sliver of area.
 */
export function validateRing(input: unknown): RingValidation {
  if (!Array.isArray(input)) return { ok: false, error: 'The shape is missing its corners.' }
  if (input.length > MAX_RING_POINTS) {
    return { ok: false, error: `That shape has ${input.length} corners — more than ${MAX_RING_POINTS}.` }
  }

  const ring: LatLng[] = []
  for (const p of input) {
    const o = p as { lat?: unknown; lng?: unknown }
    if (!o || typeof o !== 'object' || typeof o.lat !== 'number' || typeof o.lng !== 'number') {
      return { ok: false, error: 'A corner is missing its position.' }
    }
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lng)) {
      return { ok: false, error: 'A corner has no usable position.' }
    }
    if (o.lat < PLAUSIBLE.minLat || o.lat > PLAUSIBLE.maxLat || o.lng < PLAUSIBLE.minLng || o.lng > PLAUSIBLE.maxLng) {
      return { ok: false, error: 'A corner is nowhere near your ground — the shape was not saved.' }
    }
    ring.push({ lat: o.lat, lng: o.lng })
  }

  if (!isClosed(ring)) return { ok: false, error: 'The shape has to close — the last corner must meet the first.' }
  // 4 = three corners and the repeat. Anything less encloses nothing.
  if (ring.length < 4) return { ok: false, error: 'A shape needs at least three corners.' }

  // Self-intersection, on the boundary layer's own simple-closed-curve test.
  // ZERO tolerance here, unlike boundary.ts's stopAbove = 2: that tolerance
  // exists because GPS scatter can nick a corner of a driven lap. A person
  // tapping corners has no scatter — a crossing is a crossing.
  const open = ring.slice(0, -1)
  const closedPts: Pt[] = [...projectXY(open, meanLat(open))]
  closedPts.push(closedPts[0])
  if (loopSelfCrossings(closedPts, 0) > 0) {
    return { ok: false, error: 'The edges cross each other. Redraw it without the shape folding over itself.' }
  }

  const areaM2 = polygonAreaM2(ring)
  if (areaM2 < MIN_AREA_M2) {
    return { ok: false, error: 'Those corners do not enclose any ground.' }
  }

  return { ok: true, ring, areaM2, acres: areaM2 / ACRE_M2 }
}

/** Validate a stored/posted GeoJSON Polygon end to end. */
export function validateGeoJSONPolygon(geometry: unknown): RingValidation {
  const g = geometry as { type?: unknown; coordinates?: unknown } | null
  if (!g || typeof g !== 'object') return { ok: false, error: 'The shape is missing.' }
  if (g.type !== 'Polygon') return { ok: false, error: 'A place takes a single drawn outline.' }
  if (!Array.isArray(g.coordinates) || g.coordinates.length !== 1) {
    return { ok: false, error: 'A place takes one outline, with no holes.' }
  }
  const ring = ringFromGeoJSON(g)
  if (!ring) return { ok: false, error: 'A corner is missing its position.' }
  return validateRing(ring)
}

// ─── Display ──────────────────────────────────────────────────────────────────

/**
 * Acreage, said the way the rest of the app says numbers: a real measurement
 * of ground, not a float. Under 10 acres keeps a decimal (a stackyard is 0.4
 * acres and "0 acres" would be a lie); above it, whole acres — nobody walks
 * off the tenth of an acre on a 240-acre pasture.
 */
export function fmtAcres(acres: number | null | undefined): string | null {
  if (acres == null || !Number.isFinite(acres) || acres <= 0) return null
  if (acres < 10) return `${acres.toFixed(1)} acres`
  return `${Math.round(acres).toLocaleString()} acres`
}

/**
 * What gets stored. Two decimals is finer than anyone reads acreage and
 * coarse enough that the column never holds float noise.
 */
export function roundAcres(acres: number): number {
  return Math.round(acres * 100) / 100
}
