// ─── Detection runner — shared by the CLI (scripts/detect-bales.ts) and the
// cron route (/api/cron/derive-jobs, after job derivation) ─────────────────────
//
// For every non-bench scout device: fetch raw bump events, read the freshly
// derived jobs, run each registered detector over each job's events, then
// DELETE that hardware's runs + detections wholesale and insert the fresh
// set. Same doctrine as jobs: detections are a rebuildable artifact.
//
// STABLE IDS: run id = uuid5(hardware, detector, job seq_start); detection
// id = uuid5(hardware, detector, anchor seq). The anchor seq is the device's
// own counter — a detection's identity survives job-boundary churn even when
// the job id it points at does not.
//
// Only the bale detector exists today. Acres cut, cake fed, hours run join
// this registry; the tables and this runner never change shape for them.

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllEvents, toInput } from '../jobs/run-derivation'
import { isBenchHardware } from '../jobs/exclusions'
import type { RawEventInput } from '../jobs/derive'
import { DERIVE_CONFIG } from '../jobs/derive'
import {
  detectBales,
  BALE_DETECTOR,
  BALE_DETECTOR_VERSION,
  BALE_CONFIG,
  type BaleEventInput,
  type BaleRunResult,
} from './detect-bales'

export interface DetectionRunSummary {
  hardwareId: string
  name: string
  skipped: 'bench' | null
  jobs: {
    jobId: string
    seqStart: number
    seqEnd: number
    startedAt: string
    detector: string
    outcome: BaleRunResult['outcome']
    detectionCount: number
    metrics: BaleRunResult['metrics']
  }[]
  wrote: { runs: number; detections: number } | null // null in dry-run
}

interface DeviceRow {
  id: string
  user_id: string
  ranch_id: string | null
  hardware_id: string
  name: string
}

interface JobRow {
  id: string
  user_id: string
  ranch_id: string | null
  seq_start: number
  seq_end: number
  started_at: string
  coverage: number
}

function stableId(kind: string, hardwareId: string, detector: string, seq: number): string {
  const digest = createHash('sha1')
    .update(`dryline-${kind}:${hardwareId}:${detector}:${seq}`)
    .digest()
  const b = Buffer.from(digest.subarray(0, 16))
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = b.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Credibly-timed, amplitude-carrying events only: the detector reasons about
// intervals and modes, and an event without either can't vote.
function toBaleInput(events: RawEventInput[]): BaleEventInput[] {
  return events
    .filter(e => !e.serverTs && e.unixTime >= DERIVE_CONFIG.minCredibleUnixTime && e.peakMg != null)
    .map(e => ({
      id: e.id,
      seq: e.seq,
      t: e.unixTime,
      lat: e.lat,
      lng: e.lng,
      mg: e.peakMg!,
      w: e.width,
    }))
}

export async function runDetections(
  db: SupabaseClient,
  opts: { write: boolean; onlyHardware?: string | null } = { write: true }
): Promise<{ devices: DetectionRunSummary[]; detectorVersions: Record<string, string> }> {
  let q = db.from('devices').select('id, user_id, ranch_id, hardware_id, name').eq('type', 'scout')
  if (opts.onlyHardware) q = q.eq('hardware_id', opts.onlyHardware)
  const { data: devices, error } = await q
  if (error) throw new Error(`devices fetch failed: ${error.message}`)

  const summaries: DetectionRunSummary[] = []
  for (const d of (devices ?? []) as DeviceRow[]) {
    if (isBenchHardware(d.hardware_id)) {
      summaries.push({ hardwareId: d.hardware_id, name: d.name, skipped: 'bench', jobs: [], wrote: null })
      continue
    }

    const { data: jobRows, error: jobsErr } = await db
      .from('jobs')
      .select('id, user_id, ranch_id, seq_start, seq_end, started_at, coverage')
      .eq('hardware_id', d.hardware_id)
      .order('seq_start', { ascending: true })
    if (jobsErr) throw new Error(`jobs fetch failed: ${jobsErr.message}`)
    const jobs = (jobRows ?? []) as JobRow[]

    const rows = await fetchAllEvents(db, d.id)
    const { events } = toInput(rows, d.hardware_id)
    const baleEvents = toBaleInput(events)

    const summary: DetectionRunSummary = {
      hardwareId: d.hardware_id,
      name: d.name,
      skipped: null,
      jobs: [],
      wrote: null,
    }

    const runInserts: Record<string, unknown>[] = []
    const detectionInserts: Record<string, unknown>[] = []

    for (const job of jobs) {
      const jobEvents = baleEvents.filter(e => e.seq >= job.seq_start && e.seq <= job.seq_end)
      const result = detectBales(jobEvents)
      const runId = stableId('detection-run', d.hardware_id, BALE_DETECTOR, job.seq_start)

      summary.jobs.push({
        jobId: job.id,
        seqStart: job.seq_start,
        seqEnd: job.seq_end,
        startedAt: job.started_at,
        detector: BALE_DETECTOR,
        outcome: result.outcome,
        detectionCount: result.detections.length,
        metrics: result.metrics,
      })

      runInserts.push({
        id: runId,
        user_id: job.user_id,
        ranch_id: job.ranch_id,
        device_id: d.id,
        hardware_id: d.hardware_id,
        job_id: job.id,
        seq_start: job.seq_start,
        seq_end: job.seq_end,
        detector: BALE_DETECTOR,
        outcome: result.outcome,
        detection_count: result.detections.length,
        coverage: job.coverage,
        metrics: result.metrics,
        config: BALE_CONFIG,
        detector_version: BALE_DETECTOR_VERSION,
      })

      for (const det of result.detections) {
        detectionInserts.push({
          id: stableId('detection', d.hardware_id, BALE_DETECTOR, det.anchorSeq),
          user_id: job.user_id,
          ranch_id: job.ranch_id,
          device_id: d.id,
          hardware_id: d.hardware_id,
          run_id: runId,
          job_id: job.id,
          type: BALE_DETECTOR,
          anchor_seq: det.anchorSeq,
          ts: det.ts,
          lat: det.lat,
          lng: det.lng,
          confidence: det.confidence,
          coverage: job.coverage,
          source: det.source,
          evidence: det.evidence,
          detector_version: BALE_DETECTOR_VERSION,
        })
      }
    }

    if (opts.write) {
      // Wholesale delete-and-rewrite, runs and detections together.
      const delDet = await db.from('detections').delete().eq('hardware_id', d.hardware_id)
      if (delDet.error) throw new Error(`detections delete failed: ${delDet.error.message}`)
      const delRuns = await db.from('detection_runs').delete().eq('hardware_id', d.hardware_id)
      if (delRuns.error) throw new Error(`detection_runs delete failed: ${delRuns.error.message}`)
      if (runInserts.length > 0) {
        const ins = await db.from('detection_runs').insert(runInserts)
        if (ins.error) throw new Error(`detection_runs insert failed: ${ins.error.message}`)
      }
      if (detectionInserts.length > 0) {
        const ins = await db.from('detections').insert(detectionInserts)
        if (ins.error) throw new Error(`detections insert failed: ${ins.error.message}`)
      }
      summary.wrote = { runs: runInserts.length, detections: detectionInserts.length }
    }

    summaries.push(summary)
  }

  return { devices: summaries, detectorVersions: { [BALE_DETECTOR]: BALE_DETECTOR_VERSION } }
}
