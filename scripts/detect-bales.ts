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
// dry-run matrix IS the standing acceptance test — every detector change
// re-runs it, and the reference below is checked automatically at the end.

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { createClient } from '@supabase/supabase-js'
import { runDetections } from '../lib/detections/run-detection'

// ─── Regression reference (ground truth of record, hardware 14c19f3534f0) ─────
// Aug 8 baling: the operator counted 32 bales, verified pin-by-pin on the
// ground 2026-08-09. The detector must read 31 — 30 confirmed-correct
// detections plus the recovered quiet slam (seq 11138); the 32nd bale's slam
// under-registered (the 11120→11126 gap) and is unrecoverable from this
// data. A detector that reads 32 here has let a false positive back in, not
// found the missing bale. The negative controls are the failure that
// matters most: a detector that finds bales in raking or swathing is wrong,
// whatever the baling day says.
const REGRESSION_REFERENCE: {
  hardwareId: string
  seqStart: number
  label: string
  outcome: 'detected' | 'no_signature'
  detections?: number
  actualCount?: number
}[] = [
  { hardwareId: '14c19f3534f0', seqStart: 11064, label: 'Aug 8 baling', outcome: 'detected', detections: 31, actualCount: 32 },
  { hardwareId: '14c19f3534f0', seqStart: 111, label: 'Aug 5 swather (negative control)', outcome: 'no_signature' },
  { hardwareId: '14c19f3534f0', seqStart: 11005, label: 'Aug 7 rake (negative control)', outcome: 'no_signature' },
]

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
          (m.hiWidthMedian != null ? `  hiW=${m.hiWidthMedian}` : '') +
          (m.gatedMoving != null && m.gatedMoving > 0 ? `  gatedMoving=${m.gatedMoving}` : '')
      )
      if (m.failedChecks.length > 0) console.log(`      failed: ${m.failedChecks.join('; ')}`)
    }
    console.log(
      DRY_RUN
        ? '  (dry-run: nothing written)'
        : `  wrote ${d.wrote?.runs} run(s), ${d.wrote?.detections} detection(s) as ${Object.values(detectorVersions).join(', ')}`
    )
  }

  // ── Check the matrix against the reference of record ──
  console.log('\nRegression vs ground truth:')
  let regressed = false
  for (const ref of REGRESSION_REFERENCE) {
    const dev = devices.find(x => x.hardwareId === ref.hardwareId)
    const job = dev?.jobs.find(j => j.seqStart === ref.seqStart)
    if (!job) {
      console.log(`  ? ${ref.label}: no job starting at seq ${ref.seqStart} — boundary shifted, re-verify by hand`)
      regressed = true
      continue
    }
    const ok = job.outcome === ref.outcome && (ref.detections == null || job.detectionCount === ref.detections)
    if (ok) {
      console.log(
        `  ✓ ${ref.label}: ${job.outcome}` +
          (ref.detections != null ? ` ${job.detectionCount}` : '') +
          (ref.actualCount != null ? ` (operator counted ${ref.actualCount}; one slam under-registered — expected)` : '')
      )
    } else {
      console.log(
        `  ✗ REGRESSION ${ref.label}: expected ${ref.outcome}${ref.detections != null ? ` ${ref.detections}` : ''}, got ${job.outcome} ${job.detectionCount}`
      )
      regressed = true
    }
  }
  if (regressed) process.exitCode = 1
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
