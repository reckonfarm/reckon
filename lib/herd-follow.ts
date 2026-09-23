import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveRanchId } from './ranch-membership'

// ─── The bunches Markets follows (Block 40) ──────────────────────────────────
// Markets prices what a person says they will sell, and nothing else. Which
// bunches those are is a preference of the RANCH (everyone on it sees the same
// list), kept as a list of bunch ids in the operation profile's `herd` jsonb —
// the blob Block 4B stopped reading when lots became rows, so nothing else
// lives there. No migration: `{ followed: [...] }` is the whole shape.
//
// A followed bunch that is later deleted or split simply drops out: the list is
// always read AGAINST the live lots, so a stale id never paints a row and never
// breaks the page. Nothing here writes a record; a preference is not a record.

export const HERD_FOLLOW_KEY = 'followed'

/** The stored list, raw — ids that may or may not still be live. */
export function parseFollowed(herd: unknown): string[] {
  if (!herd || typeof herd !== 'object') return []
  const raw = (herd as Record<string, unknown>)[HERD_FOLLOW_KEY]
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

/** Only the ids that name a live bunch, in the order the lots come. */
export function followedLive<L extends { id: string }>(followed: string[], lots: L[]): L[] {
  const set = new Set(followed)
  return lots.filter(l => set.has(l.id))
}

export async function readFollowed(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const ranchId = await resolveRanchId(supabase, userId)
  const { data } = await supabase.from('operation_profiles').select('herd').eq(ranchId ? 'ranch_id' : 'user_id', ranchId ?? userId).maybeSingle()
  return parseFollowed((data as { herd?: unknown } | null)?.herd)
}

/** Writes the list on the ranch's one profile row; creates the row if the ranch has none yet. */
export async function writeFollowed(supabase: SupabaseClient, userId: string, followed: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const ranchId = await resolveRanchId(supabase, userId)
  const payload = { user_id: userId, ...(ranchId ? { ranch_id: ranchId } : {}), herd: { [HERD_FOLLOW_KEY]: followed }, updated_at: new Date().toISOString() }
  const { error } = await supabase.from('operation_profiles').upsert(payload, { onConflict: ranchId ? 'ranch_id' : 'user_id' })
  return error ? { ok: false, error: error.message } : { ok: true }
}
