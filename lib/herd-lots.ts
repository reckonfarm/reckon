import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveRanchId } from './ranch-membership'
import { normalizeLot, isLotPurpose, type Lot } from './herd'
import { staleEdit, retiredWhileOpen } from './stale-edit'
import { liveOnly } from './trash'

// ─── The ranch's cattle lots — real rows (Block 4B, migration 051) ─────────────
// One row per lot on herd_lots, membership-gated (043 shape). Two members
// editing DIFFERENT lots touch different rows; a same-lot edit carries the
// updated_at the editor last saw and is refused (409) when the row moved on.
// Lots are RETIRED, never deleted, so a feeding logged against one keeps its
// name forever. Every read and write here runs on the USER-SCOPED client — the
// policy is the gate; user ids are recorded as authorship, never as grants.

// Block 14 (069) adds place_id. TOLERANT READ, on 040's precedent and NOT the
// memoised probe 12.4 had to remove: every read asks with place_id and, if the
// column is not there yet, asks again without it — no cached answer that can
// go stale the moment PK runs the migration.
const LOT_COLUMNS_BASE = 'id, ranch_id, class, name, head_count, avg_weight, weight_unit, frame, weaned, sale_windows, created_at, updated_at, retired_at, updated_by'
const LOT_COLUMNS = `${LOT_COLUMNS_BASE}, place_id`
type Res = { data: unknown; error: { code?: string; message?: string } | null }
const missingColumn = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === '42703' || /place_id|does not exist/i.test(e.message ?? ''))
/** Needs a migration a person can name, in words a person can read. */
const NEEDS_069 = 'The ranch\'s database needs update 069 before a bunch can be made this way (a place, no weight, or pairs). Add it under Ranch → Cattle with a weight for now.'

interface LotRow {
  id: string; ranch_id: string; class: Lot['class']; name: string | null; head_count: number; avg_weight: number | string | null
  place_id?: string | null
  weight_unit: Lot['weight_unit']; frame: Lot['frame']; weaned: boolean; sale_windows: Lot['sale_windows'] | null
  created_at: string; updated_at: string; retired_at: string | null; updated_by?: string | null
  purpose?: string | null
}

function rowToLot(r: LotRow): Lot {
  return {
    id: r.id, class: r.class, head_count: r.head_count, avg_weight: r.avg_weight == null ? null : Number(r.avg_weight), weight_unit: r.weight_unit,
    ...(r.place_id ? { place_id: r.place_id } : {}),
    frame: r.frame, weaned: r.weaned, sale_windows: Array.isArray(r.sale_windows) ? r.sale_windows : [],
    ...(r.name ? { name: r.name } : {}), ...(isLotPurpose(r.purpose) ? { purpose: r.purpose } : {}), created_at: r.created_at, updated_at: r.updated_at,
    ...(r.retired_at ? { retired_at: r.retired_at } : {}),
  }
}

// Block 6A: herd_lots.purpose arrives with migration 055. Until it runs, the
// column is absent and purpose is UNKNOWN — never guessed from class here. The
// main read never names the column (a missing column fails the whole select);
// a second, best-effort read fills it in when it exists.
let purposeKnown: boolean | null = null
export async function lotPurposeSupported(supabase: SupabaseClient): Promise<boolean> {
  if (purposeKnown !== null) return purposeKnown
  const { error } = await supabase.from('herd_lots').select('purpose').limit(1)
  purposeKnown = !error
  return purposeKnown
}
async function withPurpose(supabase: SupabaseClient, lots: Lot[]): Promise<Lot[]> {
  if (lots.length === 0 || !(await lotPurposeSupported(supabase))) return lots
  const { data } = await supabase.from('herd_lots').select('id, purpose').in('id', lots.map(l => l.id))
  const by = new Map(((data ?? []) as { id: string; purpose: string | null }[]).map(r => [r.id, r.purpose]))
  return lots.map(l => { const p = by.get(l.id); return isLotPurpose(p) ? { ...l, purpose: p } : l })
}

// Block 14: one row's place_id, when the column exists; the row as it is when not.
async function withPlace(supabase: SupabaseClient, r: LotRow): Promise<Lot> {
  if (r.place_id !== undefined) return rowToLot(r)
  const { data, error } = await supabase.from('herd_lots').select('place_id').eq('id', r.id).maybeSingle()
  if (error || !data) return rowToLot(r)
  return rowToLot({ ...r, place_id: (data as { place_id?: string | null }).place_id ?? null })
}

async function ranchOf(supabase: SupabaseClient, userId?: string): Promise<{ uid: string; ranchId: string } | null> {
  const uid = userId ?? (await supabase.auth.getUser()).data.user?.id
  if (!uid) return null
  const ranchId = await resolveRanchId(supabase, uid)
  return ranchId ? { uid, ranchId } : null
}

