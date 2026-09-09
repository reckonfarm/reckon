import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAnnotations } from './annotations'
import { fetchRunsForJobs } from '@/lib/detections/queries'
import { BALE_MACHINE } from '@/lib/detections/detect-bales'
import { isInProgress, isMinorJob } from './display'
import { ranchYearStart } from './format'

// ─── Work — the machines' side of the record, as rows (Block 6 · 6J) ──────────
// A job is a session a Scout observed on a machine (jobs table, stable ids,
// derived — never an event). The Sept 8 audit found no surface for cutting and
// baling; the data was never deleted (18 jobs on Kiehl Ranch, Aug 5–27; nine
// annotations naming Baling with counted bales; 18 detection runs). This is the
// one read the Work section and the Activity record share.
//   type      the operator's word (annotation name/machine) → cutting · baling;
//             a session with no word stays a "machine session" — never guessed
//   quantity  only when supported: bales the operator COUNTED (annotation), or
//             bales the Scout DETECTED on a machine confirmed as a baler
//   place     jobs carry no place identity (a bbox, not a place) — none is shown
//   stock     a Scout's bale count is bales MADE, not stacked: it never enters
//             the hay ledger; only a stack record does, so nothing double-adds

export type WorkKind = 'cutting' | 'baling' | 'session'
export interface WorkRow {
  id: string
  kind: WorkKind
  name: string | null            // the operator's name for it ("Baling")
  machine: string | null         // the operator's word for the machine ("baler")
  device: string | null          // the Scout's name — origin
  startedAt: string
  endedAt: string
  durationS: number
  inProgress: boolean
  minor: boolean                 // under the list floor (short / few points) — still a fact, listed last
  quantity: { bales: number; basis: 'counted by hand' | 'detected by the Scout' } | null
}

interface JobRow { id: string; started_at: string; ended_at: string; duration_s: number; event_count: number; devices: { name: string } | null }

export function workKind(name: string | null, machine: string | null): WorkKind {
  const m = (machine ?? '').toLowerCase(), n = (name ?? '').toLowerCase()
  if (m === BALE_MACHINE || /\bbal/.test(n) || /baler/.test(m)) return 'baling'
  if (/swather|windrower|mower|haybine|cutter/.test(m) || /\b(cut|swath|mow|windrow)/.test(n)) return 'cutting'
  return 'session'
}

export async function listWork(supabase: SupabaseClient, opts: { kind?: WorkKind | 'all'; since?: string | null; limit?: number } = {}): Promise<WorkRow[]> {
  const since = opts.since === undefined ? ranchYearStart() : opts.since
  let q = supabase.from('jobs').select('id, started_at, ended_at, duration_s, event_count, devices(name)').order('started_at', { ascending: false }).limit(opts.limit ?? 60)
  if (since) q = q.gte('started_at', since)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const jobs = (data ?? []) as unknown as JobRow[]
  const [annotations, runs] = await Promise.all([fetchAnnotations(supabase, jobs.map(j => j.id)), fetchRunsForJobs(supabase, jobs.map(j => j.id))])
  const rows: WorkRow[] = jobs
    .filter(j => annotations.get(j.id)?.dismissed_at == null)
    .map(j => {
      const a = annotations.get(j.id) ?? null
      const kind = workKind(a?.name ?? null, a?.machine ?? null)
      let quantity: WorkRow['quantity'] = null
      if (a?.actual_bale_count != null) quantity = { bales: a.actual_bale_count, basis: 'counted by hand' }
      else {
        const run = runs.get(j.id)?.find(r => r.detector === 'bale')
        if (run?.outcome === 'detected' && a?.machine === BALE_MACHINE) quantity = { bales: run.detection_count, basis: 'detected by the Scout' }
      }
      return { id: j.id, kind, name: a?.name ?? null, machine: a?.machine ?? null, device: j.devices?.name ?? null, startedAt: j.started_at, endedAt: j.ended_at, durationS: j.duration_s, inProgress: isInProgress(j), minor: isMinorJob(j) && !isInProgress(j), quantity }
    })
  return opts.kind && opts.kind !== 'all' ? rows.filter(r => r.kind === opts.kind) : rows
}

// One line for one session, the same words on Work and in the Activity record.
export function describeWork(r: WorkRow, fmtDuration: (s: number) => string): string {
  const what = r.name ?? (r.kind === 'session' ? 'Machine session' : r.kind === 'baling' ? 'Baling' : 'Cutting')
  const qty = r.quantity ? ` · ${r.quantity.bales.toLocaleString('en-US')} ${r.quantity.bales === 1 ? 'bale' : 'bales'} ${r.quantity.basis}` : ''
  return `${what} · ${fmtDuration(r.durationS)}${qty}`
}
