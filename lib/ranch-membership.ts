import type { SupabaseClient } from '@supabase/supabase-js'

// Which outfit a signed-in person writes for. Reads ranch_members on the
// USER-SCOPED client — the "own membership readable" policy (034) lets a
// person see exactly their own rows, which is all this needs. First
// membership by created_at when there are several.
//
// Null is a valid answer: an unstamped row inserts with ranch_id null and the
// user_id leg of the RLS policies keeps it owner-visible. Never fail a write
// because the ranch lookup came back empty — the ledger row matters more
// than its scope stamp (the same stance ingest takes with an unstamped
// device at app/api/ingest/route.ts).
export async function resolveRanchId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('ranch_members')
    .select('ranch_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.ranch_id ?? null
}
