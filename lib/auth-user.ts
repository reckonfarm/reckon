import 'server-only'
import { createClient as createSupabase, type SupabaseClient, type User } from '@supabase/supabase-js'
import { createClient as createCookieClient } from './supabase-server'

// ─── The signed-in person behind a request ────────────────────────────────────
// The app carries its session in cookies (lib/supabase-server). A machine
// caller — the isolation suite — carries the same Supabase session as a Bearer
// JWT. Both go through Supabase Auth's verification; both come back as a
// USER-SCOPED client, so every read a route makes to prove membership runs
// under RLS, never the service role.
export interface Session { user: User; supabase: SupabaseClient }

export async function sessionUser(req: Request): Promise<Session | null> {
  const cookieClient = await createCookieClient()
  const { data: { user } } = await cookieClient.auth.getUser()
  if (user) return { user, supabase: cookieClient }

  const auth = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(auth)
  if (!m) return null
  const jwt = m[1].trim()
  const bearerClient = createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { autoRefreshToken: false, persistSession: false } },
  )
  const { data: { user: bearerUser } } = await bearerClient.auth.getUser(jwt)
  return bearerUser ? { user: bearerUser, supabase: bearerClient } : null
}
