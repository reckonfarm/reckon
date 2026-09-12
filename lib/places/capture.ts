import {
  BOUNDARY_CONFIG, ACRE_M2, M_PER_LAT,
  computeFieldBoundary, loopSelfCrossings, meanLat, projectXY,
  type BoundaryConfig, type BoundaryResult,
} from '@/lib/jobs/boundary'
import type { TrackPoint } from '@/lib/jobs/derive'

// ─── Capturing a place in the field (Block 8) ─────────────────────────────────
//
// The geometry is the swather's, unchanged. computeFieldBoundary already takes
// its constants as an argument, so Block 8 passes a PHONE PROFILE and writes no
// closure math of its own — the tied-loop scan, the snap, the self-crossing
// check and the shoelace area are all the code that has been cutting hay since
// August.
//
// Every number below is derived from PK's two probe rides on his own iPhone,
// 2026-09-12, and the derivation is stated so the next person can argue with
// it. Run 2 is the operating condition: 79 fixes over 79 s covering 629 m —
// 8 m/s, about 18 mph, warm receiver, screen on, mounted.
//
//   accuracy   best 1.9 · median 2.1 · p90 4.7 · worst 503.8
//              ≤3 m: 50 of 79 · ≤5 m: 74 of 79
//   interval   median 1.00 s · p90 1.01 s · worst 3.4 s
//
// Run 1 (cold start, screen locked partway) is NOT averaged in — a cold
// receiver is a different state, handled by the settle gate below rather than
// smeared into the constants. Its numbers: median 13.0, p90 27.2, and 48 s
// with zero fixes while the screen was off.

/**
 * The phone profile. Only the constants that differ from BOUNDARY_CONFIG are
 * restated; everything else is inherited deliberately.
 */
export const CAPTURE_CONFIG: BoundaryConfig = {
  ...BOUNDARY_CONFIG,

  // A four-wheeler has no working width. Not a small number — an absent one.
  headerWidthM: 0,
  // p90 4.7, median 2.1. PK's ruling: 2.5, not the cold run's 27.
  gpsScatterM: 2.5,
  // 2 × p90. Two fixes taken at the same physical point can differ by ~9.4 m,
  // so a tie has to tolerate that or a real return reads as an open curve.
  closureEpsM: 10,
  // 2 × eps, NOT the swather's 3 ×. At 3 × this would be 30 m, and a 20 × 20 m
  // pen has a 28 m diagonal — you could never get far enough from your start
  // for the return to count, and the pen would be uncloseable.
  leaveMinM: 20,
  // The swather's 30 was inherited and it silently outranked the area floor.
  // At the measured 1 Hz and 8 m/s, 30 fixes is 240 m of perimeter — a 60 × 60 m
  // enclosure — so minLoopAreaM2's 400 m² could never actually be reached at
  // riding speed and the smaller floor was a lie. 12 matches minLoopPoints:
  // at 1 Hz, a lap of fewer than twelve fixes is not a lap.
  //
  // The two floors now say different things, which is the point. AREA is what
  // the geometry can resolve against 2.5 m scatter. POINTS is whether enough
  // of the perimeter was actually ridden. A 20 m pen walked at 1.5 m/s gives
  // 53 fixes and closes; the same pen at 18 mph gives 10 and does not — so the
  // honest answer to a short ride is "ride it slower, or drop a point", and
  // rideOutcome below tells those two failures apart.
  minTrackPoints: 12,

  // ── GUESSES. Both become numbers after the acceptance ride. ────────────────
  // 1.5 × eps. The swather's 25 came from a season of measured gaps; there is
  // no ride distribution yet, so this is arithmetic, not evidence. A ride that
  // closes on this rather than a true tie is labelled — see `snapped`.
  snapClosureM: 15,
  // A 20 × 20 m pen. Reasoned from a plausible enclosure, not measured. At
  // 2.5 m scatter a ring much smaller is only a few multiples of the noise.
  minLoopAreaM2: 400,

  // ── Guards that cannot apply to a deliberate perimeter ride ────────────────
  // The headland guard rejects loops INSIDE a cut field by looking for track
  // just outside the ring. A perimeter ride is all boundary and has none, so
  // the guard solves a case that cannot occur. PK's ruling: disable, do not
  // retune — retuning would invent a threshold for a situation that does not
  // arise. Infinity, so the comparison is never true.
  headlandOutsideRatioMax: Number.POSITIVE_INFINITY,
  // A ride is ONE lap by design. There is no corroborating second lap to find,
  // so requiring one would grade every honest ride ESTIMATE for a reason that
  // is not a defect.
  secondPassMinShare: 0,
}

