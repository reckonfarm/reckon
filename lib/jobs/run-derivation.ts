// ─── Derivation runner — shared by the CLI (scripts/derive-jobs.ts) and the
// cron route (/api/cron/derive-jobs) ───────────────────────────────────────────
//
// For every non-bench scout device: fetch raw bump events, run the pure
// deriver, DELETE that hardware's jobs wholesale and insert the fresh set.
// Delete-and-rewrite is the doctrine — jobs are a rebuildable artifact.
//
// STABLE IDS FOR LIVE WATCHING: job id is deterministic — a name-based UUID
// from (hardware_id, seq_start). While a session is in progress the cron
// re-derives every few minutes; its seq_start doesn't move, so its id — and
// the /jobs/[id] URL open in the cab — survives every rewrite while end time
// and track keep growing. An id only changes if a boundary shifts (threshold
// retune), which genuinely is a different job record.

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveJobs, DERIVER_VERSION, type DeriveResult } from './derive'
import { isBenchHardware, isExcludedSeq } from './exclusions'
import type { RawEventInput } from './derive'

export interface DeviceSummary {
  hardwareId: string
  name: string
  skipped: 'bench' | null
  rawRows: number
  excluded: number
  unparseable: number
  result: DeriveResult | null
  wrote: number | null // null in dry-run
}

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
  payload: { seq?: unknown; unixTime?: unknown; peak_mg?: unknown; ts_source?: unknown } | null
}

// Name-based UUID (v5-shaped, sha1) over a fixed namespace — same input, same
// id, on every run and every machine.
export function stableJobId(hardwareId: string, seqStart: number): string {
  const digest = createHash('sha1')
    .update(`dryline-jobs:${hardwareId}:${seqStart}`)
    .digest()
  const b = Buffer.from(digest.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50 // version 5
  b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const PAGE = 1000

// Exported for the detection runner (lib/detections/run-detection.ts), which
// reads the same raw stream a second time — deliberately NOT threaded through
// derivation, so the two layers stay independently re-runnable.
export async function fetchAllEvents(db: SupabaseClient, deviceId: string): Promise<EventRow[]> {
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

export function toInput(
  rows: EventRow[],
  hardwareId: string
): { events: RawEventInput[]; excluded: number; unparseable: number } {
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

export async function runDerivation(
  db: SupabaseClient,
  opts: { write: boolean; onlyHardware?: string | null } = { write: true }
): Promise<{ devices: DeviceSummary[]; deriverVersion: string }> {
  let q = db.from('devices').select('id, user_id, ranch_id, hardware_id, name').eq('type', 'scout')
  if (opts.onlyHardware) q = q.eq('hardware_id', opts.onlyHardware)
  const { data: devices, error } = await q
  if (error) throw new Error(`devices fetch failed: ${error.message}`)

  const summaries: DeviceSummary[] = []
  for (const d of (devices ?? []) as DeviceRow[]) {
    if (isBenchHardware(d.hardware_id)) {
      summaries.push({
        hardwareId: d.hardware_id, name: d.name, skipped: 'bench',
        rawRows: 0, excluded: 0, unparseable: 0, result: null, wrote: null,
      })
      continue
    }
    const rows = await fetchAllEvents(db, d.id)
    const { events, excluded, unparseable } = toInput(rows, d.hardware_id)
    const result = deriveJobs(events)

    let wrote: number | null = null
    if (opts.write) {
      const del = await db.from('jobs').delete().eq('hardware_id', d.hardware_id)
      if (del.error) throw new Error(`jobs delete failed: ${del.error.message}`)
      if (result.jobs.length > 0) {
        const ins = await db.from('jobs').insert(
          result.jobs.map(j => ({
            id: stableJobId(d.hardware_id, j.seqStart),
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
      wrote = result.jobs.length
    }

    summaries.push({
      hardwareId: d.hardware_id, name: d.name, skipped: null,
      rawRows: rows.length, excluded, unparseable, result, wrote,
    })
  }

  return { devices: summaries, deriverVersion: DERIVER_VERSION }
}
