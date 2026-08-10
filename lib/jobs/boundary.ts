import type { TrackPoint } from './derive'

// ─── Field boundary — the largest tied loop in the track ───────────────────────
//
// The operating fact: every field gets outside rounds. Cutting outside-in, the
// first lap around the perimeter is the biggest closed loop the track will ever
// draw; cutting a pivot inside-out, the LAST lap is. One rule covers both
// directions: the boundary is the LARGEST closed loop in the track.
//
// A loop only counts when it is TIED — the track physically returns to within
// closureEpsM of its own start point (header width + 2× GPS scatter). We never
// force-close a distant chord: an open curve is not a boundary, it's a wish.
// Closure is FIRST-return per start point, which is also what prevents a
// two-lap track from winding up double the field's area.
//
// One hard guard and one GRADE keep the loop honest. Aug 5 proved the failure
// mode: a session hopping between nearby patches produces a meander that
// eventually returns near itself, and multi_field stays false (the deriver's
// 400 m cluster rule never fires on patches 50–100 m apart).
//
//   GATE — explain share: the boundary must account for the track. If a big
//   share of the job's points lie outside the loop (plus margin), the loop is
//   a chapter, not the story — no boundary, no acreage, no percent. This is
//   what kills the Aug 5 meander (37%), and it runs BEFORE the grade below:
//   the Aug 10 diagnosis caught the original order returning 'unverified' for
//   loops that had never been explain-checked, which would have let a mosaic
//   claim an "unconfirmed estimate" it hadn't earned.
//
//   GRADE — two-pass verification: the operator's own habit is the check.
//   Outside rounds mean a second concentric lap runs just inside the first,
//   so a corroborated boundary has track support a few header-widths inside
//   most of its perimeter. Fill rows count too — they run alongside whichever
//   edges the work has reached, so a one-round field self-confirms as the
//   fill progresses (Aug 10: south edge 100%, north 0%, share 41.5% and
//   climbing when the operator stopped). Short corroboration is honesty about
//   ACCUMULATION, not doubt about the tie — so it grades 'estimate' rather
//   than gating: same numbers, stated caveat. The operator must never have to
//   change how they cut to make the software speak.
//
// Area is buffered outward by half the header: the track is where the MACHINE
// went; the cut extends half a header past it on each side. Buffered area =
// A + P·r + πr² (Minkowski sum with a disc — exact for convex, near-exact for
// the gently concave loops real fields produce).
//
// Pure module, no I/O, no Date.now() — same doctrine as derive.ts. Display
// code and the read-only CLI call it; nothing here writes anywhere.

export const BOUNDARY_CONFIG = {
  headerWidthM: 4.9, // the one machine constant: MacDon header width
  gpsScatterM: 3.7, // measured scatter of the Scout's fix
  closureEpsM: 12, // header + 2× scatter, rounded — a loop "ties" within this
  leaveMinM: 36, // 3× eps: must get this far from the anchor before a return counts
  minTrackPoints: 30, // fewer positioned points than this can't state a boundary
  minLoopPoints: 12, // a tied loop of fewer points is a turn, not a lap
  minLoopAreaM2: 2000, // ~half an acre — smaller enclosures are headlands, not fields
  maxLoopSearchPoints: 3000, // stride-decimate above this; O(n²) stays ~50 ms
  secondPassBandM: 15, // ~3 header widths — where the corroborating lap must run
  secondPassMinShare: 0.5, // share of boundary vertices needing inside support
  explainMarginM: 10, // ~2 header widths outside the boundary still counts as "explained"
  explainMinShare: 0.8, // the boundary must account for this share of the track
} as const

export const ACRE_M2 = 4046.8564224
export const M_PER_LAT = 111_132

export type BoundaryStatus =
  | 'confirmed' // tied + explained + second-pass corroborated: full numbers
  | 'estimate' // tied + explained, corroboration still short: numbers + caveat
  | 'multi_field' // deriver flag — never compute across a road
  | 'too_few_points'
  | 'no_loop' // outside rounds not tied off yet (or never)
  | 'unexplained' // a loop tied, but most of the track lives outside it — silence

// The two grades that may show numbers. Everything below them is silence.
export function boundaryQualified(status: BoundaryStatus): boolean {
  return status === 'confirmed' || status === 'estimate'
}

