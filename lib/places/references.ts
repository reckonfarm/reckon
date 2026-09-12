import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasEventDeletion } from '@/lib/schema-capability'

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
  // A deleted entry does not hold a place hostage — but on a database without
  // 061 there are no deleted entries, so the filter is skipped rather than
  // erroring (lib/schema-capability.ts).
  const canDel = await hasEventDeletion(supabase)
  const entryCounts = await Promise.all(PLACE_KEYS.map(async k => {
    let q = supabase.from('events').select('id', { count: 'exact', head: true })
    if (canDel) q = q.is('deleted_at', null)
    const { count } = await q.eq(`payload->>${k}`, placeId)
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