// The live lots of the caller's ranch, oldest first — THE lots read for every
// picker, ledger line, estimate, and page. Retired lots are not listed here…
export async function getRanchLots(supabase: SupabaseClient, userId?: string): Promise<Lot[]> {
  const who = await ranchOf(supabase, userId)
  if (!who) return []
  let res: Res = await liveOnly(supabase.from('herd_lots').select(LOT_COLUMNS).eq('ranch_id', who.ranchId).is('retired_at', null)).order('created_at', { ascending: true })
  if (missingColumn(res.error)) res = await liveOnly(supabase.from('herd_lots').select(LOT_COLUMNS_BASE).eq('ranch_id', who.ranchId).is('retired_at', null)).order('created_at', { ascending: true })
  return withPurpose(supabase, ((res.data ?? []) as LotRow[]).map(rowToLot))
}

// …but a name must resolve for any lot the ledger ever fed, retired or not.
export async function getRanchLotsIncludingRetired(supabase: SupabaseClient, userId?: string): Promise<Lot[]> {
  const who = await ranchOf(supabase, userId)
  if (!who) return []
  // Retired lots still resolve a name; TRASHED ones do not — the trash is invisible everywhere but /account/trash.
  let res: Res = await liveOnly(supabase.from('herd_lots').select(LOT_COLUMNS).eq('ranch_id', who.ranchId)).order('created_at', { ascending: true })
  if (missingColumn(res.error)) res = await liveOnly(supabase.from('herd_lots').select(LOT_COLUMNS_BASE).eq('ranch_id', who.ranchId)).order('created_at', { ascending: true })
  return withPurpose(supabase, ((res.data ?? []) as LotRow[]).map(rowToLot))
}

// ─── Block 12 (12.6): a head count is history ─────────────────────────────────
// The lot form used to write head_count and nothing else, so the ledger had
// holes exactly where a person had typed over the number. Every change is a
// row now: head_count_set { lot_id, head_before, head_after, reason }. With
// 066 applied, the database rebuilds the column FROM these rows and from the
// group actions after them — so the row is written first, and the direct
// column write below is the same value, kept for a database without 066.
// Written on the caller's own client: the 043 insert policy is the gate.
async function recordHeadCountSet(supabase: SupabaseClient, uid: string, ranchId: string, lotId: string, before: number | null, after: number, reason: 'created' | 'edit', ts: string = new Date().toISOString()): Promise<string | null> {
  const { error } = await supabase.from('events').insert({
    user_id: uid, ranch_id: ranchId, device_id: null, type: 'head_count_set', ts, schema_version: 1,
    payload: { source: 'manual', schema_version: 1, lot_id: lotId, head_before: before, head_after: after, reason },
  })
  return error ? error.message : null
}

// Block 36: 'YYYY-MM-DD' ranch day → the ISO instant the opening happened
// (noon, ranch time), or today. Not in the future, not before 2000.
function openingDay(raw: unknown): { ok: true; ts: string } | { ok: false; error: string } {
  const v = typeof raw === 'object' && raw ? (raw as { as_of?: unknown }).as_of : undefined
  if (v == null || v === '') return { ok: true, ts: new Date().toISOString() }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: 'The opening date must be a day (YYYY-MM-DD).' }
  const d = new Date(`${v}T12:00:00-06:00`)
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'The opening date must be a real day.' }
  if (d.getTime() > Date.now() + 36 * 3600 * 1000) return { ok: false, error: 'The opening date is in the future.' }
  if (d.getUTCFullYear() < 2000) return { ok: false, error: 'The opening date is too far in the past.' }
  return { ok: true, ts: d.toISOString() }
}

/**
 * Block 22 (ruling 6): SET A BUNCH'S COUNT FROM A COUNT, with no signal.
 *
 * A gate has no bars. Counting at one and then being told to find a hilltop
 * before the number can mean anything is the whole problem — so the tally's
 * "set this bunch to N" travels through the outbox like every other record and
 * lands here, rather than through the online-only PATCH the follow-up button
 * uses.
 *
 * The rule is 12.6's and is not copied: the ledger row is what counts, and the
 * column is written to the same value for a database without 066. An unchanged
 * count writes nothing at all — recording that a bunch is still what it already
 * was is not a change, and the ledger should not say it was.
 */
