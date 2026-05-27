'use client'

// Client-side exchange is required for Safari (ITP).
// A server-side Route Handler that sets cookies on a 302 response fails on
// Safari because the response arrives via a cross-origin redirect chain
// (supabase.co → reckon.farm). Safari treats those Set-Cookie headers as
// third-party and drops them. Calling exchangeCodeForSession from JavaScript
// on the first-party page writes cookies via document.cookie, which Safari
// accepts unconditionally.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code       = params.get('code')
    const token_hash = params.get('token_hash')
    const type       = params.get('type')
    const next       = params.get('next') ?? '/watchlist'

    async function exchange() {
      const supabase = createClient()

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) console.error('[auth/callback] exchangeCodeForSession:', error.message)
      } else if (token_hash && type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash,
          type: type as Parameters<typeof supabase.auth.verifyOtp>[0]['type'],
        })
        if (error) console.error('[auth/callback] verifyOtp:', error.message)
      }

      // Upsert the profile row server-side (needs service client to bypass RLS).
      await fetch('/api/auth/sync', { method: 'POST' }).catch(() => {})

      router.replace(next)
    }

    exchange()
  }, [router])

  return (
    <>
      <SiteHeader />
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <p className="font-dm-sans text-sm text-forest-green/60">Signing you in…</p>
      </main>
    </>
  )
}