export interface BoundaryResult {
  status: BoundaryStatus
  /** The tied loop, in track order (machine centerline of the outermost pass). */
  polygon: { lat: number; lng: number }[] | null
  /** Buffered outward by headerWidthM/2 — the cut area the loop encloses. */
  areaM2: number | null
  acres: number | null
  rawAreaM2: number | null
  perimeterM: number | null
  closureDistM: number | null
  loopSeqStart: number | null
  loopSeqEnd: number | null
  /** Share of boundary vertices with a non-loop track point within the band. */
  secondPassShare: number | null
  /** Share of all track points inside the boundary (+ margin). */
  explainShare: number | null
  /**
   * Mean gap between the boundary lap and a second concentric lap inside it,
   * when one exists — the operator's real effective cut width, and the number
   * that eventually settles the buffer question (raw vs buffered vs onX).
   * BIASED LOW by GPS scatter: noise on both rings shrinks the mean gap
   * (synthetic two-lap field reads 4.41 m against a true 4.9 m header), so
   * this is EVIDENCE THAT ACCUMULATES ACROSS FIELDS, never a per-field ruler.
   * Recorded for the CLI, never displayed.
   */
  loopSpacingM: number | null
}

// Shared flat-earth helpers — exported for lib/jobs/sweep.ts (and anything
// else that measures the same ground), so the projection can never drift
// between the boundary and the sweep that is judged against it.
export interface Pt {
  x: number
  y: number
}

export function meanLat(points: { lat: number }[]): number {
  return points.reduce((s, p) => s + p.lat, 0) / points.length
}

export function projectXY(points: { lat: number; lng: number }[], lat0: number): Pt[] {
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  return points.map(p => ({ x: p.lng * mPerLng, y: p.lat * M_PER_LAT }))
}

interface XY extends Pt {
  seq: number
  idx: number // index into the ORIGINAL track array
}

function project(track: TrackPoint[]): XY[] {
  const lat0 = meanLat(track)
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  return track.map((p, idx) => ({ x: p.lng * mPerLng, y: p.lat * M_PER_LAT, seq: p.seq, idx }))
}