/** A fix, as the phone reports it. */
export interface CaptureFix {
  t: number      // ms epoch
  lat: number
  lng: number
  acc: number    // metres, as reported
}

// ── Settle gate (PK's ruling 2) ───────────────────────────────────────────────
// A cold receiver is a real state, not noise to average away. Nothing counts
// toward the polygon until accuracy has settled: run 2 was 94% under 5 m and
// settles within seconds, run 1 managed 4 of 21 and correctly never would.
export const SETTLE_MAX_ACC_M = 5
export const SETTLE_RUNS = 5

/** How many consecutive fixes at the end are within the settle threshold. */
export function settledRun(fixes: CaptureFix[]): number {
  let n = 0
  for (let i = fixes.length - 1; i >= 0 && fixes[i].acc <= SETTLE_MAX_ACC_M; i--) n++
  return n
}
export function hasSettled(fixes: CaptureFix[]): boolean {
  return settledRun(fixes) >= SETTLE_RUNS
}

// ── Outlier rejection (PK's ruling 3) ─────────────────────────────────────────
// Run 2 produced a single 503.8 m fix among 79. 25 m is above five times the
// warm p90 and roughly ten times the median, so it rejects that one and
// nothing else the warm receiver produced. A rejected fix is FLAGGED in the
// track, never silently dropped: the ride should be able to show where the
// receiver lied.
export const MAX_ACCURACY_M = 25
export const isOutlier = (f: CaptureFix): boolean => !(f.acc <= MAX_ACCURACY_M)

// ── Gaps (PK's ruling 4) ──────────────────────────────────────────────────────
// Warm p90 is 1.01 s and the worst warm interval 3.4 s, so 5 s is comfortably
// outside anything normal — and PK's screen-lock gap was 48 s with zero fixes.
// A gap is SHOWN with its duration and NEVER bridged with a drawn line: a line
// between two fixes 48 s apart is a claim about ground nobody rode.
export const GAP_AFTER_S = 5

export interface Gap { fromT: number; toT: number; seconds: number }

export function gapsIn(fixes: CaptureFix[]): Gap[] {
  const out: Gap[] = []
  for (let i = 1; i < fixes.length; i++) {
    const s = (fixes[i].t - fixes[i - 1].t) / 1000
    if (s > GAP_AFTER_S) out.push({ fromT: fixes[i - 1].t, toT: fixes[i].t, seconds: s })
  }
  return out
}

// ── 8.1 — where am I, averaged ────────────────────────────────────────────────
/**
 * The mean of the settled fixes, with the accuracy the person is shown.
 *
 * The reported accuracy is the BEST of the fixes averaged, not the mean of the
 * accuracies: averaging N independent fixes tightens the estimate, and quoting
 * the mean would understate how good the drop is while quoting the worst would
 * overstate how bad. The best single fix is the honest, conservative claim —
 * it is a number the receiver actually reported about this spot.
 */
export function averagePosition(fixes: CaptureFix[]): { lat: number; lng: number; accM: number; used: number } | null {
  const usable = fixes.filter(f => !isOutlier(f))
  if (usable.length === 0) return null
  const lat = usable.reduce((s, f) => s + f.lat, 0) / usable.length
  const lng = usable.reduce((s, f) => s + f.lng, 0) / usable.length
  return { lat, lng, accM: Math.min(...usable.map(f => f.acc)), used: usable.length }
}

// ── 8.2 / 8.3 — the ride becomes a boundary ───────────────────────────────────

export interface RideResult {
  boundary: BoundaryResult
  /** Rejected by the accuracy filter — kept so the ride can show them. */
  rejected: number
  gaps: Gap[]
}

/** Metres between two fixes, the projection lib/jobs/boundary uses. */
export function metresBetween(a: CaptureFix, b: CaptureFix): number {
  const mPerLng = 111_320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot((b.lng - a.lng) * mPerLng, (b.lat - a.lat) * M_PER_LAT)
}

/**
 * The swather's boundary, computed on a phone track with the phone profile.
 * Outliers are removed before the geometry sees them and counted for the UI.
 */
export function rideBoundary(fixes: CaptureFix[]): RideResult {
  const kept = fixes.filter(f => !isOutlier(f))
  const track: TrackPoint[] = kept.map((f, i) => ({
    seq: i, t: Math.round(f.t / 1000), lat: f.lat, lng: f.lng, mg: null, w: null,
    link: i === 0 ? 'gap' : ((f.t - kept[i - 1].t) / 1000 > GAP_AFTER_S ? 'gap' : 'solid'),
  }))
  return {
    boundary: computeFieldBoundary(track, false, CAPTURE_CONFIG),
    rejected: fixes.length - kept.length,
    gaps: gapsIn(kept),
  }
}