export async function setLotHeadFromCount(supabase: SupabaseClient, lotId: string, head: number): Promise<{ ok: true; before: number | null; changed: boolean } | { ok: false; error: string }> {
  const who = await ranchOf(supabase)
  if (!who) return { ok: false, error: 'You are not on a ranch yet.' }
  const { data: now } = await supabase.from('herd_lots').select('head_count, retired_at, deleted_at').eq('id', lotId).eq('ranch_id', who.ranchId).maybeSingle()
  const row = now as { head_count?: number; retired_at?: string | null; deleted_at?: string | null } | null
  if (!row || row.retired_at || row.deleted_at) return { ok: false, error: 'That bunch is not on your ranch.' }
  const before = row.head_count ?? null
  if (before === head) return { ok: true, before, changed: false }
  const ledgerErr = await recordHeadCountSet(supabase, who.uid, who.ranchId, lotId, before, head, 'edit')
  if (ledgerErr) return { ok: false, error: 'The count could not be written to the record.' }
  const { error } = await supabase.from('herd_lots').update({ head_count: head, updated_by: who.uid }).eq('id', lotId).eq('ranch_id', who.ranchId).is('retired_at', null)
  if (error) return { ok: false, error: error.message ?? 'Could not set the bunch.' }
  return { ok: true, before, changed: true }
}

export type LotWrite =
  | { ok: true; lot: Lot }
  | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string; changed_by?: string | null; changed_at?: string | null }

// Create — the row is the ranch's; created_by / updated_by record who.
export async function createLot(supabase: SupabaseClient, raw: unknown): Promise<LotWrite> {
  const who = await ranchOf(supabase)
  if (!who) return { ok: false, status: 403, error: 'You are not on a ranch yet.' }
  const n = normalizeLot(raw)
  if (!n.ok) return { ok: false, status: 400, error: n.error }
  const l = n.lot
  // Block 14: where the bunch is — a live place this person can see, or none.
  // Under RLS a place on another ranch is simply not found.
  let placeId: string | null = null
  if (l.place_id) {
    const { data: pl } = await liveOnly(supabase.from('places').select('id, retired_at').eq('id', l.place_id)).maybeSingle()
    const row = pl as { id: string; retired_at: string | null } | null
    if (!row || row.retired_at) return { ok: false, status: 400, error: 'No such place to put the bunch at.' }
    placeId = row.id
  }
  const row = {
    ranch_id: who.ranchId, class: l.class, name: l.name ?? null, head_count: l.head_count, avg_weight: l.avg_weight,
    weight_unit: l.weight_unit, frame: l.frame, weaned: l.weaned, sale_windows: l.sale_windows, created_by: who.uid, updated_by: who.uid,
    // Block 25b: NOT place_id. A bunch's place is the database's projection of
    // its moves (072); a bunch made at a place gets a placement below, and the
    // trigger puts it there.
    ...(l.purpose && (await lotPurposeSupported(supabase)) ? { purpose: l.purpose } : {}),
  }
  let ins: Res = await supabase.from('herd_lots').insert(row).select(LOT_COLUMNS_BASE).single()
  // A database without 069 refuses a place, a null weight or pairs. Say which
  // update is missing, in words, and never a column name.
  if (ins.error && (missingColumn(ins.error) || /avg_weight|herd_lots_class_check|herd_lots_weight_check/i.test(ins.error.message ?? ''))) {
    if (!placeId && l.avg_weight != null && l.class !== 'pairs') ins = await supabase.from('herd_lots').insert(row).select(LOT_COLUMNS_BASE).single()
    else return { ok: false, status: 400, error: NEEDS_069 }
  }
  const { data, error } = ins
  if (error || !data) return { ok: false, status: 500, error: error?.message ?? 'Could not save the bunch.' }
  const created = data as LotRow
  // Block 36: a bunch can carry an opening date. The opening count — and the
  // placement with it — happen on the day the count was TRUE, not the day the
  // row was typed in; a bunch put on the books a week late still opens on the
  // day it was counted. Today when none is given.
  const openedAt = openingDay(raw)
  if (!openedAt.ok) return { ok: false, status: 400, error: openedAt.error }
  const ledgerErr = await recordHeadCountSet(supabase, who.uid, who.ranchId, created.id, null, created.head_count, 'created', openedAt.ts)
  if (ledgerErr) return { ok: false, status: 500, error: 'The bunch was saved but its count could not be written to the record — open it and set the count again.' }
  // Block 25b (PK, 2026-09-21): a place without a move is a PLACEMENT — the same
  // event a move is, marked so it reads "placed at", never "moved".
  if (placeId) {
    const { error: placedErr } = await supabase.from('events').insert({
      user_id: who.uid, ranch_id: who.ranchId, device_id: null, type: 'cattle_moved', ts: openedAt.ts, schema_version: 1,
      payload: { source: 'manual', schema_version: 1, placement: true, placement_reason: 'created', head: created.head_count, herd_lot_id: created.id, from_place_id: null, to_place_id: placeId, place_id: placeId },
    })
    if (placedErr) return { ok: false, status: 500, error: 'The bunch was saved, but where it is could not be written to the record — open it and pick the place again.' }
  }
  return { ok: true, lot: (await withPurpose(supabase, [await withPlace(supabase, created)]))[0] }
}

