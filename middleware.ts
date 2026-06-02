import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

// Resolve the county a logged-in user's dashboard should open to by default:
// their Home county first, then their most-recently saved county. Uses the
// service role (RLS-independent, matching the rest of the app's reads). Returns
// null if they have neither, so brand-new users still get the empty state.
// home_county_fips may not exist until migration 013 runs — that query failing
// just falls through to the watchlist, so this is safe pre-migration.
async function resolveDefaultFips(userId: string): Promise<string | null> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  try {
    const { data: profile } = await db
      .from('profiles')
      .select('home_county_fips')
      .eq('id', userId)
      .maybeSingle()
    if (profile?.home_county_fips) return profile.home_county_fips
  } catch {
    // home_county_fips column absent (pre-migration) — fall through to watchlist.
  }

  try {
    const { data: watch } = await db
      .from('user_watchlist')
      .select('counties(fips)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const fips = (watch?.counties as unknown as { fips: string } | null)?.fips
    return fips ?? null
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Refresh session — do not add logic between createServerClient and getUser().
  const { data: { user } } = await supabase.auth.getUser()

  // Bare /dashboard for a logged-in user → open their Home (or most-recent saved)
  // county. Done here, not in the page, because the middleware holds the refreshed
  // session and can redirect the document request reliably. Must carry over the
  // refreshed auth cookies onto the redirect response.
  if (user && request.nextUrl.pathname === '/dashboard' && !request.nextUrl.searchParams.has('fips')) {
    const fips = await resolveDefaultFips(user.id)
    if (fips) {
      const dest = request.nextUrl.clone()
      dest.searchParams.set('fips', fips)
      const redirectResponse = NextResponse.redirect(dest)
      supabaseResponse.cookies.getAll().forEach(c => redirectResponse.cookies.set(c))
      return redirectResponse
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
