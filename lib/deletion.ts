import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase'
import { resolveRanchId } from '@/lib/ranch-membership'
import { hasEventDeletion } from '@/lib/schema-capability'

// ─── Deleting an entry (Block 7D.1 / 7D.2) ────────────────────────────────────
//
// Two paths. Both are one tap and both make the entry gone from the person's
// view; they differ in whether the row survives.
//
//   HARD   the row is removed. Every balance recomputes without it and there
//          is no tombstone, because there is nothing worth remembering: it was
//          this person's own entry, nobody else had seen it, and no correction
//          ever referred to it.
//
//   RECORD the row stays where it is, holding its links, with deleted_at and
//          deleted_by set. It disappears from Activity and counts toward
//          nothing. Who and when are the record; no reason is required.
//
// WHY THE SECOND PATH EXISTS AT ALL. 054 made supersedes_event_id and
// superseded_by foreign keys with ON DELETE RESTRICT in both directions, so an
// entry at either end of a correction chain CANNOT be removed — Postgres
// refuses with 23503. Those constraints are what stop a correction quietly
// losing the thing it corrected, so they stay. An entry in a chain therefore
// gets the record path, and the person is told in one sentence that the record
// keeps it. THEY NEVER SEE 23503: the chain is checked before the delete is
// attempted, so the database's refusal is a backstop, not a code path anyone
// reaches.
//
// WHY THE SERVICE ROLE. events has no client UPDATE or DELETE policy and gains
// none. Membership and ownership are checked here first, in one place, because
// the hard-delete test is not expressible as a policy: "unseen by anyone else"
// is a comparison against every OTHER member's ranch_members.last_seen_at.

// 'unavailable' is the honest third answer while 061 has not been run. The
// record path WRITES deleted_at, so it cannot be the fallback for a database
// that has no such column — there is nowhere to write the record. Offering a
// delete that would either error or destroy a row without leaving the record
// would be worse than saying not yet, so the sheet says not yet.
export type DeleteMode = 'hard' | 'record' | 'unavailable'

export interface DeletePlan {
  mode: DeleteMode
  /** Why it is not a hard delete — one plain clause, for the confirm sheet. */
  reason: string | null
  label: string
  ts: string
}

export type DeleteResult =
  | { ok: true; mode: DeleteMode; label: string }
  | { ok: false; status: number; error: string }

interface EventRow {
  id: string
  user_id: string
  ranch_id: string | null
  type: string
  ts: string
  ingested_at: string
  payload: Record<string, unknown>
  supersedes_event_id: string | null
  superseded_by: string | null
  deleted_at: string | null
}

const COLS = 'id, user_id, ranch_id, type, ts, ingested_at, payload, supersedes_event_id, superseded_by, deleted_at'

/**
 * What deleting this entry would do, and why — read-only, so the confirm sheet
 * can say it before anything happens. Runs on the caller's own client, so RLS
 * decides what they may look at.
 */
export async function planDelete(supabase: SupabaseClient, userId: string, id: string): Promise<{ ok: true; plan: DeletePlan } | { ok: false; status: number; error: string }> {
  const ranchId = await resolveRanchId(supabase, userId)
  if (!ranchId) return { ok: false, status: 404, error: 'No ranch' }
  if (!(await hasEventDeletion(supabase))) {
    return { ok: true, plan: { mode: 'unavailable', reason: 'deleting is not switched on for this ranch yet', label: 'This entry', ts: '' } }
  }
  const { data, error } = await supabase.from('events').select(COLS).eq('id', id).maybeSingle()
  if (error || !data) return { ok: false, status: 404, error: 'That entry is not on your ranch' }
  const row = data as unknown as EventRow
  if (row.ranch_id !== ranchId) return { ok: false, status: 404, error: 'That entry is not on your ranch' }
  if (row.deleted_at) return { ok: false, status: 409, error: 'That entry was already deleted' }

  const reason = await hardBlocker(supabase, row, userId, ranchId)
  return { ok: true, plan: { mode: reason ? 'record' : 'hard', reason, label: labelOf(row), ts: row.ts } }
}

/**
 * The one test. Returns null when a hard delete is allowed, or the single
 * plainest reason it is not — the sentence the confirm sheet shows.
 *
 * Order matters: the cheapest and most legible reason wins, so a person is
 * told "someone else recorded it" rather than a chain technicality when both
 * are true.
 */
