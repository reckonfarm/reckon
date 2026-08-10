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
// SELF-CHECKING (same doctrine as detect-bales.ts): the known-ground matrix
// below must hold on the scout's real data, and the process exits nonzero
// when it doesn't. This script NEVER writes; there is no wet run — boundaries
// are computed at read time, per job, on purpose.

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { createClient } from '@supabase/supabase-js'
import { computeFieldBoundary, convexHullAreaM2, boundaryQualified, ACRE_M2 } from '../lib/jobs/boundary'
import { computeSweep, computeSweepRender } from '../lib/jobs/sweep'
import { RENDER_CONFIG } from '../lib/jobs/render-geometry'
import { computeEta } from '../lib/jobs/eta'
import { isInProgress } from '../lib/jobs/display'
import type { TrackPoint } from '../lib/jobs/derive'
import type { BoundaryStatus } from '../lib/jobs/boundary'

// ─── Known ground — the regression matrix ──────────────────────────────────────
// Aug 10 is the first REAL-GROUND acreage case: onX reference 2.3 ac, loop raw
// 2.29, buffered 2.55. All three recorded; NO winner picked yet — loop-to-loop
// spacing from future two-round fields settles the buffer question. The
// buffered range below is deliberately loose (±0.15) so re-derivation jitter
// doesn't cry wolf; a real algorithm change will blow well past it.
const REGRESSION: {
  hardware: string
  seqStart: number
  label: string
  status: BoundaryStatus
  bufferedAcRange?: [number, number]
}[] = [
  { hardware: '14c19f3534f0', seqStart: 111, label: 'Aug 5 mosaic — meander must stay silenced', status: 'unexplained' },
  { hardware: '14c19f3534f0', seqStart: 11005, label: 'Aug 7 rake — multi-field', status: 'multi_field' },
  { hardware: '14c19f3534f0', seqStart: 11064, label: 'Aug 8 baling — no perimeter laps', status: 'no_loop' },
  {
    hardware: '14c19f3534f0', seqStart: 11163,
    label: 'Aug 10 small field — one round + partial fill (onX 2.3 / raw 2.29 / buffered 2.55)',
    status: 'estimate', bufferedAcRange: [2.4, 2.7],
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
    .select('id, hardware_id, started_at, ended_at, seq_start, seq_end, event_count, coverage, multi_field, track')
    .order('seq_start', { ascending: true })
  if (ONLY_HARDWARE) q = q.eq('hardware_id', ONLY_HARDWARE)
  const { data: jobs, error } = await q
  if (error) throw error

  const failures: string[] = []

  for (const j of jobs ?? []) {
    const track = (j.track ?? []) as TrackPoint[]
    console.log(
      `\n${j.hardware_id} seq ${j.seq_start}–${j.seq_end} · ${denver(j.started_at)} → ${denver(j.ended_at)} MT` +
        ` · ${j.event_count} events · data received ${(j.coverage * 100).toFixed(0)}%` +
        (j.multi_field ? ' · MULTI-FIELD' : '')
    )
    if (track.length < 2) {
      console.log('  (no track)')
      continue
    }

    const b = computeFieldBoundary(track, j.multi_field)
    const hullM2 = convexHullAreaM2(track)

    console.log(`  grade: ${b.status.toUpperCase()}`)
    if (b.rawAreaM2 != null) {
      console.log(
        `    loop  raw ${ac(b.rawAreaM2)} ac · buffered ${ac(b.areaM2)} ac (raw recorded, never displayed)` +
          ` · perim ${b.perimeterM!.toFixed(0)} m · tie ${b.closureDistM!.toFixed(1)} m` +
          ` · seq ${b.loopSeqStart}→${b.loopSeqEnd}`
      )
      console.log(
        `    checks  explains ${(b.explainShare! * 100).toFixed(0)}% of track (gate)` +
          ` · second-pass ${(b.secondPassShare! * 100).toFixed(0)}% (grade)`
      )
      console.log(
        b.loopSpacingM != null
          ? `    spacing  ${b.loopSpacingM.toFixed(1)} m loop-to-loop — effective cut width (header is 4.9)`
          : '    spacing  — (no second concentric lap; one round or fill-only corroboration)'
      )
    }
    console.log(`    hull  ${ac(hullM2)} ac (sanity — swallows concavities and roads)`)

    const sweep = computeSweep(track, b)
    if (sweep != null) {
      console.log(
        `    field ${ac(sweep.boundaryInsideM2)} ac (buffered raster) · cut ${ac(sweep.sweptInsideM2)} ac` +
          ` · ${sweep.percentCut}% (raw ${(sweep.rawFraction * 100).toFixed(1)}%)`
      )
      if (!isInProgress(j)) {
        // The free self-check: a finished, fully cut field should close this.
        const gapM2 = sweep.boundaryInsideM2 - sweep.sweptInsideM2
        console.log(
          `    completion gap  ${ac(gapM2)} ac unswept (${(100 - sweep.rawFraction * 100).toFixed(1)}%)` +
            ` — should approach zero on a field cut to the fence`
        )
      }
      const lastMs = track[track.length - 1].t * 1000 + 1000
      const eta = computeEta(track, b, lastMs)
      console.log(`    eta   ${eta.minutes != null ? `~${eta.minutes} min left` : 'hidden'} (as-if-live)`)

      // The picture held against the number: rendered polygon areas must sit
      // within RENDER_CONFIG.divergenceCap of their raster sources, or the
      // smoothing is lying and this build fails.
      const render = computeSweepRender(track, b)
      if (render != null) {
        console.log(
          `    render  boundary ${(render.boundaryDivergence * 100).toFixed(1)}% off raster` +
            ` (${ac(render.boundaryRenderedM2)} vs ${ac(render.boundaryRasterM2)} ac)` +
            ` · fill ${(render.fillDivergence * 100).toFixed(1)}% off raster` +
            ` (${ac(render.fillRenderedM2)} vs ${ac(render.fillRasterM2)} ac)` +
            ` · cap ${(RENDER_CONFIG.divergenceCap * 100).toFixed(0)}%`
        )
        if (render.boundaryDivergence > RENDER_CONFIG.divergenceCap) {
          failures.push(`seq ${j.seq_start}: rendered boundary ${(render.boundaryDivergence * 100).toFixed(1)}% off its raster (cap ${RENDER_CONFIG.divergenceCap * 100}%)`)
        }
        if (render.fillDivergence > RENDER_CONFIG.divergenceCap) {
          failures.push(`seq ${j.seq_start}: rendered fill ${(render.fillDivergence * 100).toFixed(1)}% off its raster (cap ${RENDER_CONFIG.divergenceCap * 100}%)`)
        }
      }
    }

    // Regression assertions
    const exp = REGRESSION.find(r => r.hardware === j.hardware_id && r.seqStart === j.seq_start)
    if (exp) {
      if (b.status !== exp.status) {
        failures.push(`${exp.label}: expected ${exp.status.toUpperCase()}, got ${b.status.toUpperCase()}`)
      }
      if (exp.bufferedAcRange && boundaryQualified(b.status)) {
        const acres = b.areaM2! / ACRE_M2
        if (acres < exp.bufferedAcRange[0] || acres > exp.bufferedAcRange[1]) {
          failures.push(
            `${exp.label}: buffered ${acres.toFixed(2)} ac outside [${exp.bufferedAcRange.join(', ')}]`
          )
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
