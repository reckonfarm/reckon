import type { SupabaseClient } from '@supabase/supabase-js'

// ─── The ledger stamp (Block 32) ──────────────────────────────────────────────
// Every page that paints a number out of the record stamps WHAT IT READ: the
// newest ingested_at on the ranch at the moment the render began. The number
// on a page is only as fresh as the render that painted it, and a receipt is
// the server's answer at the moment the record landed — two readers of one
// number at two moments. On the audit the receipt said 3,075 and Today's tile
// said 3,123: the tile's render predated the last two feedings, and nothing on
// the page could tell.
//
// The stamp is read FIRST, before any ledger read in the same render (a child
// server component starts after its parent returns), so "everything ingested
// at or before the stamp is in what you see" holds by construction. The client
// (SyncRefresh) compares the painted stamp with the records it knows have
// landed and refreshes until the page has caught up — the check-identity
// doctrine applied to freshness: prove the painted number caught up, never hope
// a refresh landed.
export const LEDGER_STAMP_AUDIT = 'ledger-through'

export async function ledgerThrough(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from('events')
    .select('ingested_at')
    .order('ingested_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { ingested_at?: string } | null)?.ingested_at ?? null
}
