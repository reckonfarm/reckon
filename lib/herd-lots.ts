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

const LOT_COLUMNS = 'id, ranch_id, class, name, head_count, avg_weight, weight_unit, frame, weaned, sale_windows, created_at, updated_at, retired_at, updated_by, place_id'

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
  const { data } = await liveOnly(supabase.from('herd_lots').select(LOT_COLUMNS).eq('ranch_id', who.ranchId).is('retired_at', null)).order('created_at', { ascending: true })
  return withPurpose(supabase, ((data ?? []) as LotRow[]).map(rowToLot))
}

// …but a name must resolve for any lot the ledger ever fed, retired or not.
export async function getRanchLotsIncludingRetired(supabase: SupabaseClient, userId?: string): Promise<Lot[]> {
  const who = await ranchOf(supabase, userId)
  if (!who) return []
  // Retired lots still resolve a name; TRASHED ones do not — the trash is invisible everywhere but /account/trash.
  const { data } = await liveOnly(supabase.from('herd_lots').select(LOT_COLUMNS).eq('ranch_id', who.ranchId)).order('created_at', { ascending: true })
  return withPurpose(supabase, ((data ?? []) as LotRow[]).map(rowToLot))
}

// ─── Block 12 (12.6): a head count is history ─────────────────────────────────
// The lot form used to write head_count and nothing else, so the ledger had
// holes exactly where a person had typed over the number. Every change is a
// row now: head_count_set { lot_id, head_before, head_after, reason }. With
// 066 applied, the database rebuilds the column FROM these rows and from the
// group actions after them — so the row is written first, and the direct
// column write below is the same value, kept for a database without 066.
// Written on the caller's own client: the 043 insert policy is the gate.
async function recordHeadCountSet(supabase: SupabaseClient, uid: string, ranchId: string, lotId: string, before: number | null, after: number, reason: 'created' | 'edit'): Promise<string | null> {
  const { error } = await supabase.from('events').insert({
    user_id: uid, ranch_id: ranchId, device_id: null, type: 'head_count_set', ts: new Date().toISOString(), schema_version: 1,
    payload: { source: 'manual', schema_version: 1, lot_id: lotId, head_before: before, head_after: after, reason },
  })
  return error ? error.message : null
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
  const { data, error } = await supabase.from('herd_lots').insert({
    ranch_id: who.ranchId, class: l.class, name: l.name ?? null, head_count: l.head_count, avg_weight: l.avg_weight,
    weight_unit: l.weight_unit, frame: l.frame, weaned: l.weaned, sale_windows: l.sale_windows, created_by: who.uid, updated_by: who.uid,
    ...(placeId ? { place_id: placeId } : {}),
    ...(l.purpose && (await lotPurposeSupported(supabase)) ? { purpose: l.purpose } : {}),
  }).select(LOT_COLUMNS).single()
  if (error || !data) return { ok: false, status: 500, error: error?.message ?? 'Could not save the lot.' }
  const created = data as LotRow
  const ledgerErr = await recordHeadCountSet(supabase, who.uid, who.ranchId, created.id, null, created.head_count, 'created')
  if (ledgerErr) return { ok: false, status: 500, error: 'The bunch was saved but its count could not be written to the record — open it and set the count again.' }
  return { ok: true, lot: (await withPurpose(supabase, [rowToLot(created)]))[0] }
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
  const { data, error } = await q.select(LOT_COLUMNS)
  if (error) return { ok: false, status: 500, error: error.message }
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
    return { ok: true, lot: (await withPurpose(supabase, [rowToLot(data[0] as LotRow)]))[0] }
  }
  // Nothing moved: distinguish "gone" from "changed under you". The words for
  // both live in lib/stale-edit.ts now, so places inherits them verbatim
  // instead of growing a second dialect of the same sentence.
  const { data: current } = await supabase.from('herd_lots').select(LOT_COLUMNS).eq('id', id).maybeSingle()
  if (!current || (current as LotRow).retired_at) return { ok: false, status: 404, error: retiredWhileOpen('bunch') }
  const row = current as LotRow
  return { ok: false, ...(await staleEdit('bunch', row)) }
}

// Retire — the lot leaves the pickers and the estimate; its name still resolves.
export async function retireLot(supabase: SupabaseClient, id: string): Promise<LotWrite> {
  const who = await ranchOf(supabase)
  if (!who) return { ok: false, status: 403, error: 'You are not on a ranch yet.' }
  const { data, error } = await supabase.from('herd_lots').update({ retired_at: new Date().toISOString(), retired_by: who.uid, updated_by: who.uid })
    .eq('id', id).eq('ranch_id', who.ranchId).is('retired_at', null).select(LOT_COLUMNS)
  if (error) return { ok: false, status: 500, error: error.message }
  if (!data?.length) return { ok: false, status: 404, error: 'That lot is no longer on the ranch.' }
  return { ok: true, lot: rowToLot(data[0] as LotRow) }
}
