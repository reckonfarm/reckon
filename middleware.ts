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

  // Block 6A — the signed-in home is /today. A signed-in person opening the app
  // at bare / (the PWA start_url), /home (old bookmark), or bare /dashboard lands
  // there in ONE hop with the refreshed session (a config redirect cannot see a
  // session; a Server Component's getUser() can miss exactly this cold-start
  // case). Loop guards, none to loosen: a fips param means a county page was
  // opened on purpose and is NEVER redirected (public information context, for
  // everyone); /today itself is never touched; anonymous visitors fall through
  // to the public homepage funnel.
  if (
    user &&
    (request.nextUrl.pathname === '/' || request.nextUrl.pathname === '/home' || request.nextUrl.pathname === '/dashboard') &&
    !request.nextUrl.searchParams.has('fips')
  ) {
    const dest = request.nextUrl.clone()
    dest.pathname = '/today'
    dest.search = ''
    const redirectResponse = NextResponse.redirect(dest)
    supabaseResponse.cookies.getAll().forEach(c => redirectResponse.cookies.set(c))
    return redirectResponse
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
