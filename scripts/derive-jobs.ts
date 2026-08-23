// ─── Job derivation CLI — thin wrapper over lib/jobs/run-derivation.ts ─────────
//
//   Re-derive everything:   npx tsx scripts/derive-jobs.ts
//   Preview, no writes:     npx tsx scripts/derive-jobs.ts --dry-run
//   One device only:        npx tsx scripts/derive-jobs.ts --hardware 14c19f3534f0
//
// (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local)
//
// The same runner also fires on a Vercel cron (/api/cron/derive-jobs) so jobs
// stay fresh while a machine is working; this CLI remains the hands-on tool
// for dry-runs, single-device reruns, and deriver development.

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { createClient } from '@supabase/supabase-js'
import { runDerivation } from '../lib/jobs/run-derivation'
import type { DerivedJob } from '../lib/jobs/derive'

const DRY_RUN = process.argv.includes('--dry-run')
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
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

function printJob(j: DerivedJob, i: number) {
  const dur = `${Math.floor(j.durationS / 3600)}h ${Math.round((j.durationS % 3600) / 60)}m`
  console.log(
    `  Job ${i + 1}: ${denver(j.startedAt)} → ${denver(j.endedAt)} MT (${dur})` +
      `  seq ${j.seqStart}–${j.seqEnd}` +
      `  events ${j.eventCount} (${j.timedCount} timed${j.untimedCount ? ` + ${j.untimedCount} untimed` : ''})` +
      `  evicted ${j.evictedCount}` +
      `  coverage ${(j.coverage * 100).toFixed(1)}%` +
      (j.multiField ? '  [MULTI-FIELD]' : '') +
      (j.stats.leadingNoFixCount > 0 ? `  [${j.stats.leadingNoFixCount} no-fix events before first timed]` : '')
  )
  for (const p of j.pauses) {
    const mins = (p.durationS / 60).toFixed(1)
    console.log(
      p.kind === 'observed'
        ? `      pause (seen)     ${denver(p.atIso)} MT · ${mins} min quiet, no events lost`
        : `      pause (inferred)  ${denver(p.atIso)} MT · ~${mins} min stopped inside an eviction block (${p.missing} events lost in the same gap)`
    )
  }
}

async function run() {
  const { devices, deriverVersion } = await runDerivation(db, {
    write: !DRY_RUN,
    onlyHardware: ONLY_HARDWARE,
  })

  for (const d of devices) {
    if (d.skipped === 'bench') {
      console.log(`\n${d.name} (${d.hardwareId}) — bench hardware, skipped by convention`)
      continue
    }
    const r = d.result!
    console.log(`\n${d.name} (${d.hardwareId})`)
    console.log(
      `  ${d.rawRows} raw rows → ${d.rawRows - d.excluded - d.unparseable} in scope` +
        ` (${d.excluded} bench-excluded, ${d.unparseable} unparseable)` +
        ` · ${r.timedCount} device-timed, ${r.untimedCount} untimed` +
        ` · cadence ${r.cadenceS}s · ${r.jobs.length} job(s)` +
        (r.duplicateSeqsDropped ? ` · ${r.duplicateSeqsDropped} duplicate seqs dropped` : '')
    )
    if (r.orphanUntimedSeqs.length > 0) {
      console.log(
        `  ${r.orphanUntimedSeqs.length} untimed events outside every job span ` +
          `(no GPS clock, no position — unplaceable): seqs ${r.orphanUntimedSeqs[0]}–${r.orphanUntimedSeqs[r.orphanUntimedSeqs.length - 1]}`
      )
    }
    r.jobs.forEach(printJob)
    console.log(
      DRY_RUN ? '  (dry-run: nothing written)' : `  wrote ${d.wrote} job(s) as ${deriverVersion}`
    )
  }
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
