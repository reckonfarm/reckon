import type { TrackPoint } from './derive'
import { segmentWorkAreas } from './clusters'

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
  explainMinShare: 0.8, // below this the boundary grades ESTIMATE ("some nearby cutting isn't this field's")
  // CLOSE-ENOUGH CLOSURE (operator's ruling, final cutting day: "it has to
  // close new ones even if it's off a little bit"). A loop whose closest
  // return sits past closureEpsM but within snapClosureM is SNAPPED shut and
  // grades at most ESTIMATE with the unconfirmed caveat. 25 m from the
  // season's gap distribution: every real field tied at 4.3–12.7 m (the one
  // miss, a 13.3-ac field with three concentric rounds, at 12.7); junk and
  // headland loops sit at 15–39 m and the headland guard handles those. At
  // 40 m the Aug 8 baler grows a bogus 0.68-ac loop — 25 keeps it loopless.
  snapClosureM: 25,
  // HEADLAND GUARD — the bogus-field check that replaces the cluster-union
  // kill switch. A real field edge has little track just OUTSIDE it (a
  // neighbor's turns, transit); a headland loop inside a bigger field is
  // smothered by that field's rows. Track points in the secondPassBandM band
  // outside the ring ÷ points inside: real fields measure 0.07–0.48 across
  // the season, headland/junk loops 0.62–4.6. Above the max → not a field.
  headlandOutsideRatioMax: 0.55,
  // RESIDUE — track farther than this outside every surviving field is "not
  // mapped to a field yet": reported as a share, never a kill switch.
  residueBandM: 25,
  // A work area where MOST of the cutting is residue is a mosaic: its loops
  // are chapters, and every field in it grades at most ESTIMATE ("cutting
  // right next to it isn't mapped to this field"). Aug 5 = 69% residue.
  mosaicResidueShare: 0.5,
} as const

export const ACRE_M2 = 4046.8564224
export const M_PER_LAT = 111_132

export type BoundaryStatus =
  | 'confirmed' // tied + explained + second-pass corroborated: full numbers
  | 'estimate' // tied (or snapped), numbers + a caveat naming why (estimateReasons)
  | 'multi_field' // deriver flag — never compute across a road
  | 'too_few_points'
  | 'no_loop' // outside rounds not tied off yet (or never), even at snap tolerance
  | 'unexplained' // loops tied, but every one is a headland loop inside a bigger working area — no field here

export type EstimateReason =
  | 'second_pass' // one round; a second round (or finishing the field) confirms it
  | 'explain' // cutting right next to this field isn't mapped to it
  | 'snapped' // the outside round didn't quite close; closed at the nearest return

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
  /** The loop's closest return sat past closureEpsM — closed at snapClosureM. */
  snapped: boolean
  /** Why the grade is ESTIMATE rather than CONFIRMED (empty otherwise). */
  estimateReasons: EstimateReason[]
  /** Headland-guard input: track just outside the ring ÷ track inside it. */
  outsideRatio: number | null
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

function shoelaceAbs(pts: Pt[]): number {
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

// ─── Simple-closed-curve test — a boundary must not cross itself ───────────────
// A perimeter lap is a simple closed curve. A winding fill path that happens
// to re-enter its own start radius is NOT — it self-intersects dozens of
// times, and the shoelace area of a self-intersecting polygon is inflated by
// its double-wound regions (Aug 23 proved it: a serpentine "loop" claimed
// 22 raw acres against its own 19-acre convex hull, which is impossible for
// a simple polygon). So candidate loops must pass this test before they can
// win: count proper segment crossings among non-adjacent edges, tolerating a
// couple (GPS scatter can nick a corner); a serpentine fails in the first few
// comparisons, a real lap — even a long thin strip field — has none.
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  const o1 = o(a, b, c)
  const o2 = o(a, b, d)
  const o3 = o(c, d, a)
  const o4 = o(c, d, b)
  // Proper crossings only: collinear touches (o = 0) are GPS-noise overlaps
  // on retraced ground, not the winding this test exists to catch.
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0
}

