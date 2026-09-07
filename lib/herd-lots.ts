import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveRanchId } from './ranch-membership'
import type { Lot } from './herd'

// ─── The ranch's cattle lots (Block 4A) ─────────────────────────────────────────
// THE one read every ledger line, picker, and estimate uses to know what lots
// exist. Lots live on the RANCH's operation_profiles row (050: ranch_id, one row
// per ranch, membership policies), so a hand sees the same lots the owner does
// and a hand's feeding keeps its lot name for everyone. Reads on the USER-SCOPED
// client: the membership policy is the gate, and a person on no ranch falls back
// to a row of their own (the pre-050 shape), which the policy no longer exposes —
// that is the honest answer for someone outside every ranch.
export async function getRanchLots(supabase: SupabaseClient, userId?: string): Promise<Lot[]> {
  const uid = userId ?? (await supabase.auth.getUser()).data.user?.id
  if (!uid) return []
  const ranchId = await resolveRanchId(supabase, uid)
  const q = supabase.from('operation_profiles').select('herd')
  const { data } = await (ranchId ? q.eq('ranch_id', ranchId) : q.eq('user_id', uid)).maybeSingle()
  const lots = (data as { herd?: { lots?: Lot[] } | null } | null)?.herd?.lots
  return Array.isArray(lots) ? lots : []
}
