import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveRanchId } from './ranch-membership'
import { normalizeLot, type Lot } from './herd'

// ─── The ranch's cattle lots — real rows (Block 4B, migration 051) ─────────────
// One row per lot on herd_lots, membership-gated (043 shape). Two members
// editing DIFFERENT lots touch different rows; a same-lot edit carries the
// updated_at the editor last saw and is refused (409) when the row moved on.
// Lots are RETIRED, never deleted, so a feeding logged against one keeps its
// name forever. Every read and write here runs on the USER-SCOPED client — the
// policy is the gate; user ids are recorded as authorship, never as grants.

const LOT_COLUMNS = 'id, ranch_id, class, name, head_count, avg_weight, weight_unit, frame, weaned, sale_windows, created_at, updated_at, retired_at'

interface LotRow {
  id: string; ranch_id: string; class: Lot['class']; name: string | null; head_count: number; avg_weight: number | string
  weight_unit: Lot['weight_unit']; frame: Lot['frame']; weaned: boolean; sale_windows: Lot['sale_windows'] | null
  created_at: string; updated_at: string; retired_at: string | null
}

function rowToLot(r: LotRow): Lot {
  return {
    id: r.id, class: r.class, head_count: r.head_count, avg_weight: Number(r.avg_weight), weight_unit: r.weight_unit,
    frame: r.frame, weaned: r.weaned, sale_windows: Array.isArray(r.sale_windows) ? r.sale_windows : [],
    ...(r.name ? { name: r.name } : {}), created_at: r.created_at, updated_at: r.updated_at,
  }
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
  const { data } = await supabase.from('herd_lots').select(LOT_COLUMNS).eq('ranch_id', who.ranchId).is('retired_at', null).order('created_at', { ascending: true })
  return ((data ?? []) as LotRow[]).map(rowToLot)
}

// …but a name must resolve for any lot the ledger ever fed, retired or not.
export async function getRanchLotsIncludingRetired(supabase: SupabaseClient, userId?: string): Promise<Lot[]> {
  const who = await ranchOf(supabase, userId)
  if (!who) return []
  const { data } = await supabase.from('herd_lots').select(LOT_COLUMNS).eq('ranch_id', who.ranchId).order('created_at', { ascending: true })
  return ((data ?? []) as LotRow[]).map(rowToLot)
}

export type LotWrite =
  | { ok: true; lot: Lot }
  | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string }

// Create — the row is the ranch's; created_by / updated_by record who.
export async function createLot(supabase: SupabaseClient, raw: unknown): Promise<LotWrite> {
  const who = await ranchOf(supabase)
  if (!who) return { ok: false, status: 403, error: 'You are not on a ranch yet.' }
  const n = normalizeLot(raw)
  if (!n.ok) return { ok: false, status: 400, error: n.error }
  const l = n.lot
  const { data, error } = await supabase.from('herd_lots').insert({
    ranch_id: who.ranchId, class: l.class, name: l.name ?? null, head_count: l.head_count, avg_weight: l.avg_weight,
    weight_unit: l.weight_unit, frame: l.frame, weaned: l.weaned, sale_windows: l.sale_windows, created_by: who.uid, updated_by: who.uid,
  }).select(LOT_COLUMNS).single()
  if (error || !data) return { ok: false, status: 500, error: error?.message ?? 'Could not save the lot.' }
  return { ok: true, lot: rowToLot(data as LotRow) }
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
  let q = supabase.from('herd_lots').update({
    class: l.class, name: l.name ?? null, head_count: l.head_count, avg_weight: l.avg_weight, weight_unit: l.weight_unit,
    frame: l.frame, weaned: l.weaned, sale_windows: l.sale_windows, updated_by: who.uid,
  }).eq('id', id).eq('ranch_id', who.ranchId).is('retired_at', null)
  if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt)
  const { data, error } = await q.select(LOT_COLUMNS)
  if (error) return { ok: false, status: 500, error: error.message }
  if (data && data.length === 1) return { ok: true, lot: rowToLot(data[0] as LotRow) }
  // Nothing moved: distinguish "gone" from "changed under you".
  const { data: current } = await supabase.from('herd_lots').select(LOT_COLUMNS).eq('id', id).maybeSingle()
  if (!current || (current as LotRow).retired_at) return { ok: false, status: 404, error: 'That lot is no longer on the ranch.' }
  return { ok: false, status: 409, error: 'Someone else changed this lot since you opened it. Reload to see their version, then make your change.' }
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