/** Straight-line closure — 8.3's "Finish here". Never applied silently. */
export function closeByHand(fixes: CaptureFix[]): { ring: { lat: number; lng: number }[]; areaM2: number; acres: number } | null {
  const kept = fixes.filter(f => !isOutlier(f))
  if (kept.length < 3) return null
  const ring = kept.map(f => ({ lat: f.lat, lng: f.lng }))
  const lat0 = ring.reduce((s, p) => s + p.lat, 0) / ring.length
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const xy = ring.map(p => ({ x: p.lng * mPerLng, y: p.lat * M_PER_LAT }))
  let a = 0
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) a += xy[j].x * xy[i].y - xy[i].x * xy[j].y
  const areaM2 = Math.abs(a) / 2
  return { ring: [...ring, ring[0]], areaM2, acres: areaM2 / ACRE_M2 }
}

/** Below this a ride cannot honestly enclose anything — 8.1 is the right tool. */
export const TOO_SMALL_M2 = CAPTURE_CONFIG.minLoopAreaM2

// ── What the ride amounts to, in words the screen can use ─────────────────────
// PK's note 2: a ride that cannot close must fail HELPFULLY. The two ways it
// falls short are different problems with different answers, and lumping them
// into "couldn't save" would leave someone re-riding a pen that will never
// close no matter how many times they go round it.
export type RideOutcomeKind =
  | 'confirmed'   // tied, measured, nothing qualifying it
  | 'snapped'     // closed on the guess — labelled, never silent
  | 'too_small'   // encloses less than the geometry can resolve → drop a point
  | 'too_short'   // not enough of the perimeter ridden → ride slower, or drop a point
  | 'open'        // never came back near the start → Finish here, or keep riding
  | 'crossed'     // the track crosses itself; the shape is ambiguous

export interface RideOutcome {
  kind: RideOutcomeKind
  /** Plain sentence for the screen. Never a status word on its own. */
  message: string
  /** True when dropping a single point is the better tool for this thing. */
  offerDrop: boolean
  acres: number | null
}

export function rideOutcome(r: RideResult, fixes: CaptureFix[]): RideOutcome {
  const b = r.boundary
  const acres = b.acres ?? null
  if (b.polygon && b.snapped) {
    return { kind: 'snapped', acres, offerDrop: false,
      message: `Closed at the nearest return, ${Math.round(b.closureDistM ?? 0)} m from where you started — not a true tie, so the acreage is an estimate.` }
  }
  if (b.polygon) return { kind: 'confirmed', acres, offerDrop: false, message: 'The loop tied where you started.' }

  // Below here the geometry found nothing, and it collapses several different
  // problems into 'no_loop' / 'too_few_points'. The screen needs them apart,
  // so the distinctions are drawn HERE rather than guessed from a status word.
  const kept = fixes.filter(f => !isOutlier(f))
  if (kept.length < CAPTURE_CONFIG.minTrackPoints) {
    return { kind: 'too_short', acres: null, offerDrop: true,
      message: `Only ${kept.length} usable ${kept.length === 1 ? 'fix' : 'fixes'} — too little of the perimeter to measure. Ride it slower, or drop a single point instead.` }
  }

  // What WOULD it enclose if we simply joined the ends? That answers "is this
  // thing too small to resolve" and "did the track cross itself", neither of
  // which the boundary status can tell us on its own.
  const hand = closeByHand(kept)
  if (hand) {
    if (hand.areaM2 < TOO_SMALL_M2) {
      return { kind: 'too_small', acres: null, offerDrop: true,
        message: `That encloses about ${Math.round(hand.areaM2)} m² — less than ${Math.round(TOO_SMALL_M2)} m², which is smaller than this phone can tell from its own scatter. For a tank, a gate or a stack, drop a point instead.` }
    }
    const lat0 = meanLat(hand.ring)
    if (loopSelfCrossings(projectXY(hand.ring, lat0), 1) > 0) {
      return { kind: 'crossed', acres: null, offerDrop: false,
        message: 'The track crosses itself, so the shape is ambiguous. Ride the outside line once, without cutting back through.' }
    }
  }

  return { kind: 'open', acres: null, offerDrop: false,
    message: 'The loop never came back near where you started. Keep riding to close it, or use Finish here to close it in a straight line.' }
}
