// ─── Field boundary report — READ-ONLY, always. Also the regression test. ──────
//
//   Everything:        npx tsx scripts/field-report.ts
//   One device only:   npx tsx scripts/field-report.ts --hardware 14c19f3534f0
//
// (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local)
//
// For every derived job: the boundary grade and why — tied-loop acreage (raw,
// buffered, and the raster field size the percent actually divides by), acres
// cut, closure distance, second-pass and explain shares, loop-to-loop spacing
// when two concentric laps exist (the operator's real effective cut width —
// the number that eventually settles the buffer), and the completion gap on
// finished jobs (acres-cut should converge on field size; a fully cut field
// that doesn't close the gap means something's wrong).
//
// Multi-field jobs run the SEGMENTER (lib/jobs/boundary.ts
// computeFieldBoundaries): the track splits into per-field clusters and every
// field prints its own full block — same guards, same grades, per field.
//
// SELF-CHECKING (same doctrine as detect-bales.ts): the known-ground matrix
// below must hold on the scout's real data, and the process exits nonzero
// when it doesn't. Two standing tripwires run on EVERY qualified loop, not
// just the matrix cases:
//   * hull-exceedance — a simple polygon's area can never exceed its own
//     convex hull's; if a winner does, the simple-loop filter has a hole.
//   * boundary divergence — the drawn edge held against the field-size raster;
//     fill containment — paint must never escape the field (the fill itself
//     is a picture by doctrine and is never held against the number).
// This script NEVER writes; there is no wet run — boundaries are computed at
// read time, per job, on purpose.

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { createClient } from '@supabase/supabase-js'
import {
  computeFieldBoundaries,
  convexHullAreaM2,
  boundaryQualified,
  ACRE_M2,
  BOUNDARY_CONFIG,
  type BoundaryResult,
  type EstimateReason,
  type BoundaryStatus,
  type FieldSegment,
} from '../lib/jobs/boundary'
import { computeSweep, computeSweepRender, SWEEP_CONFIG, type FloorReason } from '../lib/jobs/sweep'
import { RENDER_CONFIG } from '../lib/jobs/render-geometry'
import { computeEta } from '../lib/jobs/eta'
import { isInProgress } from '../lib/jobs/display'
import type { TrackPoint } from '../lib/jobs/derive'

const SYNTH_HARDWARE = 'synthetic'