function shoelaceAbs(pts: XY[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

function ringPerimeter(pts: XY[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += Math.hypot(a.x - b.x, a.y - b.y)
  }
  return s
}

export function pointInPolygon(p: Pt, ring: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function distToRing(p: Pt, ring: Pt[]): number {
  let min = Infinity
  for (let i = 0; i < ring.length; i++) {
    const d = distToSegment(p, ring[i], ring[(i + 1) % ring.length])
    if (d < min) min = d
  }
  return min
}

// Convex hull (monotone chain) — the sanity check the boundary is judged
// against, never the boundary itself: a hull can't see concave field edges and
// happily swallows the road between patches.
export function convexHullAreaM2(track: TrackPoint[]): number | null {
  if (track.length < 3) return null
  const pts = project(track)
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: XY[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: XY[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return shoelaceAbs(lower.slice(0, -1).concat(upper.slice(0, -1)))
}

export function computeFieldBoundary(
  track: TrackPoint[],
  multiField: boolean,
  cfg: typeof BOUNDARY_CONFIG = BOUNDARY_CONFIG,
): BoundaryResult {
  const empty: Omit<BoundaryResult, 'status'> = {
    polygon: null, areaM2: null, acres: null, rawAreaM2: null, perimeterM: null,
    closureDistM: null, loopSeqStart: null, loopSeqEnd: null,
    secondPassShare: null, explainShare: null, loopSpacingM: null,
  }

  if (multiField) return { status: 'multi_field', ...empty }
  if (track.length < cfg.minTrackPoints) return { status: 'too_few_points', ...empty }

  const all = project(track)

  // Loop search runs on a stride-decimated copy when the track is huge — the
  // adjacent-lap geometry survives 2–4× decimation easily (a lap passes within
  // header width of the anchor for many consecutive points, not one).
  const stride = Math.max(1, Math.ceil(all.length / cfg.maxLoopSearchPoints))
  const pts = stride === 1 ? all : all.filter((_, i) => i % stride === 0)

  const eps2 = cfg.closureEpsM ** 2
  const leave2 = cfg.leaveMinM ** 2

  // First spatial return per anchor; largest tied loop wins. Every tied loop
  // above the area floor is kept as a candidate — the second-largest DISTINCT
  // lap is where loop-to-loop spacing (effective cut width) comes from.
  type Cand = { area: number; i: number; j: number; closure: number }
  const candidates: Cand[] = []
  let best: Cand | null = null
  for (let i = 0; i < pts.length - cfg.minLoopPoints; i++) {
    const anchor = pts[i]
    let left = false
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j].x - anchor.x
      const dy = pts[j].y - anchor.y
      const dd = dx * dx + dy * dy
      if (!left) {
        if (dd > leave2) left = true
        continue
      }
      if (dd <= eps2) {
        if (j - i >= cfg.minLoopPoints) {
          const loop = pts.slice(i, j + 1)
          const area = shoelaceAbs(loop)
          if (area >= cfg.minLoopAreaM2) {
            const cand = { area, i, j, closure: Math.sqrt(dd) }
            candidates.push(cand)
            if (best == null || area > best.area) best = cand
          }
        }
        break // first return only — a later, larger "return" would be winding
      }
    }
  }

  if (best == null) return { status: 'no_loop', ...empty }

  const ring = pts.slice(best.i, best.j + 1)
  const loopIdxStart = ring[0].idx
  const loopIdxEnd = ring[ring.length - 1].idx

  // Two-pass verification: for each boundary vertex, is there a track point
  // from OUTSIDE the loop's own span within the band? The concentric second
  // lap provides it; a meander has nothing running alongside itself.
  let supported = 0
  for (const v of ring) {
    let hit = false
    for (const p of all) {
      if (p.idx >= loopIdxStart && p.idx <= loopIdxEnd) continue
      const dx = p.x - v.x
      const dy = p.y - v.y
      if (dx * dx + dy * dy <= cfg.secondPassBandM ** 2) {
        hit = true
        break
      }
    }
    if (hit) supported++
  }
  const secondPassShare = supported / ring.length

  // Explain share: inside the ring, or within the margin of its edge.
  let explained = 0
  for (const p of all) {
    if (pointInPolygon(p, ring) || distToRing(p, ring) <= cfg.explainMarginM) explained++
  }
  const explainShare = explained / all.length

  // Loop-to-loop spacing: the largest candidate lap that is a DISTINCT pass
  // (index span disjoint from the boundary lap's), materially smaller, and
  // sitting inside the boundary ring. Its mean gap to the boundary is the
  // operator's real effective cut width. One round → null, honestly.
  let loopSpacingM: number | null = null
  const inner = candidates
    .filter(c => (c.i >= best.j || c.j <= best.i) && c.area >= 0.3 * best.area && c.area <= 0.97 * best.area)
    .sort((a, b) => b.area - a.area)
    .slice(0, 3)
  for (const c of inner) {
    const cRing = pts.slice(c.i, c.j + 1)
    let insideCount = 0
    let distSum = 0
    for (const v of cRing) {
      if (pointInPolygon(v, ring)) insideCount++
      distSum += distToRing(v, ring)
    }
    const meanDist = distSum / cRing.length
    if (insideCount / cRing.length >= 0.7 && meanDist >= 1.5 && meanDist <= cfg.secondPassBandM) {
      loopSpacingM = meanDist
      break
    }
  }

  const rawAreaM2 = best.area
  const perimeterM = ringPerimeter(ring)
  const r = cfg.headerWidthM / 2
  const areaM2 = rawAreaM2 + perimeterM * r + Math.PI * r * r

  const result: Omit<BoundaryResult, 'status'> = {
    polygon: ring.map(p => ({ lat: track[p.idx].lat, lng: track[p.idx].lng })),
    areaM2,
    acres: areaM2 / ACRE_M2,
    rawAreaM2,
    perimeterM,
    closureDistM: best.closure,
    loopSeqStart: ring[0].seq,
    loopSeqEnd: ring[ring.length - 1].seq,
    secondPassShare,
    explainShare,
    loopSpacingM,
  }

  // ORDER MATTERS: explain-share is the hard gate and runs first — a loop
  // that doesn't describe the job must never surface, not even as an
  // estimate. Second-pass corroboration is a GRADE on loops that passed it.
  if (explainShare < cfg.explainMinShare) return { status: 'unexplained', ...result }
  if (secondPassShare < cfg.secondPassMinShare) return { status: 'estimate', ...result }
  return { status: 'confirmed', ...result }
}
