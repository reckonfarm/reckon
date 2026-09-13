import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { splitEvents, CASCADE_COLS, type CascadeRow } from '@/lib/cascade'
import { live } from '@/lib/ledger-effective'

// ─── What still points at a place (Block 7D.3) ────────────────────────────────
//
// A place can be deleted outright when nothing refers to it. When something
// does, it is NOT deleted and NOT silently retired — the answer says what
// still points at it and where to go and look.
//
// This is the count no RLS policy could ever express, which is why the route
// owns deletion and 062 revokes the client's delete door. A place is named in
// FOUR untyped jsonb keys on events — place_id, from_place_id, to_place_id,
// stock_place_id — with no foreign key, no index and no constraint behind any
// of them. Measured on production: 50 of 67 manual entries name a place. A
// hard delete without this check leaves those entries pointing at an id that
// resolves to nothing, and the ledger loses its WHERE with no error anywhere.
//
// devices.place_id and places.parent_id ARE real foreign keys, both ON DELETE
// SET NULL, so neither would block a delete — they would quietly detach. That
// is worth telling someone about before it happens, so they are counted here
// too rather than left to the database's shrug.

export const PLACE_KEYS = ['place_id', 'from_place_id', 'to_place_id', 'stock_place_id'] as const

export interface PlaceRefs {
  entries: number
  devices: number
  children: number
  total: number
}

/**
 * Counts on the CALLER's client, so RLS scopes every count to their ranch: a
 * place cannot be reported as "free to delete" because the referencing rows
 * happened to belong to someone else, and no count can leak across ranches.
 */
export async function placeReferences(supabase: SupabaseClient, placeId: string): Promise<PlaceRefs> {
  // A deleted entry does not hold a place hostage.
  const entryCounts = await Promise.all(PLACE_KEYS.map(async k => {
    const { count } = await live(supabase.from('events').select('id', { count: 'exact', head: true })).eq(`payload->>${k}`, placeId)
    return count ?? 0
  }))
  const [{ count: devices }, { count: children }] = await Promise.all([
    supabase.from('devices').select('id', { count: 'exact', head: true }).eq('place_id', placeId),
    supabase.from('places').select('id', { count: 'exact', head: true }).eq('parent_id', placeId),
  ])
  const entries = entryCounts.reduce((a, b) => a + b, 0)
  const refs = { entries, devices: devices ?? 0, children: children ?? 0, total: 0 }
  refs.total = refs.entries + refs.devices + refs.children
  return refs
}

/**
 * "8 entries and 1 device still point at it." One sentence, counted, never a
 * vague "this place is in use".
 */
export function refsSentence(refs: PlaceRefs): string {
  const parts: string[] = []
  if (refs.entries) parts.push(`${refs.entries} ${refs.entries === 1 ? 'entry' : 'entries'}`)
  if (refs.devices) parts.push(`${refs.devices} ${refs.devices === 1 ? 'device' : 'devices'}`)
  if (refs.children) parts.push(`${refs.children} ${refs.children === 1 ? 'place' : 'places'} inside it`)
  if (parts.length === 0) return 'Nothing points at it.'
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `${list} still ${refs.total === 1 ? 'points' : 'point'} at it.`
}


// ── 8B.2 — what a cascade would actually do ───────────────────────────────────
// The confirm has to state BOTH numbers before the tap, so the split is
// computed on the read, not discovered during the write.

export interface PlaceCascade {
  rows: CascadeRow[]
  hard: string[]
  record: string[]
  devices: number
}

/** Every live entry naming this place, already classified. */
export async function planPlaceCascade(supabase: SupabaseClient, userId: string, ranchId: string, placeId: string): Promise<PlaceCascade> {
  const seen = new Map<string, CascadeRow>()
  for (const k of PLACE_KEYS) {
    const { data } = await live(supabase.from('events').select(CASCADE_COLS)).eq(`payload->>${k}`, placeId)
    for (const r of (data ?? []) as unknown as CascadeRow[]) seen.set(r.id, r)
  }
  const rows = [...seen.values()]
  const { hard, record } = await splitEvents(supabase, userId, ranchId, rows)
  const { count: devices } = await supabase.from('devices').select('id', { count: 'exact', head: true }).eq('place_id', placeId)
  return { rows, hard, record, devices: devices ?? 0 }
}

/**
 * "4 entries and 1 device point at Rattlesnake. 3 will be deleted outright;
 * 1 was corrected, so the record keeps it."
 *
 * One sentence for what is there, one for what will happen. The second half is
 * omitted when there is nothing to say rather than padded with a zero.
 */
export function cascadeSentence(name: string, refs: PlaceRefs, plan: PlaceCascade): string {
  const what = refsSentence(refs).replace(/\.$/, '').replace(/ still points? at it/, ` point at ${name}`)
  const bits: string[] = []
  if (plan.hard.length > 0) bits.push(`${plan.hard.length} will be deleted outright`)
  if (plan.record.length > 0) bits.push(`${plan.record.length} ${plan.record.length === 1 ? 'was corrected or already seen, so the record keeps it' : 'were corrected or already seen, so the record keeps them'}`)
  if (plan.devices > 0) bits.push(`${plan.devices} ${plan.devices === 1 ? 'device is' : 'devices are'} unassigned, not deleted`)
  return bits.length > 0 ? `${what}. ${bits.join('; ')}.` : `${what}.`
}
