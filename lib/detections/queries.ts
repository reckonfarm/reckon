import type { SupabaseClient } from '@supabase/supabase-js'
import type { BaleDetection, BaleRunMetrics } from './detect-bales'

// ─── Detection read paths — the semantic API, growing from fetchAnnotations ────
//
// Typed functions over a passed-in SupabaseClient (user-scoped SSR client on
// pages → RLS exercised; service client in scripts). Pages call these today;
// an agent-facing route handler will call the same functions later — the
// query layer is the API, route handlers are just transport.
//
// Parameterized on time/bbox/machine, NOT place: no field boundaries exist
// yet (places is empty). "Bales for place X" becomes a thin wrapper over
// fetchBales(bbox-of-place) the day the first polygon is drawn.
//
// Every function returns empty on error, on purpose: between a deploy and
// PK applying 038 in the SQL editor, these tables don't exist — the jobs
// pages must render (without detection chrome), never 500.

export interface DetectionRunRow {
  id: string
  job_id: string
  detector: string
  outcome: 'detected' | 'no_signature' | 'insufficient_evidence'
  detection_count: number
  coverage: number
  metrics: BaleRunMetrics
  detector_version: string
  derived_at: string
}

export interface DetectionRow {
  id: string
  job_id: string
  type: string
  anchor_seq: number
  ts: string
  lat: number | null
  lng: number | null
  confidence: number
  coverage: number
  source: BaleDetection['source']
  evidence: BaleDetection['evidence']
  detector_version: string
}

const RUN_COLS = 'id, job_id, detector, outcome, detection_count, coverage, metrics, detector_version, derived_at'
const DET_COLS = 'id, job_id, type, anchor_seq, ts, lat, lng, confidence, coverage, source, evidence, detector_version'

// Runs for a set of jobs, keyed job_id → runs (one per detector). Feeds the
// jobs list (bale chip) and the detail page (verdict card, including the
// first-class negatives: no_signature / insufficient_evidence).
export async function fetchRunsForJobs(
  supabase: SupabaseClient,
  jobIds: string[],
): Promise<Map<string, DetectionRunRow[]>> {
  if (jobIds.length === 0) return new Map()
  const { data } = await supabase.from('detection_runs').select(RUN_COLS).in('job_id', jobIds)
  const map = new Map<string, DetectionRunRow[]>()
  for (const r of (data ?? []) as unknown as DetectionRunRow[]) {
    const list = map.get(r.job_id) ?? []
    list.push(r)
    map.set(r.job_id, list)
  }
  return map
}

// All detections inside one job, in device-counter order (= chronological).
export async function fetchDetectionsForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<DetectionRow[]> {
  const { data } = await supabase
    .from('detections')
    .select(DET_COLS)
    .eq('job_id', jobId)
    .order('anchor_seq', { ascending: true })
  return (data ?? []) as unknown as DetectionRow[]
}

export interface BaleQuery {
  from?: string // ISO — inclusive
  to?: string //   ISO — exclusive
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number }
  // 'baler' = only bales whose job the operator confirmed as a baler;
  // omitted = all bale detections, each row saying whether it's confirmed.
  machine?: string
}

export interface BaleRow extends DetectionRow {
  machineConfirmed: boolean // job_annotations.machine === 'baler' for its job
}

// The semantic read: "bales between dates / inside a bbox / on confirmed
// balers". Confirmation lives in job_annotations (user layer, no FK), so it
// is a second query merged in code — the same two-query shape every derived-
// layer read uses.
export async function fetchBales(
  supabase: SupabaseClient,
  query: BaleQuery = {},
): Promise<BaleRow[]> {
  let q = supabase.from('detections').select(DET_COLS).eq('type', 'bale')
  if (query.from) q = q.gte('ts', query.from)
  if (query.to) q = q.lt('ts', query.to)
  if (query.bbox) {
    q = q
      .gte('lat', query.bbox.minLat)
      .lte('lat', query.bbox.maxLat)
      .gte('lng', query.bbox.minLng)
      .lte('lng', query.bbox.maxLng)
  }
  const { data } = await q.order('ts', { ascending: true })
  const rows = (data ?? []) as unknown as DetectionRow[]
  if (rows.length === 0) return []

  const jobIds = [...new Set(rows.map(r => r.job_id))]
  const { data: annos } = await supabase
    .from('job_annotations')
    .select('job_id, machine')
    .in('job_id', jobIds)
  const machineByJob = new Map((annos ?? []).map(a => [a.job_id as string, a.machine as string | null]))

  const withConfirm = rows.map(r => ({
    ...r,
    machineConfirmed: machineByJob.get(r.job_id) === 'baler',
  }))
  return query.machine ? withConfirm.filter(r => machineByJob.get(r.job_id) === query.machine) : withConfirm
}
