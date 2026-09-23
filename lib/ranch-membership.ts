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
// ONE lookup per request, not one per read. Twenty-one files call this, and a
// page calls several of them: measured 2026-09-24 on PK's own ranch, the Ranch
// page asked ranch_members this same question SIX times in one render — six of
// its twenty-five round-trips — and Cattle and Markets three each.
//
// The memo hangs off the client rather than a request store, because the client
// IS the request: `createClient()` builds one per request from that request's
// cookies, so a new request arrives with a new client and a cold memo, with no
// plumbing to thread and nothing to reset. A long-lived client — a script, a
// cron — keeps its answer for its life, which is what you want: membership does
// not change under a running job. The PROMISE is stored, not the value, so two
// reads that start together share one query instead of racing; a rejected
// lookup is dropped, so a failure is never cached.
const ranchIdMemo = new WeakMap<SupabaseClient, Map<string, Promise<string | null>>>()

export async function resolveRanchId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  let byUser = ranchIdMemo.get(supabase)
  if (!byUser) { byUser = new Map(); ranchIdMemo.set(supabase, byUser) }
  const seen = byUser.get(userId)
  if (seen) return seen
  const pending = (async () => {
    const { data } = await supabase
      .from('ranch_members')
      .select('ranch_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    return (data?.ranch_id as string | undefined) ?? null
  })()
  byUser.set(userId, pending)
  pending.catch(() => byUser!.delete(userId))
  return pending
}

export interface Ranch {
  id: string
  name: string
}

// The outfit itself — id + name — for the signed-in person, or null when they
// belong to none. Same first-membership rule as resolveRanchId; the name comes
// through the "member ranches readable" policy (034) on the USER-SCOPED client,
// embedded off ranch_members' FK. An empty or whitespace name reads as no name:
// the dashboard never shows a placeholder, it falls back to the county.
export async function getRanch(
  supabase: SupabaseClient,
  userId: string,
): Promise<Ranch | null> {
  const { data } = await supabase
    .from('ranch_members')
    .select('ranch_id, ranches(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data?.ranch_id) return null
  const rel = data.ranches as { name?: unknown } | { name?: unknown }[] | null
  const raw = Array.isArray(rel) ? rel[0]?.name : rel?.name
  const name = typeof raw === 'string' ? raw.trim() : ''
  return { id: data.ranch_id as string, name }
}

// A name is an identity, not a fact: bounded so it can't swallow the h1.
export const RANCH_NAME_MAX = 60
