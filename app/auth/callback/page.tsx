'use client'

// Implicit flow: Supabase sends token_hash in the callback URL.
// No code_verifier cookie is needed, so this works in any browser
// context including Mail app on iOS Safari (fresh tab, no prior cookies).

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'

// DEBUG BUILD — remove before final launch
export default function AuthCallbackPage() {
  const router = useRouter()
  const [authError, setAuthError]   = useState<string | null>(null)
  const [debugInfo, setDebugInfo]   = useState<Record<string, string>>({})
  const [exchangeDone, setExchangeDone] = useState(false)

  useEffect(() => {
    const params     = new URLSearchParams(window.location.search)
    const token_hash = params.get('token_hash')
    const type       = params.get('type')
    const code       = params.get('code')
    const next       = params.get('next') ?? '/watchlist'

    // Capture everything visible in the URL for the on-screen debug panel
    const all: Record<string, string> = {}
    params.forEach((v, k) => { all[k] = k === 'token_hash' ? `${v.slice(0, 12)}…` : v })
    all['window.location.href (path+search)'] = window.location.pathname + window.location.search
    all['hash present'] = window.location.hash ? 'YES — ' + window.location.hash.slice(0, 40) : 'no'
    setDebugInfo(all)

    async function exchange() {
      if (!token_hash || !type) {
        setAuthError(`Missing params — token_hash: ${token_hash ?? 'null'}, type: ${type ?? 'null'}, code: ${code ?? 'null'}`)
        setExchangeDone(true)
        return
      }

      const supabase = createClient()
      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type: type as Parameters<typeof supabase.auth.verifyOtp>[0]['type'],
      })

      setExchangeDone(true)

      if (error) {
        setAuthError(`verifyOtp error: ${error.message} (status: ${error.status ?? 'n/a'})`)
        return
      }

      await fetch('/api/auth/sync', { method: 'POST' }).catch(() => {})
      router.replace(next)
    }

    exchange()
  }, [router])

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 py-10">
        <p className="font-fraunces text-lg font-semibold text-forest-green mb-4">
          {exchangeDone ? (authError ? 'Auth failed' : 'Auth succeeded — redirecting…') : 'Signing you in…'}
        </p>

        {/* DEBUG: URL params received */}
        <div className="rounded-lg border border-forest-green/20 bg-white p-4 mb-4">
          <p className="text-xs font-semibold text-forest-green/50 font-dm-sans mb-2">URL PARAMS RECEIVED</p>
          {Object.entries(debugInfo).length === 0 ? (
            <p className="text-xs font-dm-sans text-forest-green/40">reading…</p>
          ) : (
            Object.entries(debugInfo).map(([k, v]) => (
              <p key={k} className="text-xs font-dm-sans text-forest-green break-all">
                <span className="font-semibold">{k}:</span> {v}
              </p>
            ))
          )}
        </div>

        {/* DEBUG: exchange result */}
        {exchangeDone && (
          <div className={`rounded-lg border p-4 mb-4 ${authError ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
            <p className="text-xs font-semibold font-dm-sans mb-1" style={{ color: authError ? '#b91c1c' : '#166534' }}>
              EXCHANGE RESULT
            </p>
            <p className="text-xs font-dm-sans break-all" style={{ color: authError ? '#b91c1c' : '#166534' }}>
              {authError ?? 'verifyOtp succeeded'}
            </p>
          </div>
        )}

        {authError && (
          <Link
            href="/signin"
            className="inline-block rounded-lg bg-forest-green px-5 py-2.5 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 transition-colors"
          >
            Back to sign in
          </Link>
        )}
      </main>
    </>
  )
}