// Update — ONLY when the row still carries the updated_at the editor last saw.
// Zero rows updated with the row present = someone else moved it: 409, and the
// caller reloads before trying again. Never a silent overwrite.
export async function updateLot(supabase: SupabaseClient, id: string, raw: unknown, expectedUpdatedAt: string | null): Promise<LotWrite> {
  const who = await ranchOf(supabase)
  if (!who) return { ok: false, status: 403, error: 'You are not on a ranch yet.' }
  const n = normalizeLot({ ...(typeof raw === 'object' && raw ? raw : {}), id })
  if (!n.ok) return { ok: false, status: 400, error: n.error }
  const l = n.lot
  // What the count says now, so a change is a change and an unchanged count writes nothing.
  const { data: now } = await supabase.from('herd_lots').select('head_count').eq('id', id).eq('ranch_id', who.ranchId).maybeSingle()
  const before = (now as { head_count?: number } | null)?.head_count ?? null
  let q = supabase.from('herd_lots').update({
    class: l.class, name: l.name ?? null, head_count: l.head_count, avg_weight: l.avg_weight, weight_unit: l.weight_unit,
    frame: l.frame, weaned: l.weaned, sale_windows: l.sale_windows, updated_by: who.uid,
    ...(l.purpose && (await lotPurposeSupported(supabase)) ? { purpose: l.purpose } : {}),
  }).eq('id', id).eq('ranch_id', who.ranchId).is('retired_at', null)
  if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt)
  // The returning list names only columns every database has: PostgREST
  // refuses the WHOLE statement — the update included — when it names one
  // that is not there, and the first local run showed a stale edit answered
  // 200 with nothing written because of exactly that. place_id is re-read
  // below, tolerantly, once the write has landed.
  const upd: Res = await q.select(LOT_COLUMNS_BASE)
  const { error } = upd
  const data = upd.data as LotRow[] | null
  if (error) return { ok: false, status: 500, error: error.message ?? 'Could not save the bunch.' }
  if (data && data.length === 1) {
    // Block 12 (12.6): the ledger row AFTER the compare-and-set has won. Under
    // 066 the row's trigger rebuilds the column to the same value (no change,
    // no touch); written before the update it bumped updated_at and made the
    // token match nothing — the first run after 12.6 showed every count edit
    // answering 500. A row that cannot be written is said out loud: the column
    // moved, the record did not, and the next rebuild would put it back.
    if (before !== null && before !== l.head_count) {
      const ledgerErr = await recordHeadCountSet(supabase, who.uid, who.ranchId, id, before, l.head_count, 'edit')
      if (ledgerErr) return { ok: false, status: 500, error: 'The bunch was saved but the count could not be written to the record — set the count again.' }
    }
    return { ok: true, lot: (await withPurpose(supabase, [await withPlace(supabase, data[0] as LotRow)]))[0] }
  }
  // Nothing moved: distinguish "gone" from "changed under you". The words for
  // both live in lib/stale-edit.ts now, so places inherits them verbatim
  // instead of growing a second dialect of the same sentence.
  let cur: Res = await supabase.from('herd_lots').select(LOT_COLUMNS).eq('id', id).maybeSingle()
  if (missingColumn(cur.error)) cur = await supabase.from('herd_lots').select(LOT_COLUMNS_BASE).eq('id', id).maybeSingle()
  const current = cur.data
  if (!current || (current as LotRow).retired_at) return { ok: false, status: 404, error: retiredWhileOpen('bunch') }
  const row = current as LotRow
  return { ok: false, ...(await staleEdit('bunch', row)) }
}

// Retire — the lot leaves the pickers and the estimate; its name still resolves.
export async function retireLot(supabase: SupabaseClient, id: string): Promise<LotWrite> {
  const who = await ranchOf(supabase)
  if (!who) return { ok: false, status: 403, error: 'You are not on a ranch yet.' }
  const ret: Res = await supabase.from('herd_lots').update({ retired_at: new Date().toISOString(), retired_by: who.uid, updated_by: who.uid })
    .eq('id', id).eq('ranch_id', who.ranchId).is('retired_at', null).select(LOT_COLUMNS_BASE)
  const { error } = ret
  const data = ret.data as LotRow[] | null
  if (error) return { ok: false, status: 500, error: error.message ?? 'Could not save the bunch.' }
  if (!data?.length) return { ok: false, status: 404, error: 'That bunch is no longer on the ranch.' }
  return { ok: true, lot: rowToLot(data[0] as LotRow) }
}