async function hardBlocker(supabase: SupabaseClient, row: EventRow, userId: string, ranchId: string): Promise<string | null> {
  if (row.user_id !== userId) return 'someone else recorded it'
  if (row.supersedes_event_id || row.superseded_by) return 'it is part of a correction'
  // A correction may point AT this row without the trigger having stamped
  // superseded_by (the stamp is the same transaction, but a hand-written row
  // or a future path might not be). Ask directly — the FK would refuse anyway,
  // and a refusal the person cannot read is the thing being avoided.
  const { count } = await supabase.from('events').select('id', { count: 'exact', head: true }).eq('supersedes_event_id', row.id)
  if ((count ?? 0) > 0) return 'it is part of a correction'
  return await seenByAnother(ranchId, userId, row.ingested_at)
}

/**
 * "Unseen by anyone else": no OTHER member of the ranch has opened the ledger
 * since this entry landed. ranch_members.last_seen_at (044) is the cursor the
 * ledger already keeps for exactly this question.
 *
 * Read with the SERVICE ROLE on purpose: a member cannot read another member's
 * row under 043's policies, and the question is about the others. Only the
 * timestamps are read, and only to answer yes or no — nothing about another
 * member reaches the caller.
 *
 * Tolerant: if this cannot be answered, it returns the blocking reason rather
 * than allowing a hard delete. An entry kept that should have gone is a tidy-up
 * problem; a row destroyed that someone had already read is not recoverable.
 */
async function seenByAnother(ranchId: string, userId: string, since: string): Promise<string | null> {
  try {
    const db = createServiceClient()
    const { data, error } = await db.from('ranch_members').select('user_id, last_seen_at').eq('ranch_id', ranchId)
    if (error) return 'the ranch could not be checked just now'
    const others = (data ?? []) as { user_id: string; last_seen_at: string | null }[]
    const seen = others.some(m => m.user_id !== userId && m.last_seen_at != null && m.last_seen_at > since)
    return seen ? 'someone else has already seen it' : null
  } catch {
    return 'the ranch could not be checked just now'
  }
}

/** "Fed 4 bales" — what the confirm sheet names. Short, and never a bare id. */
function labelOf(row: EventRow): string {
  const p = row.payload ?? {}
  const n = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null)
  switch (row.type) {
    case 'hay_fed': { const b = n('bales'); return b != null ? `Fed ${b} ${b === 1 ? 'bale' : 'bales'}` : 'A feeding' }
    case 'hay_inventory': { const b = n('bales'); return b != null ? `Counted ${b} ${b === 1 ? 'bale' : 'bales'}` : 'A hay count' }
    case 'rain': { const i = n('inches'); return i != null ? `${i.toFixed(2)}" of rain` : 'A rain reading' }
    case 'bales_stacked': { const b = n('bales'); return b != null ? `Stacked ${b} ${b === 1 ? 'bale' : 'bales'}` : 'A stacking entry' }
    case 'cattle_moved': return 'A cattle move'
    case 'cattle_worked': return 'Cattle work'
    default: return 'This entry'
  }
}

/**
 * Do it. Re-plans first rather than trusting anything the client sent: the
 * page that opened the confirm sheet may be minutes old, and in that time
 * another member may have read the ledger or corrected the entry.
 */
export async function deleteEvent(supabase: SupabaseClient, userId: string, id: string): Promise<DeleteResult> {
  const planned = await planDelete(supabase, userId, id)
  if (!planned.ok) return planned
  const { mode, label } = planned.plan
  if (mode === 'unavailable') return { ok: false, status: 503, error: 'Deleting is not switched on for this ranch yet' }
  const db = createServiceClient()

  if (mode === 'hard') {
    const { error } = await db.from('events').delete().eq('id', id)
    if (!error) return { ok: true, mode: 'hard', label }
    // The FK backstop. Nothing above should reach it, but if it does the
    // person gets the honest outcome rather than a database code: fall through
    // and keep the row with a deletion record.
    if (!isRestrict(error)) return { ok: false, status: 500, error: 'That entry could not be deleted just now' }
  }

  const { error: upErr } = await db.from('events')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', id).is('deleted_at', null)
  if (upErr) return { ok: false, status: 500, error: 'That entry could not be deleted just now' }
  return { ok: true, mode: 'record', label }
}

/** Postgres 23503 — foreign_key_violation. The one error we expect and absorb. */
function isRestrict(error: { code?: string } | null): boolean {
  return error?.code === '23503'
}
