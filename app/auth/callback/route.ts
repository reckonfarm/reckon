import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code       = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type       = searchParams.get('type')

  // DEBUG — remove after diagnosing auth flow
  console.log('[auth/callback] all params:', Object.fromEntries(searchParams.entries()))
  console.log('[auth/callback] code present:', !!code)
  console.log('[auth/callback] token_hash present:', !!token_hash, '| type:', type)
  console.log('[auth/callback] incoming cookies:', request.cookies.getAll().map(c => c.name))

  const response = NextResponse.redirect(new URL('/watchlist', request.url))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          // DEBUG — remove after diagnosing
          console.log('[auth/callback] setting cookies:', cookiesToSet.map(c => c.name))
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  if (code) {
    console.log('[auth/callback] attempting exchangeCodeForSession')
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    console.log('[auth/callback] exchangeCodeForSession result — error:', error?.message ?? null, '| user:', data?.user?.email ?? null)

    if (!error && data.user) {
      const db = createServiceClient()
      await db.from('profiles').upsert(
        { id: data.user.id, email: data.user.email! },
        { onConflict: 'id' },
      )
    }
  } else if (token_hash && type) {
    console.log('[auth/callback] attempting verifyOtp with token_hash, type:', type)
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as Parameters<typeof supabase.auth.verifyOtp>[0]['type'],
    })
    console.log('[auth/callback] verifyOtp result — error:', error?.message ?? null, '| user:', data?.user?.email ?? null)

    if (!error && data.user) {
      const db = createServiceClient()
      await db.from('profiles').upsert(
        { id: data.user.id, email: data.user.email! },
        { onConflict: 'id' },
      )
    }
  } else {
    console.log('[auth/callback] WARNING: neither code nor token_hash present — no session established')
  }

  console.log('[auth/callback] redirecting to:', response.headers.get('location'))
  return response
}
