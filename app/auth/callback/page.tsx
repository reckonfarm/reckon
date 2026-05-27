'use client'

// Implicit flow: Supabase sends token_hash in the callback URL.
// No code_verifier cookie is needed, so this works in any browser
// context including Mail app on iOS Safari (fresh tab, no prior cookies).

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [authError, setAuthError] = useState<string | null>(null)

  useEffect(() => {
    const params     = new URLSearchParams(window.location.search)
    const token_hash = params.get('token_hash')
    const type       = params.get('type')
    const next       = params.get('next') ?? '/watchlist'

    async function exchange() {
      if (!token_hash || !type) {
        setAuthError('Invalid sign-in link. Please request a new one.')
        return
      }

      const supabase = createClient()
      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type: type as Parameters<typeof supabase.auth.verifyOtp>[0]['type'],
      })

      if (error) {
        console.error('[auth/callback] verifyOtp:', error.message)
        setAuthError('This sign-in link has expired or already been used. Please request a new one.')
        return
      }

      // Upsert the profile row server-side (needs service client to bypass RLS).
      await fetch('/api/auth/sync', { method: 'POST' }).catch(() => {})

      router.replace(next)
    }

    exchange()
  }, [router])

  if (authError) {
    return (
      <>
        <SiteHeader />
        <main className="flex min-h-screen items-center justify-center bg-cream px-4">
          <div className="w-full max-w-sm text-center">
            <p className="font-fraunces text-xl font-semibold text-forest-green">
              Sign-in link invalid
            </p>
            <p className="mt-2 font-dm-sans text-sm text-forest-green/60">
              {authError}
            </p>
            <Link
              href="/signin"
              className="mt-5 inline-block rounded-lg bg-forest-green px-5 py-2.5 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 transition-colors"
            >
              Back to sign in
            </Link>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <SiteHeader />
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <p className="font-dm-sans text-sm text-forest-green/60">Signing you in…</p>
      </main>
    </>
  )
}