export function loopSelfCrossings(loop: Pt[], stopAbove = 2): number {
  let n = 0
  for (let i = 0; i < loop.length - 1; i++) {
    for (let j = i + 2; j < loop.length - 1; j++) {
      if (i === 0 && j === loop.length - 2) continue // closing edge is adjacent to the first
      if (segmentsCross(loop[i], loop[i + 1], loop[j], loop[j + 1])) {
        n++
        if (n > stopAbove) return n
      }
    }
  }
  return n
}

const MAX_LOOP_SELF_CROSSINGS = 2

// Convex hull (monotone chain) — the sanity check the boundary is judged
// against, never the boundary itself: a hull can't see concave field edges and
// happily swallows the road between patches.
export function convexHullAreaM2(points: { lat: number; lng: number }[]): number | null {
  if (points.length < 3) return null
  const pts = projectXY(points, meanLat(points))
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pt[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Pt[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return shoelaceAbs(lower.slice(0, -1).concat(upper.slice(0, -1)))
}

// ─── Tied-loop scan — shared by the single-field path and the multi-loop
// cluster path so both see the same candidates ────────────────────────────────
// First spatial return per anchor; every tied loop above the area floor is a
// candidate, sorted largest first. Simplicity is tested lazily by callers in
// descending-area order, so a field with a clean lap pays for a handful of
// checks, not hundreds.
export interface LoopCandidate {
  area: number
  i: number // start index into the (possibly decimated) point array
  j: number // end index (inclusive)
  closure: number
}

function scanTiedLoops(pts: XY[], cfg: typeof BOUNDARY_CONFIG): LoopCandidate[] {
  const eps2 = cfg.closureEpsM ** 2
  const snap2 = cfg.snapClosureM ** 2
  const leave2 = cfg.leaveMinM ** 2
  const candidates: LoopCandidate[] = []
  for (let i = 0; i < pts.length - cfg.minLoopPoints; i++) {
    const anchor = pts[i]
    let left = false
    let bestJ = -1
    let bestDd = Infinity
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j].x - anchor.x
      const dy = pts[j].y - anchor.y
      const dd = dx * dx + dy * dy
      if (!left) {
        if (dd > leave2) left = true
        continue
      }
      // Closest return wins; a true tie (≤ eps) ends the search at once —
      // first return only, a later, larger "return" would be winding.
      if (dd < bestDd) {
        bestDd = dd
        bestJ = j
      }
      if (dd <= eps2) break
    }
    if (bestJ < 0 || bestDd > snap2 || bestJ - i < cfg.minLoopPoints) continue
    const loop = pts.slice(i, bestJ + 1)
    const area = shoelaceAbs(loop)
    if (area >= cfg.minLoopAreaM2) {
      candidates.push({ area, i, j: bestJ, closure: Math.sqrt(bestDd) })
    }
  }
  // Largest first — but a SNAPPED loop must beat a true tie by more than 3%
  // to outrank it: the same field seen from two anchors (one tied at 5 m,
  // one snapped at 21 m) must resolve to the tie, never the snap.
  const rank = (c: LoopCandidate) => (c.closure > cfg.closureEpsM ? c.area * 0.97 : c.area)
  candidates.sort((a, b) => rank(b) - rank(a))
  return candidates
}

