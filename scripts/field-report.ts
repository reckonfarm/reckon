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
  type BoundaryResult,
  type BoundaryStatus,
  type FieldSegment,
} from '../lib/jobs/boundary'
import { computeSweep, computeSweepRender, SWEEP_CONFIG, type FloorReason } from '../lib/jobs/sweep'
import { RENDER_CONFIG } from '../lib/jobs/render-geometry'
import { computeEta } from '../lib/jobs/eta'
import { isInProgress } from '../lib/jobs/display'
import type { TrackPoint } from '../lib/jobs/derive'

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
  allFieldsSilent?: boolean // multi-field: no segment may show numbers
  fields?: FieldExpectation[]
}[] = [
  { hardware: '14c19f3534f0', seqStart: 111, label: 'Aug 5 mosaic — meander must stay silenced', status: 'unexplained' },
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
    console.log(`  ${tag}grade: ${b.status.toUpperCase()}${tag ? ` (${track.length} pts)` : ''}`)
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

  for (const j of jobs ?? []) {
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
    if (fields.some(f => f.clusterUnexplained)) {
      console.log('  CLUSTER UNEXPLAINED — more than one distinct loop, union fails the explain gate → one honest silent segment')
    }
    if (segmented) {
      console.log(`  ${fields.length} fields — full pipeline per field:`)
      for (const f of fields) results.set(f.index, reportField(j, inProgress, f, `field ${f.index} `))
    } else {
      results.set(1, reportField(j, inProgress, fields[0], ''))
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
          }
        }
      }
    }
  }

  console.log('\n────────────────────────────────────────')
  if (failures.length > 0) {
    console.log(`REGRESSION: ${failures.length} FAILURE(S)`)
    for (const f of failures) console.log(`  ✗ ${f}`)
    console.log('(read-only: nothing written)')
    process.exit(1)
  }
  const checked = REGRESSION.filter(r =>
    (jobs ?? []).some(j => j.hardware_id === r.hardware && j.seq_start === r.seqStart)
  ).length
  console.log(`REGRESSION: ${checked}/${REGRESSION.length} known-ground cases present, all pass`)
  console.log('(read-only: nothing written)')
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
