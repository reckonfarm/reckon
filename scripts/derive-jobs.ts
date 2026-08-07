// ─── Job derivation runner — the "one command" ─────────────────────────────────
//
//   Re-derive everything:   npx tsx scripts/derive-jobs.ts
//   Preview, no writes:     npx tsx scripts/derive-jobs.ts --dry-run
//   One device only:        npx tsx scripts/derive-jobs.ts --hardware 14c19f3534f0
//
// (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local;
//  the jobs table is migration 036)
//
// For every scout device (bench-prefixed hardware skipped per the convention in
// lib/jobs/exclusions.ts): fetch its raw bump events, run the pure deriver
// (lib/jobs/derive.ts), then DELETE that hardware's jobs wholesale and insert
// the fresh set. Delete-and-rewrite is the doctrine — jobs are a rebuildable
// artifact stamped with deriver_version, never precious rows. Runs off the
// Vercel request path with the service-role client, like every other seeder.

import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

import { createClient } from '@supabase/supabase-js'
import { deriveJobs, DERIVER_VERSION, type RawEventInput, type DerivedJob } from '../lib/jobs/derive'
import { isBenchHardware, isExcludedSeq } from '../lib/jobs/exclusions'

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

interface DeviceRow {
  id: string
  user_id: string
  ranch_id: string | null
  hardware_id: string
  name: string
}

interface EventRow {
  id: string
  lat: number | null
  lng: number | null
  width: number | null
  payload: {
    seq?: unknown
    unixTime?: unknown
    peak_mg?: unknown
    ts_source?: unknown
  } | null
}

const PAGE = 1000

async function fetchAllEvents(deviceId: string): Promise<EventRow[]> {
  const rows: EventRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('events')
      .select('id, lat, lng, width, payload')
      .eq('device_id', deviceId)
      .eq('type', 'bump')
      .order('ingested_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`events fetch failed: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

function toInput(rows: EventRow[], hardwareId: string): { events: RawEventInput[]; excluded: number; unparseable: number } {
  const events: RawEventInput[] = []
  let excluded = 0
  let unparseable = 0
  for (const r of rows) {
    const p = r.payload ?? {}
    const seq = typeof p.seq === 'number' && Number.isInteger(p.seq) && p.seq >= 0 ? p.seq : null
    if (seq === null) {
      unparseable++
      continue
    }
    if (isExcludedSeq(hardwareId, seq)) {
      excluded++
      continue
    }
    events.push({
      id: r.id,
      seq,
      unixTime: typeof p.unixTime === 'number' && Number.isFinite(p.unixTime) ? p.unixTime : 0,
      serverTs: p.ts_source === 'server',
      lat: r.lat,
      lng: r.lng,
      peakMg: typeof p.peak_mg === 'number' && Number.isFinite(p.peak_mg) ? p.peak_mg : null,
      width: r.width,
    })
  }
  return { events, excluded, unparseable }
}

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
      (j.multiField ? '  [MULTI-FIELD]' : '')
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
  let q = db.from('devices').select('id, user_id, ranch_id, hardware_id, name').eq('type', 'scout')
  if (ONLY_HARDWARE) q = q.eq('hardware_id', ONLY_HARDWARE)
  const { data: devices, error } = await q
  if (error) throw new Error(`devices fetch failed: ${error.message}`)

  for (const d of (devices ?? []) as DeviceRow[]) {
    if (isBenchHardware(d.hardware_id)) {
      console.log(`\n${d.name} (${d.hardware_id}) — bench hardware, skipped by convention`)
      continue
    }
    console.log(`\n${d.name} (${d.hardware_id})`)
    const rows = await fetchAllEvents(d.id)
    const { events, excluded, unparseable } = toInput(rows, d.hardware_id)
    const result = deriveJobs(events)
    console.log(
      `  ${rows.length} raw rows → ${events.length} in scope` +
        ` (${excluded} bench-excluded, ${unparseable} unparseable)` +
        ` · ${result.timedCount} device-timed, ${result.untimedCount} untimed` +
        ` · cadence ${result.cadenceS}s · ${result.jobs.length} job(s)` +
        (result.duplicateSeqsDropped ? ` · ${result.duplicateSeqsDropped} duplicate seqs dropped` : '')
    )
    if (result.orphanUntimedSeqs.length > 0) {
      console.log(
        `  ${result.orphanUntimedSeqs.length} untimed events outside every job span ` +
          `(no GPS clock, no position — unplaceable): seqs ${result.orphanUntimedSeqs[0]}–${result.orphanUntimedSeqs[result.orphanUntimedSeqs.length - 1]}`
      )
    }
    result.jobs.forEach(printJob)

    if (DRY_RUN) {
      console.log('  (dry-run: nothing written)')
      continue
    }

    const del = await db.from('jobs').delete().eq('hardware_id', d.hardware_id)
    if (del.error) throw new Error(`jobs delete failed: ${del.error.message}`)
    if (result.jobs.length > 0) {
      const ins = await db.from('jobs').insert(
        result.jobs.map(j => ({
          user_id: d.user_id,
          ranch_id: d.ranch_id,
          device_id: d.id,
          hardware_id: d.hardware_id,
          started_at: j.startedAt,
          ended_at: j.endedAt,
          duration_s: j.durationS,
          seq_start: j.seqStart,
          seq_end: j.seqEnd,
          event_count: j.eventCount,
          evicted_count: j.evictedCount,
          coverage: j.coverage,
          centroid_lat: j.centroidLat,
          centroid_lng: j.centroidLng,
          bbox: j.bbox,
          track: j.track,
          pauses: j.pauses,
          multi_field: j.multiField,
          stats: j.stats,
          deriver_version: DERIVER_VERSION,
        }))
      )
      if (ins.error) throw new Error(`jobs insert failed: ${ins.error.message}`)
    }
    console.log(`  wrote ${result.jobs.length} job(s) as ${DERIVER_VERSION}`)
  }
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