// ─── Known ground — the regression matrix ──────────────────────────────────────
// Aug 10 is the first REAL-GROUND acreage case: onX reference 2.3 ac, loop raw
// 2.29, buffered 2.55. All three recorded; NO winner picked yet — loop-to-loop
// spacing from future two-round fields settles the buffer question. The
// buffered range below is deliberately loose (±0.15) so re-derivation jitter
// doesn't cry wolf; a real algorithm change will blow well past it.
//
// Aug 23 is the first SEGMENTED multi-field case (three fields cut, one
// session). Field 1's outside rounds fell in a GPS cold-start window (first
// ~188 events unpositioned) — it must stay silent; fields 2 and 3 tie clean
// simple laps and grade CONFIRMED. Their acre ranges are REGRESSION LOCKS,
// not acceptance: operator ground truth is pending and joins this matrix
// when reported.
type FieldExpectation = {
  index: number
  status: BoundaryStatus
  bufferedAcRange?: [number, number]
  /** Lock: a qualified field with swept ground always draws fill polygons
   *  (the fill is a picture — no suppression branch exists any more). */
  fillRendered?: boolean
  /** Lock on the raw swept fraction, in percent — set after the dt hop rule
   *  (cutting = dt ≤ 60 s, not d ≤ 25 m) landed. */
  sweptPctRange?: [number, number]
  /** Lock on floor detection: true = undersampled, displays say "at least". */
  sweepFloor?: boolean
  /** Lock on WHICH detector(s) fired — provenance, exact set. */
  floorReasons?: FloorReason[]
  /** Lock on why a boundary is an estimate — exact set. */
  estimateReasons?: EstimateReason[]
  /** Lock on the completion chain: confirmed + (≥90% or floor) → proposes. */
  proposesCut?: boolean
}
const REGRESSION: {
  hardware: string
  seqStart: number
  label: string
  multiField?: boolean // assert the deriver's stored fact
  status?: BoundaryStatus // single-field jobs: the one grade
  bufferedAcRange?: [number, number]
  fillRendered?: boolean
  sweptPctRange?: [number, number]
  sweepFloor?: boolean
  floorReasons?: FloorReason[]
  estimateReasons?: EstimateReason[]
  residueRange?: [number, number]
  proposesCut?: boolean
  allFieldsSilent?: boolean // multi-field: no segment may show numbers
  fields?: FieldExpectation[]
}[] = [
  // DOCTRINE CHANGE (final cutting day): the mosaic's largest loop may show
  // as an ESTIMATE with the residue line, but must never read CONFIRMED —
  // the 69% residue caps it. Was: must be silent (UNEXPLAINED).
  { hardware: '14c19f3534f0', seqStart: 111, label: 'Aug 5 mosaic — may estimate, must not confirm', status: 'estimate', estimateReasons: ['explain'], residueRange: [0.6, 0.8] },
  { hardware: '14c19f3534f0', seqStart: 11005, label: 'Aug 7 rake — multi-field, every segment silent', multiField: true, allFieldsSilent: true },
  { hardware: '14c19f3534f0', seqStart: 11064, label: 'Aug 8 baling — no perimeter laps', status: 'no_loop' },
  {
    hardware: '14c19f3534f0', seqStart: 11163,
    label: 'Aug 10 small field — one round + partial fill (onX 2.3 / raw 2.29 / buffered 2.55)',
    status: 'estimate', bufferedAcRange: [2.4, 2.7], fillRendered: true,
    // Dense impact sampling (long-hop share ~2%) — the dt hop rule barely
    // moves it (34.9 → 36.4% raw) and it must NEVER flag as a floor.
    sweptPctRange: [30, 42], sweepFloor: false, floorReasons: [],
  },
  {
    hardware: '14c19f3534f0', seqStart: 11498,
    label: 'Aug 23 three fields — segmented; field 1 silent (GPS cold start), 2+3 confirmed',
    multiField: true,
    // Acre ranges are REGRESSION LOCKS, not acceptance — operator ground truth
    // pending. fillRendered:true — the fill is a picture now and always draws.
    // Swept locks are post-dt-rule values; both fields are FULLY CUT per the
    // operator, so both must flag sweepFloor (long-hop shares 21–24% — the
    // sensor outran its sampling) and their percents display as "at least".
    fields: [
      { index: 1, status: 'unexplained' },
      { index: 2, status: 'confirmed', bufferedAcRange: [10.2, 10.7], fillRendered: true, sweptPctRange: [58, 70], sweepFloor: true, floorReasons: ['long_hops', 'path_cover'] },
      { index: 3, status: 'confirmed', bufferedAcRange: [16.0, 16.6], fillRendered: true, sweptPctRange: [70, 80], sweepFloor: true, floorReasons: ['long_hops', 'path_cover'] },
    ],
  },
  {
    hardware: '14c19f3534f0', seqStart: 13150,
    label: 'Aug 23 PM three ADJACENT fields — one spatial cluster, multi-loop split; all confirmed',
    multiField: false,
    // The multi-loop case: adjacent fields share a 150 m cluster, the largest
    // loop explained 12% of the track and silenced everything. Union gate 99%
    // → three fields, each CONFIRMED on its own assigned points. B got two
    // outside rounds before the operator moved on (sweep ~10%); C partial.
    // Operator ground truth (Aug 25): A TOTALLY FINISHED (hop stats identical
    // to Aug 10 — only the path-cover detector sees it: ratio 1.24, sweep
    // 74%); B two rounds, rest uncut; C two rounds + dike passes. A must
    // flag as a floor by path_cover alone; B and C must stay "about".
    fields: [
      { index: 1, status: 'confirmed', bufferedAcRange: [11.5, 12.0], fillRendered: true, sweptPctRange: [68, 80], sweepFloor: true, floorReasons: ['path_cover'] },
      { index: 2, status: 'confirmed', bufferedAcRange: [20.5, 21.1], fillRendered: true, sweptPctRange: [6, 16], sweepFloor: false, floorReasons: [] },
      { index: 3, status: 'confirmed', bufferedAcRange: [18.0, 18.5], fillRendered: true, sweptPctRange: [15, 28], sweepFloor: false, floorReasons: [] },
    ],
  },
  {
    hardware: '14c19f3534f0', seqStart: 14817,
    label: 'Aug 25 final day — adjacent fields + unmapped residue; no collective punishment',
    multiField: false,
    // The doctrine day: the cluster-union share (76%) used to silence all of
    // this. Now three fields confirm on their own points, a 1.2-ac loop
    // estimates, and 33% residue (morning patches + a lap-less piece next to
    // field 3) is a reported fact. Acre ranges are locks, not ground truth.
    residueRange: [0.25, 0.42],
    fields: [
      { index: 1, status: 'confirmed', bufferedAcRange: [9.7, 10.3], fillRendered: true, sweepFloor: true, proposesCut: true },
      { index: 2, status: 'estimate', estimateReasons: ['explain'], bufferedAcRange: [1.1, 1.6], fillRendered: true },
      { index: 3, status: 'confirmed', bufferedAcRange: [13.5, 14.2], fillRendered: true, sweepFloor: true, proposesCut: true },
      { index: 4, status: 'confirmed', bufferedAcRange: [28.0, 28.8], fillRendered: true, sweepFloor: true, proposesCut: true },
    ],
  },
  {
    hardware: SYNTH_HARDWARE, seqStart: 900001,
    label: 'SYNTH round-and-round — outermost lap is the boundary, inner laps are fill, field completes',
    status: 'confirmed', bufferedAcRange: [7.2, 7.9], fillRendered: true, sweptPctRange: [60, 100], proposesCut: true,
  },
  {
    hardware: SYNTH_HARDWARE, seqStart: 900002,
    label: 'SYNTH open outside round + half fill (breakdown) — snapped shut, ESTIMATE [snapped], paints, no proposal',
    status: 'estimate', estimateReasons: ['snapped'], bufferedAcRange: [7.2, 7.9], fillRendered: true, sweptPctRange: [35, 70], proposesCut: false,
  },
]

