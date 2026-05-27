import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')

  // Build the redirect response first so we can write session cookies onto it.
  // Using cookieStore (next/headers) instead would write to a separate response
  // object and the Set-Cookie headers would never reach the browser.
  const response = NextResponse.redirect(new URL('/watchlist', request.url))

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            )
          },
        },
      },
    )

    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && data.user) {
      const db = createServiceClient()
      await db.from('profiles').upsert(
        { id: data.user.id, email: data.user.email! },
        { onConflict: 'id' },
      )
    }
  }

  return response
}
