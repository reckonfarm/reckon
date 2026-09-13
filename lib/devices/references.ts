import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { splitEvents, CASCADE_COLS, type CascadeRow } from '@/lib/cascade'
import { live } from '@/lib/ledger-effective'

// ─── What still points at a device (Block 7D.3) ───────────────────────────────
//
// Devices have never had a delete surface at all, and until 062 they had an
// open DELETE policy nothing called. Both are fixed here: the policy is gone
// and the route owns removal, on the same rule as places — gone when nothing
// points at it, a counted answer when something does.
//
// Everything that names a device does so through a REAL foreign key, all of
// them ON DELETE SET NULL: events.device_id, jobs.device_id,
// detections.device_id. So unlike a place, deleting a device would never
// orphan anything — it would silently DETACH observations from the machine
// that made them, which is a quieter kind of damage and deserves the same
// sentence before it happens.
//
// Jobs and detections are re-derived from device events every three minutes,
// so their counts move on their own. They are still reported: someone about to
// delete a logger should know it is the source of 40 cutting sessions, whether
// or not those rows would be rebuilt tomorrow.

export interface DeviceRefs {
  entries: number
  jobs: number
  detections: number
  total: number
}

/** Counted on the CALLER's client, so RLS scopes every count to their ranch. */
export async function deviceReferences(supabase: SupabaseClient, deviceId: string): Promise<DeviceRefs> {
  const eventsQ = live(supabase.from('events').select('id', { count: 'exact', head: true })).eq('device_id', deviceId)
  const [{ count: entries }, { count: jobs }, { count: detections }] = await Promise.all([
    eventsQ,
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('device_id', deviceId),
    supabase.from('detections').select('id', { count: 'exact', head: true }).eq('device_id', deviceId),
  ])
  const refs = { entries: entries ?? 0, jobs: jobs ?? 0, detections: detections ?? 0, total: 0 }
  refs.total = refs.entries + refs.jobs + refs.detections
  return refs
}

/** "1,240 observations and 40 jobs still point at it." Counted, never vague. */
export function deviceRefsSentence(refs: DeviceRefs): string {
  const parts: string[] = []
  if (refs.entries) parts.push(`${refs.entries.toLocaleString('en-US')} ${refs.entries === 1 ? 'observation' : 'observations'}`)
  if (refs.jobs) parts.push(`${refs.jobs.toLocaleString('en-US')} ${refs.jobs === 1 ? 'job' : 'jobs'}`)
  if (refs.detections) parts.push(`${refs.detections.toLocaleString('en-US')} ${refs.detections === 1 ? 'detection' : 'detections'}`)
  if (parts.length === 0) return 'Nothing points at it.'
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `${list} still ${refs.total === 1 ? 'points' : 'point'} at it.`
}


// ── 8B.2 for devices ──────────────────────────────────────────────────────────
// Same rule, and the numbers matter more here: a logger can carry thousands of
// observations, so the count is the whole decision.

export interface DeviceCascade { hard: string[]; record: string[]; jobs: number; detections: number }

export async function planDeviceCascade(supabase: SupabaseClient, userId: string, ranchId: string, deviceId: string): Promise<DeviceCascade> {
  const { data } = await live(supabase.from('events').select(CASCADE_COLS)).eq('device_id', deviceId)
  const rows = (data ?? []) as unknown as CascadeRow[]
  const { hard, record } = await splitEvents(supabase, userId, ranchId, rows)
  const [{ count: jobs }, { count: detections }] = await Promise.all([
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('device_id', deviceId),
    supabase.from('detections').select('id', { count: 'exact', head: true }).eq('device_id', deviceId),
  ])
  return { hard, record, jobs: jobs ?? 0, detections: detections ?? 0 }
}

export function deviceCascadeSentence(name: string, refs: DeviceRefs, plan: DeviceCascade): string {
  const n = (v: number) => v.toLocaleString('en-US')
  const what = deviceRefsSentence(refs).replace(/\.$/, '').replace(/ still points? at it/, ` point at ${name}`)
  const bits: string[] = []
  if (plan.hard.length > 0) bits.push(`${n(plan.hard.length)} will be deleted outright`)
  if (plan.record.length > 0) bits.push(`${n(plan.record.length)} ${plan.record.length === 1 ? 'was corrected or already seen, so the record keeps it' : 'were corrected or already seen, so the record keeps them'}`)
  // Jobs and detections are DERIVED — the cron rebuilds them from device
  // events every three minutes. Removing the events removes their source, so
  // they go on their own; saying they are "deleted" would claim an action
  // nothing here performs.
  if (plan.jobs > 0 || plan.detections > 0) {
    bits.push(`${n(plan.jobs)} ${plan.jobs === 1 ? 'job' : 'jobs'} and ${n(plan.detections)} ${plan.detections === 1 ? 'detection' : 'detections'} are derived from those observations and will stop being rebuilt`)
  }
  return bits.length > 0 ? `${what}. ${bits.join('; ')}.` : `${what}.`
}
