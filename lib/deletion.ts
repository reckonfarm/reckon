import { moveLine, type MovedBunch } from '@/lib/move-line'
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase'
import { resolveRanchId } from '@/lib/ranch-membership'

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

export type DeleteMode = 'hard' | 'record'

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
  const { data, error } = await supabase.from('events').select(COLS).eq('id', id).maybeSingle()
  if (error || !data) return { ok: false, status: 404, error: 'That entry is not on your ranch' }
  const row = data as unknown as EventRow
  if (row.ranch_id !== ranchId) return { ok: false, status: 404, error: 'That entry is not on your ranch' }
  if (row.deleted_at) return { ok: false, status: 409, error: 'That entry was already deleted' }

  const reason = await hardBlocker(supabase, row, userId, ranchId)
  return { ok: true, plan: { mode: reason ? 'record' : 'hard', reason, label: await labelOf(supabase, row), ts: row.ts } }
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
async function labelOf(supabase: SupabaseClient, row: EventRow): Promise<string> {
  const p = row.payload ?? {}
  const n = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null)
  switch (row.type) {
    case 'hay_fed': { const b = n('bales'); return b != null ? `Fed ${b} ${b === 1 ? 'bale' : 'bales'}` : 'A feeding' }
    case 'hay_inventory': { const b = n('bales'); return b != null ? `Counted ${b} ${b === 1 ? 'bale' : 'bales'}` : 'A hay count' }
    case 'rain': { const i = n('inches'); return i != null ? `${i.toFixed(2)}" of rain` : 'A rain reading' }
    case 'bales_stacked': { const b = n('bales'); return b != null ? `Stacked ${b} ${b === 1 ? 'bale' : 'bales'}` : 'A stacking entry' }
    case 'cattle_moved': {
      // Block 25: the sheet names WHICH move — the bunch, read even from the trash.
      const lotId = typeof p.herd_lot_id === 'string' ? p.herd_lot_id : null
      const { data } = lotId ? await supabase.from('herd_lots').select('name, class, deleted_at').eq('id', lotId).maybeSingle() : { data: null }
      const l = data as { name: string | null; class: MovedBunch['class']; deleted_at: string | null } | null
      return moveLine(n('head'), l ? { name: l.name, class: l.class, deleted: !!l.deleted_at } : null, null, null)
    }
    case 'cattle_worked': return 'Cattle work'
    case 'cattle_counted': { const c = n('counted'); return c != null ? `Counted ${c} head` : 'A cattle count' }
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
  const db = createServiceClient()

  if (mode === 'hard') {
    // Block 12 (12.4): nothing a person deletes is gone at once. The hard path
    // kept its test (own, unseen, no chain) because that is what decides whether
    // the RECORD must keep a note — but the row itself goes to the trash like
    // everything else, restorable for TRASH_DAYS, removed by purge_trash().
    const { error } = await db.from('events').update({ deleted_at: new Date().toISOString(), deleted_by: userId }).eq('id', id).is('deleted_at', null)
    if (!error) { await trashCreatedBunches(db, userId, id); return { ok: true, mode: 'hard', label } }
    // The FK backstop. Nothing above should reach it, but if it does the
    // person gets the honest outcome rather than a database code: fall through
    // and keep the row with a deletion record.
    if (!isRestrict(error)) return { ok: false, status: 500, error: 'That entry could not be deleted just now' }
  }

  const { error: upErr } = await db.from('events')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', id).is('deleted_at', null)
  if (upErr) return { ok: false, status: 500, error: 'That entry could not be deleted just now' }
  await trashCreatedBunches(db, userId, id)
  return { ok: true, mode: 'record', label }
}

// ─── Block 15 (ruling 3): the check and the split are ONE record, ONE Undo ────
// A working that CREATED a bunch (a preg check's opens, a sort's new group)
// takes that bunch to the trash with it: 066 rebuilds the created bunch's head
// to zero the moment the working is deleted, and a zero-head bunch left live
// on the list is the half-undo PK described. Restore (lib/trash.ts) brings
// the bunch back with the working. Only bunches the working itself created
// (results[].created === true) — a bunch that already existed and merely
// received head is not touched, because it is not the working's to remove.
export async function createdBunchIds(db: SupabaseClient, eventId: string): Promise<string[]> {
  const { data } = await db.from('events').select('type, payload').eq('id', eventId).maybeSingle()
  const row = data as { type?: string; payload?: { results?: { lot_id?: string; created?: boolean }[] } } | null
  if (!row || row.type !== 'group_action' || !Array.isArray(row.payload?.results)) return []
  return row.payload!.results!.filter(r => r.created === true && typeof r.lot_id === 'string').map(r => r.lot_id as string)
}
async function trashCreatedBunches(db: SupabaseClient, userId: string, eventId: string): Promise<void> {
  const ids = await createdBunchIds(db, eventId)
  if (ids.length === 0) return
  await db.from('herd_lots').update({ deleted_at: new Date().toISOString(), deleted_by: userId }).in('id', ids).is('deleted_at', null)
}

/** Postgres 23503 — foreign_key_violation. The one error we expect and absorb. */
function isRestrict(error: { code?: string } | null): boolean {
  return error?.code === '23503'
}
