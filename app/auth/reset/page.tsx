'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'

const INPUT_CLS =
  'w-full rounded-lg border border-forest-green/20 bg-white px-4 py-3 font-dm-sans text-sm text-forest-green placeholder:text-forest-green/30 focus:border-forest-green/50 focus:outline-none'

const BTN_CLS =
  'w-full rounded-lg bg-forest-green px-4 py-3 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors'

export default function ResetPasswordPage() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [sent, setSent]       = useState(false)

  async function sendReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // The recovery link returns through the existing callback page, which
      // verifies the token and lands the user on /auth/update-password.
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    setSent(true)
  }

  return (
    <>
      <SiteHeader />
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <div className="w-full max-w-sm">
          {sent ? (
            <>
              <p className="font-fraunces text-2xl font-semibold text-forest-green">
                Check your email
              </p>
              <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
                If an account exists for{' '}
                <strong className="text-forest-green">{email}</strong>, we sent a
                link to reset your password.
              </p>
              <Link
                href="/signin"
                className="mt-6 inline-block font-dm-sans text-sm text-forest-green/50 hover:text-forest-green transition-colors"
              >
                ← Back to sign in
              </Link>
            </>
          ) : (
            <>
              <p className="font-fraunces text-2xl font-semibold text-forest-green">
                Reset your password
              </p>
              <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
                Enter your email and we&apos;ll send you a reset link.
              </p>
              <form onSubmit={sendReset} className="mt-6 space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  autoFocus
                  className={INPUT_CLS}
                />
                {error && <p className="font-dm-sans text-sm text-rust">{error}</p>}
                <button type="submit" disabled={loading} className={BTN_CLS}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
              <Link
                href="/signin"
                className="mt-6 inline-block font-dm-sans text-sm text-forest-green/50 hover:text-forest-green transition-colors"
              >
                ← Back to sign in
              </Link>
            </>
          )}
        </div>
      </main>
    </>
  )
}
