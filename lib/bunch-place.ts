// ─── Block 25 (ruling 2): a move sets the bunch's place ──────────────────────
// herd_lots.place_id is "moved only by a real move event" (069). This is that
// write, made in the same request that saves the move, on the caller's own
// client — the standing membership policy on herd_lots is the gate, as for any
// other bunch edit.
//
// ONLY THE LATEST MOVE PLACES A BUNCH. A move recorded at a gate with no signal
// can arrive after a newer one sent from another phone, and a move can be
// back-dated; neither may drag the bunch back to where it used to be. Asked of
// the ledger, by the move's own time — never by the order things arrived in.
//
// It is safe to run twice: a retry of a move that already landed runs it again
// and finds the bunch already there.
import type { SupabaseClient } from '@supabase/supabase-js'
import { effective } from '@/lib/ledger-effective'

export type Placed = 'placed' | 'already_there' | 'not_the_latest_move' | 'no_destination' | 'failed'

export async function placeBunchFromMove(
  supabase: SupabaseClient, userId: string,
  move: { ts: string; lotId: string | null; toPlaceId: string | null },
): Promise<Placed> {
  if (!move.lotId || !move.toPlaceId) return 'no_destination'
  const { data: later, error: laterErr } = await effective(supabase.from('events').select('id').eq('type', 'cattle_moved'))
    .eq('payload->>herd_lot_id', move.lotId).not('payload->>to_place_id', 'is', null).gt('ts', move.ts).limit(1)
  if (laterErr) return 'failed'
  if ((later ?? []).length > 0) return 'not_the_latest_move'
  const { data: lot, error: lotErr } = await supabase.from('herd_lots').select('id, place_id').eq('id', move.lotId).maybeSingle()
  if (lotErr || !lot) return 'failed'
  if ((lot as { place_id: string | null }).place_id === move.toPlaceId) return 'already_there'
  const { data: done, error } = await supabase.from('herd_lots')
    .update({ place_id: move.toPlaceId, updated_by: userId }).eq('id', move.lotId).select('id')
  return error || (done ?? []).length === 0 ? 'failed' : 'placed'
}
