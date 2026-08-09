// ─── Field boundary report — READ-ONLY, always ─────────────────────────────────
//
//   Everything:        npx tsx scripts/field-report.ts
//   One device only:   npx tsx scripts/field-report.ts --hardware 14c19f3534f0
//
// (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local)
//
// The acceptance harness for the boundary math: for every derived job it
// prints what computeFieldBoundary() decides and why — status, tied-loop
// acreage raw/buffered, closure distance, second-pass and explain shares, and
// the convex hull as the sanity number the loop is judged against.
//
// This script NEVER writes. There is no --dry-run flag because there is no wet
// run: boundaries are computed at read time, per job, on purpose (nothing
// stored — the number has to be proven before anything is built on top of it).

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { createClient } from '@supabase/supabase-js'
import { computeFieldBoundary, convexHullAreaM2, ACRE_M2 } from '../lib/jobs/boundary'
import { computeSweep } from '../lib/jobs/sweep'
import type { TrackPoint } from '../lib/jobs/derive'

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

const ac = (m2: number | null) => (m2 == null ? '—' : (m2 / ACRE_M2).toFixed(2))

async function run() {
  let q = db
    .from('jobs')
    .select('id, hardware_id, started_at, ended_at, seq_start, seq_end, event_count, coverage, multi_field, track, pauses')
    .order('seq_start', { ascending: true })
  if (ONLY_HARDWARE) q = q.eq('hardware_id', ONLY_HARDWARE)
  const { data: jobs, error } = await q
  if (error) throw error

  for (const j of jobs ?? []) {
    const track = (j.track ?? []) as TrackPoint[]
    console.log(
      `\n${j.hardware_id} seq ${j.seq_start}–${j.seq_end} · ${denver(j.started_at)} → ${denver(j.ended_at)} MT` +
        ` · ${j.event_count} events · coverage ${(j.coverage * 100).toFixed(0)}%` +
        (j.multi_field ? ' · MULTI-FIELD' : '')
    )
    if (track.length < 2) {
      console.log('  (no track)')
      continue
    }

    const b = computeFieldBoundary(track, j.multi_field)
    const hullM2 = convexHullAreaM2(track)

    console.log(`  boundary: ${b.status.toUpperCase()}`)
    if (b.rawAreaM2 != null) {
      console.log(
        `    loop  ${ac(b.rawAreaM2)} ac raw · ${ac(b.areaM2)} ac buffered` +
          ` · perim ${b.perimeterM!.toFixed(0)} m · tie ${b.closureDistM!.toFixed(1)} m` +
          ` · seq ${b.loopSeqStart}→${b.loopSeqEnd}`
      )
      console.log(
        `    guards  second-pass ${(b.secondPassShare! * 100).toFixed(0)}%` +
          ` · explains ${(b.explainShare! * 100).toFixed(0)}% of track`
      )
    }
    console.log(`    hull  ${ac(hullM2)} ac (sanity — swallows concavities and roads)`)

    const sweep = computeSweep(track, b)
    if (sweep != null) {
      console.log(
        `    sweep  ${sweep.percentCut}% cut (raw ${(sweep.rawFraction * 100).toFixed(1)}%)` +
          ` · swept-inside ${ac(sweep.sweptInsideM2)} ac of ${ac(sweep.boundaryInsideM2)} ac`
      )
    }
  }
  console.log('\n(read-only: nothing written)')
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