// ─── Synthetic known-ground — patterns the season's data doesn't hold pure ────
// Deterministic (seeded LCG noise, no Date.now()): a 200×150 m field on flat
// ground at the ranch's latitude, 4.9 m rows, ~2 m/s at a 3 s cadence,
// 1.2 m GPS scatter. Round-and-round: the outermost lap must be the boundary
// and every inner lap fill; open outside round: closed at its nearest return
// and graded ESTIMATE [snapped]. These run through the SAME functions the
// pages call and are asserted like every real day.
function synthTrack(kind: 'spiral' | 'open_round_fill', seqStart: number): TrackPoint[] {
  const lat0 = 46.94
  const lng0 = -106.5
  const mPerLat = 111_132
  const mPerLng = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  let seed = 12345
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5 }
  const W = 200, H = 150, ROW = 4.9, STEP = 6, T0 = 1_787_500_000
  const path: [number, number][] = []
  const walk = (a: [number, number], b: [number, number]) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n = Math.max(1, Math.round(d / STEP))
    for (let k = 1; k <= n; k++) path.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  if (kind === 'spiral') {
    path.push([0, 0])
    for (let lap = 0; lap * ROW * 2 < Math.min(W, H) - ROW; lap++) {
      const i = lap * ROW
      const c: [number, number][] = [[i, i], [W - i, i], [W - i, H - i], [i, H - i], [i, H - i - ROW + 0.01]]
      // corners of this lap, then step in to start the next
      walk(path[path.length - 1], c[0]); walk(c[0], c[1]); walk(c[1], c[2]); walk(c[2], c[3]); walk(c[3], [i + ROW, i + ROW])
    }
  } else {
    // One outside round left OPEN by 18 m (turned in early), then lands
    // fill from the FAR side, stopping half way (breakdown) — nothing ever
    // comes back within a header of the start corner, so the round can only
    // close by snapping.
    path.push([0, 0])
    walk([0, 0], [W, 0]); walk([W, 0], [W, H]); walk([W, H], [0, H]); walk([0, H], [0, 18])
    walk([0, 18], [W - ROW, H - ROW])
    let x = W - ROW
    let dir = -1
    while (x > W / 2) {
      const y0 = dir > 0 ? ROW : H - ROW
      const y1 = dir > 0 ? H - ROW : ROW
      walk(path[path.length - 1], [x, y0]); walk([x, y0], [x, y1])
      x -= ROW; dir = -dir
    }
  }
  return path.map(([x, y], k) => ({
    seq: seqStart + k, t: T0 + k * 3,
    lat: lat0 + (y + rnd() * 2.4) / mPerLat, lng: lng0 + (x + rnd() * 2.4) / mPerLng,
    mg: null, w: null, link: k === 0 ? 'gap' : 'solid',
  }))
}
const SYNTHETIC_JOBS = [
  { hardware_id: SYNTH_HARDWARE, seq_start: 900001, label: 'SYNTH round-and-round spiral to center', kind: 'spiral' as const },
  { hardware_id: SYNTH_HARDWARE, seq_start: 900002, label: 'SYNTH open outside round (18 m gap) + lands fill', kind: 'open_round_fill' as const },
]

