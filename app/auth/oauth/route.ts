import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

// OAuth (PKCE) callback. signInWithOAuth() sends the user to Google, which
// returns here with a `code`. We exchange it for a session.
//
// IMPORTANT: the exchange MUST use the cookie-bound anon SSR client
// (createClient from lib/supabase-server) — it reads the PKCE code-verifier
// cookie and WRITES the session cookies. The try/catch in that client's
// cookie adapter only swallows the RSC write error; in a Route Handler
// cookies().set() succeeds, so the session cookies are written to the
// response (including this redirect). The service client is used only for
// the profile upsert, never for the session exchange.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // Guard against open redirects: only allow same-origin relative paths.
  const nextParam = searchParams.get('next')
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/watchlist'

  if (!code) {
    return NextResponse.redirect(`${origin}/signin?error=oauth`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/signin?error=oauth`)
  }

  // Ensure a profile row exists (mirrors POST /api/auth/sync). Lazy upsert —
  // there is no DB trigger creating profiles.
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const db = createServiceClient()
    await db.from('profiles').upsert(
      { id: user.id, email: user.email! },
      { onConflict: 'id' },
    )
  }

  return NextResponse.redirect(`${origin}${next}`)
}
