import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

// Block 31 — does this person belong to a ranch? One indexed read on the
// service key (middleware has no user-scoped client; ranch_members_user_idx
// serves it). The answer decides the one redirect below.
async function hasRanch(userId: string): Promise<{ member: boolean; said: string }> {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    const { data, error } = await db.from('ranch_members').select('ranch_id').eq('user_id', userId).limit(1)
    // The read failed: never trap a member on /setup for a hiccup — but SAY so
    // on the response, so a redirect that did not happen can be read back.
    if (error) return { member: true, said: `error:${error.code ?? ''}:${error.message.slice(0, 60)}` }
    return { member: (data ?? []).length > 0, said: (data ?? []).length > 0 ? 'member' : 'no-ranch' }
  } catch (e) {
    return { member: true, said: `threw:${e instanceof Error ? e.message.slice(0, 60) : String(e)}` }
  }
}
// The screens that are a ranch's. A person with none is sent to set one up
// instead of being shown an empty state that reads as a working ranch.
const RANCH_PATHS = /^\/(today|ranch|markets|weather|account|jobs|hay)(\/|$)/

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

  // Block 31 — no screen pretends a ranch exists. Signed in and on a ranch
  // screen with no ranch → the one setup screen; on /setup with a ranch →
  // Today. Public county pages (?fips=) and the invite landing are never
  // touched: an invited person has no ranch until they accept. The read's
  // answer rides on the response (x-dryline-ranch), so a redirect that did
  // not happen can be read back.
  if (user && !request.nextUrl.searchParams.has('fips')) {
    const path = request.nextUrl.pathname
    const onSetup = path === '/setup'
    if (onSetup || RANCH_PATHS.test(path)) {
      const { member, said } = await hasRanch(user.id)
      supabaseResponse.headers.set('x-dryline-ranch', said)
      if (onSetup ? member : !member) {
        const dest = request.nextUrl.clone()
        dest.pathname = onSetup ? '/today' : '/setup'
        dest.search = ''
        const redirectResponse = NextResponse.redirect(dest)
        redirectResponse.headers.set('x-dryline-ranch', said)
        supabaseResponse.cookies.getAll().forEach(c => redirectResponse.cookies.set(c))
        return redirectResponse
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