function isSimpleLoop(pts: XY[], c: LoopCandidate): boolean {
  return loopSelfCrossings(pts.slice(c.i, c.j + 1), MAX_LOOP_SELF_CROSSINGS) <= MAX_LOOP_SELF_CROSSINGS
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
    snapped: false, estimateReasons: [], outsideRatio: null,
  }

  if (multiField) return { status: 'multi_field', ...empty }
  if (track.length < cfg.minTrackPoints) return { status: 'too_few_points', ...empty }

  const all = project(track)

  // Loop search runs on a stride-decimated copy when the track is huge — the
  // adjacent-lap geometry survives 2–4× decimation easily (a lap passes within
  // header width of the anchor for many consecutive points, not one).
  const stride = Math.max(1, Math.ceil(all.length / cfg.maxLoopSearchPoints))
  const pts = stride === 1 ? all : all.filter((_, i) => i % stride === 0)

  const candidates = scanTiedLoops(pts, cfg)
  const isSimple = (c: LoopCandidate) => isSimpleLoop(pts, c)
  // Largest simple loop that is not a headland loop — a tied lap smothered by
  // its own surroundings is a turn inside a field, never the field.
  let best: LoopCandidate | null = null
  let outsideRatio: number | null = null
  for (const c of candidates) {
    if (!isSimple(c)) continue
    const ratio = headlandRatio(all, pts.slice(c.i, c.j + 1), cfg)
    if (ratio > cfg.headlandOutsideRatioMax) continue
    best = c
    outsideRatio = ratio
    break
  }

  if (best == null) {
    // Loops tied but every one was a headland loop → the track holds no
    // field of its own; plain no-loop when nothing tied at all.
    return { status: candidates.some(isSimple) ? 'unexplained' : 'no_loop', ...empty }
  }

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
  const inner = candidates // already sorted descending by area
    .filter(c => (c.i >= best.j || c.j <= best.i) && c.area >= 0.3 * best.area && c.area <= 0.97 * best.area)
    .slice(0, 8)
  for (const c of inner) {
    if (!isSimple(c)) continue // a lap is a simple curve; serpentines don't measure spacing
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
    snapped: best.closure > cfg.closureEpsM,
    estimateReasons: [],
    outsideRatio,
  }

  // GRADES, NOT GATES (final-cutting-day doctrine): a tied simple loop that
  // isn't a headland loop always SHOWS. Anything short of full corroboration
  // is an ESTIMATE that names its reason — the honesty lives in the words.
  const reasons: EstimateReason[] = []
  if (result.snapped) reasons.push('snapped')
  if (explainShare < cfg.explainMinShare) reasons.push('explain')
  if (secondPassShare < cfg.secondPassMinShare) reasons.push('second_pass')
  if (reasons.length > 0) return { status: 'estimate', ...result, estimateReasons: reasons }
  return { status: 'confirmed', ...result }
}

// Headland guard: track in the band just outside the ring (excluding the
// lap's own span) ÷ track inside it.
function headlandRatio(all: XY[], ring: XY[], cfg: typeof BOUNDARY_CONFIG): number {
  const spanStart = ring[0].idx
  const spanEnd = ring[ring.length - 1].idx
  let outside = 0
  let inside = 0
  for (const p of all) {
    if (pointInPolygon(p, ring)) {
      inside++
      continue
    }
    if (p.idx >= spanStart && p.idx <= spanEnd) continue
    if (distToRing(p, ring) <= cfg.secondPassBandM) outside++
  }
  return outside / Math.max(inside, 1)
}

// ─── Multi-field: a SEGMENTER, not a suppressor ────────────────────────────────
//
// multi_field is a FACT on the job ("this session spans N work areas"), and it
// used to silence everything. Now it routes: the track splits into per-field
// segments along the deriver's own cluster rule (lib/jobs/clusters.ts — one
// algorithm, so the fact and the split can never disagree), and every segment
// runs the FULL existing pipeline against its own points only. Nothing is
// loosened: each field faces the same tie, the same explain-share gate, the
// same second-pass grade. A field whose outside rounds went unrecorded
// degrades honestly to silence; it never borrows a neighbor's loop.

export interface FieldSegment {
  /** 1-based, in time order — "Field 1" on screen. */
  index: number
  track: TrackPoint[]
  boundary: BoundaryResult
  /**
   * Share of the field's WORK AREA (cluster) lying farther than residueBandM
   * outside every field found there — cutting "not mapped to a field yet".
   * A reported fact on every field of the cluster, never a kill switch.
   */
  residueShare: number
}

// ─── Multi-loop clusters — adjacent fields sharing one work area ───────────────
//
// Fields that touch land in ONE spatial cluster (the 150 m cell rule joins
// them). Within a cluster, ALL distinct simple tied loops become fields, each
// graded by the unchanged per-field pipeline on the points nearest to it.
//
// NO COLLECTIVE PUNISHMENT (final-cutting-day doctrine): a field that
// qualifies on its own shows — boundary, acres, fill — regardless of what
// its neighbors did. The cluster-union share that used to silence everything
// is now RESIDUE: the share of the cluster's track farther than residueBandM
// from every field, reported on the page as "some of this track isn't mapped
// to a field yet". Two things still keep a loop from being a field: the
// headland guard (a tied lap smothered by its own surroundings is a turn
// inside a field — Aug 23 AM's half-acre headland loops) and the area floor.
//
// Distinct means disjoint: a candidate with ≥ half its vertices inside an
// accepted loop is that field's concentric lap (spacing evidence and fill),
// not a new field. Round-and-round: the outermost lap is the largest, wins
// first, and every inner lap is absorbed — their paint is fill by construction.