const hwFlag = process.argv.indexOf('--hardware')
const ONLY_HARDWARE = hwFlag > -1 ? process.argv[hwFlag + 1] : null

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local)')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

const denver = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

const ac = (m2: number | null | undefined) => (m2 == null ? '—' : (m2 / ACRE_M2).toFixed(2))

async function run() {
  let q = db
    .from('jobs')
    .select('id, hardware_id, started_at, ended_at, seq_start, seq_end, event_count, coverage, multi_field, stats, track')
    .order('seq_start', { ascending: true })
  if (ONLY_HARDWARE) q = q.eq('hardware_id', ONLY_HARDWARE)
  const { data: jobs, error } = await q
  if (error) throw error

  const failures: string[] = []

  // The completion chain, exactly as the page computes it for an inactive
  // field: confirmed + (≥90% swept or a floor) → "mark it cut?" proposes.
  const proposes = (f: FieldSegment, sw: ReturnType<typeof computeSweep> | null | undefined) =>
    f.boundary.status === 'confirmed' && sw != null && (sw.percentCut >= 90 || sw.sweepIsFloor)

  // EVERY-SITUATION MATRIX — one line per field, four columns, the way the
  // page speaks. No cell is ever bare: a field is drawn, or it carries a
  // specific honest line. Printed for every job, asserted via the locks.
  const matrix: string[] = []
  const matrixRow = (job: string, f: FieldSegment, sw: ReturnType<typeof computeSweep> | null | undefined, hasFill: boolean) => {
    const b = f.boundary
    const state = boundaryQualified(b.status)
      ? `${b.status.toUpperCase()}${b.estimateReasons.length ? ` [${b.estimateReasons.join('+')}]` : ''}`
      : b.status === 'unexplained' ? 'no field — headland loops only (line)'
        : b.status === 'no_loop' ? 'no field — never tied off (line)'
          : b.status === 'too_few_points' ? 'no field — too few points (line)'
            : b.status
    const numbers = sw == null ? '—' : `${sw.sweepIsFloor ? 'at least' : 'about'} ${sw.percentCut}%`
    const fill = sw == null ? '—' : hasFill ? 'painted' : 'NONE ✗'
    const cut = sw == null ? '—' : proposes(f, sw) ? 'proposes' : 'no'
    matrix.push(`${job.padEnd(26)} f${f.index}  ${state.padEnd(44)} ${numbers.padEnd(14)} ${fill.padEnd(9)} ${cut}`)
    if (f.residueShare > 0.05) matrix[matrix.length - 1] += `  · residue ${(f.residueShare * 100).toFixed(0)}% (line)`
  }

  // One field's full block — grade, loop, checks, sweep, render tripwires.
  // `tag` prefixes multi-field output ("field 2 "); single-field jobs pass ''.
  const reportField = (
    j: { seq_start: number },
    inProgress: boolean,
    f: FieldSegment,
    tag: string,
  ) => {
    const b: BoundaryResult = f.boundary
    const track = f.track
    console.log(
      `  ${tag}grade: ${b.status.toUpperCase()}${tag ? ` (${track.length} pts)` : ''}` +
        (b.estimateReasons.length ? ` [${b.estimateReasons.join('+')}]` : '') +
        (b.snapped ? ` · SNAPPED closure ${b.closureDistM!.toFixed(1)} m` : '') +
        (b.outsideRatio != null ? ` · headland ratio ${b.outsideRatio.toFixed(2)} (max ${BOUNDARY_CONFIG.headlandOutsideRatioMax})` : '')
    )
    if (b.rawAreaM2 != null) {
      console.log(
        `    ${tag}loop  raw ${ac(b.rawAreaM2)} ac · buffered ${ac(b.areaM2)} ac (raw recorded, never displayed)` +
          ` · perim ${b.perimeterM!.toFixed(0)} m · tie ${b.closureDistM!.toFixed(1)} m` +
          ` · seq ${b.loopSeqStart}→${b.loopSeqEnd}`
      )
      console.log(
        `    ${tag}checks  explains ${(b.explainShare! * 100).toFixed(0)}% of track (gate)` +
          ` · second-pass ${(b.secondPassShare! * 100).toFixed(0)}% (grade)`
      )
      console.log(
        b.loopSpacingM != null
          ? `    ${tag}spacing  ${b.loopSpacingM.toFixed(1)} m loop-to-loop — effective cut width (header is 4.9)`
          : `    ${tag}spacing  — (no second concentric lap; one round or fill-only corroboration)`
      )
      // Standing tripwire: a simple polygon can never out-measure its own
      // convex hull. If a winner does, the simple-loop filter has a hole and
      // an inflated serpentine is posing as a boundary.
      const loopHull = b.polygon != null ? convexHullAreaM2(b.polygon) : null
      if (loopHull != null && b.rawAreaM2 > loopHull * 1.02) {
        failures.push(
          `seq ${j.seq_start}${tag ? ` ${tag.trim()}` : ''}: loop raw ${ac(b.rawAreaM2)} ac EXCEEDS its own hull ${ac(loopHull)} ac — self-intersecting winner`
        )
      }
    }
    console.log(`    ${tag}hull  ${ac(convexHullAreaM2(track))} ac (sanity — swallows concavities and roads)`)

    if (!boundaryQualified(b.status)) return null

    const sweep = computeSweep(track, b)
    if (sweep == null) return null
    console.log(
      `    ${tag}field ${ac(sweep.boundaryInsideM2)} ac (buffered raster) · cut ${ac(sweep.sweptInsideM2)} ac` +
        ` · ${sweep.percentCut}% (raw ${(sweep.rawFraction * 100).toFixed(1)}%)`
    )
    console.log(
      `    ${tag}floor  ${sweep.sweepIsFloor ? `YES [${sweep.floorReasons.join('+')}] — sweep is a lower bound, displays say "at least"` : 'no — displays say "about"'}` +
        ` · long-hop share ${(sweep.longHopShare * 100).toFixed(1)}% (fires >${(SWEEP_CONFIG.floorShareThreshold * 100).toFixed(0)}%)` +
        ` · path-cover ${sweep.pathCoverRatio.toFixed(2)} (fires ≥${SWEEP_CONFIG.pathCoverMinRatio} with sweep <${SWEEP_CONFIG.pathCoverSweepBelow})`
    )
    if (!inProgress) {
      // The free self-check: a finished, fully cut field should close this.
      const gapM2 = sweep.boundaryInsideM2 - sweep.sweptInsideM2
      console.log(
        `    ${tag}completion gap  ${ac(gapM2)} ac unswept (${(100 - sweep.rawFraction * 100).toFixed(1)}%)` +
          ` — should approach zero on a field cut to the fence`
      )
    }
    const lastMs = track[track.length - 1].t * 1000 + 1000
    const eta = computeEta(track, b, lastMs)
    console.log(`    ${tag}eta   ${eta.minutes != null ? `~${eta.minutes} min left` : 'hidden'} (as-if-live)`)

    // The picture: the boundary is held against its raster (the line IS the
    // field-size number's edge); the fill is impressionistic by doctrine —
    // reported against the measured sweep for the record, guarded only by
    // containment (paint must never escape the field).
    const render = computeSweepRender(track, b)
    if (render != null) {
      console.log(
        `    ${tag}render  boundary ${(render.boundaryDivergence * 100).toFixed(1)}% off raster` +
          ` (${ac(render.boundaryRenderedM2)} vs ${ac(render.boundaryRasterM2)} ac) · cap ${(RENDER_CONFIG.divergenceCap * 100).toFixed(0)}%` +
          ` · fill drawn ${ac(render.fillRenderedM2)} ac over measured ${ac(render.fillRasterM2)} ac (picture, not number)` +
          ` · ${render.fill.length} polygon${render.fill.length === 1 ? '' : 's'}` +
          ` · escape ${(render.fillEscapeShare * 100).toFixed(2)}% · ${render.holesSuppressed} false hole${render.holesSuppressed === 1 ? '' : 's'} filled`
      )
      const where = `seq ${j.seq_start}${tag ? ` ${tag.trim()}` : ''}`
      if (render.boundaryDivergence > RENDER_CONFIG.divergenceCap) {
        failures.push(`${where}: rendered boundary ${(render.boundaryDivergence * 100).toFixed(1)}% off its raster (cap ${RENDER_CONFIG.divergenceCap * 100}%)`)
      }
      if (render.fillEscapeShare > 0.01) {
        failures.push(`${where}: fill escapes the boundary (${(render.fillEscapeShare * 100).toFixed(1)}% of vertices outside) — geometric nonsense`)
      }
      if (render.fill.length === 0 && sweep.sweptInsideM2 > 0) {
        failures.push(`${where}: qualified field with swept ground drew NO fill — a confirmed boundary always paints`)
      }
    }
    return { render, sweep }
  }

  const synthetic = ONLY_HARDWARE && ONLY_HARDWARE !== SYNTH_HARDWARE ? [] : SYNTHETIC_JOBS.map(sj => {
    const track = synthTrack(sj.kind, sj.seq_start)
    return {
      id: sj.label, hardware_id: sj.hardware_id, started_at: new Date(track[0].t * 1000).toISOString(),
      ended_at: new Date(track[track.length - 1].t * 1000).toISOString(), seq_start: sj.seq_start,
      seq_end: track[track.length - 1].seq, event_count: track.length, coverage: 1, multi_field: false, stats: null, track,
    }
  })

  for (const j of [...(jobs ?? []), ...synthetic]) {
    const track = (j.track ?? []) as TrackPoint[]
    const leadingNoFix = (j.stats as { leadingNoFixCount?: number } | null)?.leadingNoFixCount ?? null
    console.log(
      `\n${j.hardware_id} seq ${j.seq_start}–${j.seq_end} · ${denver(j.started_at)} → ${denver(j.ended_at)} MT` +
        ` · ${j.event_count} events · data received ${(j.coverage * 100).toFixed(0)}%` +
        (j.multi_field ? ' · MULTI-FIELD' : '') +
        (leadingNoFix != null && leadingNoFix > 0 ? ` · ${leadingNoFix} no-fix events before first timed` : '')
    )
    if (track.length < 2) {
      console.log('  (no track)')
      continue
    }

    const fields = computeFieldBoundaries(track, j.multi_field)
    const segmented = fields.length >= 2
    const inProgress = isInProgress(j)
    const results = new Map<number, { render: ReturnType<typeof computeSweepRender>; sweep: NonNullable<ReturnType<typeof computeSweep>> } | null>()
    const residue = fields.reduce((m, f) => Math.max(m, f.residueShare), 0)
    if (residue > 0) console.log(`  residue ${(residue * 100).toFixed(0)}% of track farther than ${BOUNDARY_CONFIG.residueBandM} m from every field — reported, never a kill switch`)
    if (segmented) {
      console.log(`  ${fields.length} fields — full pipeline per field:`)
      for (const f of fields) results.set(f.index, reportField(j, inProgress, f, `field ${f.index} `))
    } else {
      results.set(1, reportField(j, inProgress, fields[0], ''))
    }
    const jobLabel = j.hardware_id === SYNTH_HARDWARE ? String(j.id) : denver(j.started_at)
    for (const f of fields) {
      const r = results.get(f.index)
      matrixRow(jobLabel.slice(0, 26), f, r?.sweep, (r?.render?.fill.length ?? 0) > 0)
    }

    // Regression assertions
    const exp = REGRESSION.find(r => r.hardware === j.hardware_id && r.seqStart === j.seq_start)
    if (exp) {
      if (exp.multiField != null && j.multi_field !== exp.multiField) {
        failures.push(`${exp.label}: expected multi_field=${exp.multiField}, got ${j.multi_field}`)
      }
      if (exp.status != null) {
        const b = fields[0].boundary
        if (fields.length !== 1) {
          failures.push(`${exp.label}: expected a single field, got ${fields.length}`)
        } else if (b.status !== exp.status) {
          failures.push(`${exp.label}: expected ${exp.status.toUpperCase()}, got ${b.status.toUpperCase()}`)
        } else if (exp.bufferedAcRange && boundaryQualified(b.status)) {
          const acres = b.areaM2! / ACRE_M2
          if (acres < exp.bufferedAcRange[0] || acres > exp.bufferedAcRange[1]) {
            failures.push(`${exp.label}: buffered ${acres.toFixed(2)} ac outside [${exp.bufferedAcRange.join(', ')}]`)
          }
        }
        if (exp.fillRendered != null && ((results.get(1)?.render?.fill.length ?? 0) > 0) !== exp.fillRendered) {
          failures.push(`${exp.label}: expected fill ${exp.fillRendered ? 'drawn' : 'absent'}, got the opposite`)
        }
        const s1 = results.get(1)?.sweep
        if (exp.sweptPctRange) {
          const pct = s1 != null ? s1.rawFraction * 100 : null
          if (pct == null || pct < exp.sweptPctRange[0] || pct > exp.sweptPctRange[1]) {
            failures.push(`${exp.label}: swept ${pct?.toFixed(1) ?? '—'}% outside [${exp.sweptPctRange.join(', ')}]`)
          }
        }
        if (exp.sweepFloor != null && (s1?.sweepIsFloor ?? false) !== exp.sweepFloor) {
          failures.push(`${exp.label}: expected sweepFloor=${exp.sweepFloor}, got ${s1?.sweepIsFloor ?? 'no sweep'}`)
        }
        if (exp.floorReasons && (s1?.floorReasons ?? []).join('+') !== exp.floorReasons.join('+')) {
          failures.push(`${exp.label}: expected floor reasons [${exp.floorReasons.join('+')}], got [${(s1?.floorReasons ?? []).join('+')}]`)
        }
        if (exp.estimateReasons && b.estimateReasons.join('+') !== exp.estimateReasons.join('+')) {
          failures.push(`${exp.label}: expected estimate reasons [${exp.estimateReasons.join('+')}], got [${b.estimateReasons.join('+')}]`)
        }
        if (exp.proposesCut != null && proposes(fields[0], s1) !== exp.proposesCut) {
          failures.push(`${exp.label}: expected completion proposal=${exp.proposesCut}, got ${proposes(fields[0], s1)}`)
        }
      }
      if (exp.residueRange) {
        const r = fields.reduce((m, f) => Math.max(m, f.residueShare), 0)
        if (r < exp.residueRange[0] || r > exp.residueRange[1]) {
          failures.push(`${exp.label}: residue ${(r * 100).toFixed(0)}% outside [${exp.residueRange.map(x => x * 100).join(', ')}]%`)
        }
      }
      if (exp.allFieldsSilent) {
        for (const f of fields) {
          if (boundaryQualified(f.boundary.status)) {
            failures.push(`${exp.label}: field ${f.index} shows numbers (${f.boundary.status.toUpperCase()}) — must be silent`)
          }
        }
      }
      if (exp.fields) {
        if (fields.length !== exp.fields.length) {
          failures.push(`${exp.label}: expected ${exp.fields.length} fields, got ${fields.length}`)
        } else {
          for (const fe of exp.fields) {
            const f = fields.find(x => x.index === fe.index)!
            if (f.boundary.status !== fe.status) {
              failures.push(`${exp.label}: field ${fe.index} expected ${fe.status.toUpperCase()}, got ${f.boundary.status.toUpperCase()}`)
            } else if (fe.bufferedAcRange && boundaryQualified(f.boundary.status)) {
              const acres = f.boundary.areaM2! / ACRE_M2
              if (acres < fe.bufferedAcRange[0] || acres > fe.bufferedAcRange[1]) {
                failures.push(`${exp.label}: field ${fe.index} buffered ${acres.toFixed(2)} ac outside [${fe.bufferedAcRange.join(', ')}]`)
              }
            }
            if (fe.fillRendered != null && ((results.get(fe.index)?.render?.fill.length ?? 0) > 0) !== fe.fillRendered) {
              failures.push(`${exp.label}: field ${fe.index} expected fill ${fe.fillRendered ? 'drawn' : 'absent'}, got the opposite`)
            }
            const fs = results.get(fe.index)?.sweep
            if (fe.sweptPctRange) {
              const pct = fs != null ? fs.rawFraction * 100 : null
              if (pct == null || pct < fe.sweptPctRange[0] || pct > fe.sweptPctRange[1]) {
                failures.push(`${exp.label}: field ${fe.index} swept ${pct?.toFixed(1) ?? '—'}% outside [${fe.sweptPctRange.join(', ')}]`)
              }
            }
            if (fe.sweepFloor != null && (fs?.sweepIsFloor ?? false) !== fe.sweepFloor) {
              failures.push(`${exp.label}: field ${fe.index} expected sweepFloor=${fe.sweepFloor}, got ${fs?.sweepIsFloor ?? 'no sweep'}`)
            }
            if (fe.floorReasons && (fs?.floorReasons ?? []).join('+') !== fe.floorReasons.join('+')) {
              failures.push(`${exp.label}: field ${fe.index} expected floor reasons [${fe.floorReasons.join('+')}], got [${(fs?.floorReasons ?? []).join('+')}]`)
            }
            if (fe.estimateReasons && f.boundary.estimateReasons.join('+') !== fe.estimateReasons.join('+')) {
              failures.push(`${exp.label}: field ${fe.index} expected estimate reasons [${fe.estimateReasons.join('+')}], got [${f.boundary.estimateReasons.join('+')}]`)
            }
            if (fe.proposesCut != null && proposes(f, fs) !== fe.proposesCut) {
              failures.push(`${exp.label}: field ${fe.index} expected completion proposal=${fe.proposesCut}, got ${proposes(f, fs)}`)
            }
          }
        }
      }
    }
  }

  console.log('\n────────────────────────────────────────')
  console.log('EVERY-SITUATION MATRIX — boundary · numbers · fill · completion (every cell drawn or a specific line)')
  for (const row of matrix) console.log('  ' + row)
  console.log('────────────────────────────────────────')
  if (failures.length > 0) {
    console.log(`REGRESSION: ${failures.length} FAILURE(S)`)
    for (const f of failures) console.log(`  ✗ ${f}`)
    console.log('(read-only: nothing written)')
    process.exit(1)
  }
  const checked = REGRESSION.filter(r =>
    [...(jobs ?? []), ...synthetic].some(j => j.hardware_id === r.hardware && j.seq_start === r.seqStart)
  ).length
  console.log(`REGRESSION: ${checked}/${REGRESSION.length} known-ground cases present, all pass`)
  console.log('(read-only: nothing written)')
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
