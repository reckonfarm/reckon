// ─── Bale detection CLI — thin wrapper over lib/detections/run-detection.ts ────
//
//   Re-detect everything:   npx tsx scripts/detect-bales.ts
//   Preview, no writes:     npx tsx scripts/detect-bales.ts --dry-run
//   One device only:        npx tsx scripts/detect-bales.ts --hardware 14c19f3534f0
//
// (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local)
//
// The same runner fires on the derive-jobs cron after each derivation pass;
// this CLI is the hands-on tool for dry-runs and detector development. The
// dry-run matrix IS the acceptance test: Aug 8 baling must read 32, and the
// Aug 5 swather / Aug 7 rake days must read no_signature — a detector that
// finds bales in raking is wrong.

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { createClient } from '@supabase/supabase-js'
import { runDetections } from '../lib/detections/run-detection'

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

async function run() {
  const { devices, detectorVersions } = await runDetections(db, {
    write: !DRY_RUN,
    onlyHardware: ONLY_HARDWARE,
  })

  for (const d of devices) {
    if (d.skipped === 'bench') {
      console.log(`\n${d.name} (${d.hardwareId}) — bench hardware, skipped by convention`)
      continue
    }
    console.log(`\n${d.name} (${d.hardwareId}) — ${d.jobs.length} job(s)`)
    for (const j of d.jobs) {
      const m = j.metrics
      console.log(
        `  ${denver(j.startedAt)} MT  seq ${j.seqStart}–${j.seqEnd}  [${j.detector}] ${j.outcome}` +
          (j.outcome === 'detected' ? `  → ${j.detectionCount} detection(s)` : '')
      )
      console.log(
        `      n=${m.eventCount}` +
          (m.cut != null ? `  cut=${m.cut} (gap ${m.gapBelowMg}–${m.gapAboveMg})` : '') +
          (m.effectSize != null ? `  d=${m.effectSize}` : '') +
          (m.hiCount != null ? `  hi/lo=${m.hiCount}/${m.loCount}` : '') +
          (m.medianIntervalS != null ? `  medIv=${m.medianIntervalS}s` : '') +
          (m.intervalDispersion != null ? `  disp=${m.intervalDispersion}` : '') +
          (m.refractoryViolationShare != null ? `  refrViol=${m.refractoryViolationShare}` : '') +
          (m.hiWidthMedian != null ? `  hiW=${m.hiWidthMedian}` : '')
      )
      if (m.failedChecks.length > 0) console.log(`      failed: ${m.failedChecks.join('; ')}`)
    }
    console.log(
      DRY_RUN
        ? '  (dry-run: nothing written)'
        : `  wrote ${d.wrote?.runs} run(s), ${d.wrote?.detections} detection(s) as ${Object.values(detectorVersions).join(', ')}`
    )
  }
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