const NESTED_ABSORB_SHARE = 0.5

function computeClusterFields(
  track: TrackPoint[],
  cfg: typeof BOUNDARY_CONFIG = BOUNDARY_CONFIG,
): { fields: TrackPoint[][]; residueShare: number } {
  if (track.length < cfg.minTrackPoints) return { fields: [track], residueShare: 0 }

  const all = project(track)
  const stride = Math.max(1, Math.ceil(all.length / cfg.maxLoopSearchPoints))
  const pts = stride === 1 ? all : all.filter((_, i) => i % stride === 0)

  const candidates = scanTiedLoops(pts, cfg)
  const distinct: XY[][] = []
  for (const c of candidates) {
    if (!isSimpleLoop(pts, c)) continue
    const ring = pts.slice(c.i, c.j + 1)
    const absorbed = distinct.some(d => {
      let inside = 0
      for (const v of ring) if (pointInPolygon(v, d) || distToRing(v, d) <= cfg.explainMarginM) inside++
      return inside / ring.length >= NESTED_ABSORB_SHARE
    })
    if (absorbed) continue
    if (headlandRatio(all, ring, cfg) > cfg.headlandOutsideRatioMax) continue
    distinct.push(ring)
  }
  if (distinct.length === 0) return { fields: [track], residueShare: 0 }

  // Proximity assignment; per-loop grading happens in the caller via the
  // unchanged single-field pipeline on each subset. Residue is a fact.
  // A field OWNS the points inside it or within residueBandM of its edge —
  // its own rows, its own headland turns. Anything farther from every field
  // is residue: counted, reported, and kept out of every field's grade so a
  // neighbor's unmapped cutting can never downgrade a field that closed.
  const assigned: TrackPoint[][] = distinct.map(() => [])
  const lapSeq = distinct.map(d => track[d[0].idx].seq)
  let residue = 0
  for (const p of all) {
    let best = 0
    let bd = Infinity
    distinct.forEach((d, k) => {
      const dist = pointInPolygon(p, d) ? 0 : distToRing(p, d)
      if (dist < bd) {
        bd = dist
        best = k
      }
    })
    if (bd > cfg.residueBandM) {
      residue++
      continue
    }
    assigned[best].push(track[p.idx])
  }
  const order = assigned.map((f, k) => ({ f, lap: lapSeq[k] })).filter(x => x.f.length > 0).sort((a, b) => a.lap - b.lap)
  return { fields: order.map(x => x.f), residueShare: residue / all.length }
}

export function computeFieldBoundaries(track: TrackPoint[], multiField: boolean): FieldSegment[] {
  // Work areas first (the deriver's multi_field fact → spatial clusters), then
  // fields within each area (adjacent fields sharing a cluster). Indexes are
  // time-ordered across everything so "Field 2" means the second field cut.
  let clusters: TrackPoint[][]
  if (!multiField) {
    clusters = [track]
  } else {
    const segments = segmentWorkAreas(track)
    if (segments.length < 2) {
      // The deriver stamped multi_field but read-time clustering found one
      // work area — same algorithm, same data, so this shouldn't happen.
      // Honor the stored fact and stay silent rather than compute across a road.
      return [{ index: 1, track, boundary: computeFieldBoundary(track, true), residueShare: 0 }]
    }
    clusters = segments
  }

  const out: FieldSegment[] = []
  for (const c of clusters) {
    const { fields, residueShare } = computeClusterFields(c)
    for (const f of fields) {
      let boundary = computeFieldBoundary(f, false)
      // Mosaic cap: a work area that is mostly residue can't confirm any field.
      if (boundary.status === 'confirmed' && residueShare >= BOUNDARY_CONFIG.mosaicResidueShare) {
        boundary = { ...boundary, status: 'estimate', estimateReasons: ['explain'] }
      }
      out.push({ index: 0, track: f, boundary, residueShare })
    }
  }
  const timeKey = (f: FieldSegment) => f.boundary.loopSeqStart ?? f.track[0].seq
  out.sort((a, b) => timeKey(a) - timeKey(b))
  out.forEach((f, i) => { f.index = i + 1 })
  return out
}
