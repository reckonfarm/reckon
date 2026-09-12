import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasEventDeletion } from '@/lib/schema-capability'

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
  const canDel = await hasEventDeletion(supabase)
  let eventsQ = supabase.from('events').select('id', { count: 'exact', head: true }).eq('device_id', deviceId)
  if (canDel) eventsQ = eventsQ.is('deleted_at', null)
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
