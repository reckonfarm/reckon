'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'

const INPUT_CLS =
  'w-full rounded-lg border border-forest-green/20 bg-white px-4 py-3 font-dm-sans text-sm text-forest-green placeholder:text-forest-green/30 focus:border-forest-green/50 focus:outline-none'

const BTN_CLS =
  'w-full rounded-lg bg-forest-green px-4 py-3 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors'

export default function UpdatePasswordPage() {
  const router = useRouter()
  const [ready, setReady]       = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // The recovery link is verified by /auth/callback, which establishes a
  // session before redirecting here. Confirm we actually have one.
  useEffect(() => {
    const supabase = createClient()
    // Local session read (getSession) — the recovery session was established by
    // /auth/callback. Avoids the network getUser() that can hang on the auth lock.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session)
      setReady(true)
    }).catch(() => setReady(true))
  }, [])

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) { setError(error.message); return }
    router.replace('/watchlist')
  }

  return (
    <>
      <SiteHeader />
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <div className="w-full max-w-sm">
          {!ready ? (
            <p className="font-dm-sans text-sm text-forest-green/60">Loading…</p>
          ) : !hasSession ? (
            <>
              <p className="font-fraunces text-xl font-semibold text-forest-green">
                Reset link invalid
              </p>
              <p className="mt-2 font-dm-sans text-sm text-forest-green/60">
                This password reset link has expired or already been used.
              </p>
              <Link
                href="/auth/reset"
                className="mt-5 inline-block rounded-lg bg-forest-green px-5 py-2.5 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 transition-colors"
              >
                Request a new link
              </Link>
            </>
          ) : (
            <>
              <p className="font-fraunces text-2xl font-semibold text-forest-green">
                Set a new password
              </p>
              <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
                Choose a new password for your account.
              </p>
              <form onSubmit={updatePassword} className="mt-6 space-y-3">
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="New password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  autoFocus
                  className={INPUT_CLS}
                />
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  className={INPUT_CLS}
                />
                {error && <p className="font-dm-sans text-sm text-rust">{error}</p>}
                <button type="submit" disabled={loading} className={BTN_CLS}>
                  {loading ? 'Saving…' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </>
  )
}
