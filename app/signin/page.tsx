'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'

const INPUT_CLS =
  'w-full rounded-lg border border-forest-green/20 bg-white px-4 py-3 font-dm-sans text-sm text-forest-green placeholder:text-forest-green/30 focus:border-forest-green/50 focus:outline-none'

const BTN_CLS =
  'w-full rounded-lg bg-forest-green px-4 py-3 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors'

export default function SignInPage() {
  const router = useRouter()
  const [step, setStep]       = useState<'email' | 'code'>('email')
  const [email, setEmail]     = useState('')
  const [code, setCode]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    // No emailRedirectTo — omitting it triggers a 6-digit OTP code email
    // instead of a magic link, which works in any browser context on iOS.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })

    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setStep('code')
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    })

    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }

    await fetch('/api/auth/sync', { method: 'POST' }).catch(() => {})
    router.replace('/watchlist')
  }

  if (step === 'code') {
    return (
      <>
        <SiteHeader />
        <main className="flex min-h-screen items-center justify-center bg-cream px-4">
          <div className="w-full max-w-sm">
            <p className="font-fraunces text-2xl font-semibold text-forest-green">
              Check your email
            </p>
            <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
              We sent a 6-digit code to{' '}
              <strong className="text-forest-green">{email}</strong>.
            </p>

            <form onSubmit={verifyCode} className="mt-6 space-y-3">
              <div>
                <label className="block mb-1 text-xs font-medium text-forest-green/60 font-dm-sans">
                  Enter the code from your email
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  required
                  autoFocus
                  className="w-full rounded-lg border border-forest-green/20 bg-white px-4 py-3 font-dm-sans text-2xl font-semibold tracking-[0.35em] text-forest-green text-center placeholder:text-forest-green/20 placeholder:font-normal placeholder:text-base placeholder:tracking-normal focus:border-forest-green/50 focus:outline-none"
                />
              </div>
              {error && (
                <p className="font-dm-sans text-sm text-rust">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading || code.length < 6}
                className={BTN_CLS}
              >
                {loading ? 'Verifying…' : 'Sign in'}
              </button>
            </form>

            <button
              onClick={() => { setStep('email'); setCode(''); setError(null) }}
              className="mt-4 inline-block font-dm-sans text-sm text-forest-green/50 hover:text-forest-green"
            >
              ← Use a different email
            </button>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <SiteHeader />
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <div className="w-full max-w-sm">
          <p className="font-fraunces text-2xl font-semibold text-forest-green">
            Sign in to Reckon
          </p>
          <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
            We&apos;ll send a 6-digit code to your email.
          </p>

          <form onSubmit={sendCode} className="mt-6 space-y-3">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              className={INPUT_CLS}
            />
            {error && (
              <p className="font-dm-sans text-sm text-rust">{error}</p>
            )}
            <button type="submit" disabled={loading} className={BTN_CLS}>
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>

          <Link
            href="/"
            className="mt-6 inline-block font-dm-sans text-sm text-forest-green/50 hover:text-forest-green"
          >
            ← Back to Reckon
          </Link>
        </div>
      </main>
    </>
  )
}
