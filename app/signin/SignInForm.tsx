'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

const INPUT_CLS =
  'w-full rounded-lg border border-forest-green/20 bg-white px-4 py-3 font-dm-sans text-sm text-forest-green placeholder:text-forest-green/30 focus:border-forest-green/50 focus:outline-none'

const BTN_CLS =
  'w-full rounded-lg bg-forest-green px-4 py-3 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors'

const LINK_CLS =
  'font-dm-sans text-sm text-forest-green/50 hover:text-forest-green transition-colors'

// Shown only when explicitly enabled, so we can ship password without Google.
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true'

export default function SignInForm() {
  const router = useRouter()

  // Top-level method. Password is the primary path; OTP is the fallback.
  const [view, setView] = useState<'password' | 'otp'>('password')

  // Shared
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Password mode
  const [password, setPassword]       = useState('')
  const [pwMode, setPwMode]           = useState<'signin' | 'signup'>('signin')
  const [signupSent, setSignupSent]   = useState(false)

  // OTP mode (unchanged behaviour)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [code, setCode] = useState('')

  function resetMessages() {
    setError(null)
  }

  // ---- Password ----------------------------------------------------------

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    resetMessages()
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) { setError(error.message); return }
    await fetch('/api/auth/sync', { method: 'POST' }).catch(() => {})
    router.replace('/watchlist')
  }

  async function signUpPassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    resetMessages()
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Used only when "Confirm email" is ON: link returns to the existing
        // callback page, which verifies the token_hash and lands on /watchlist.
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/watchlist`,
      },
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    // Confirm email OFF → a session is returned immediately.
    if (data.session) {
      await fetch('/api/auth/sync', { method: 'POST' }).catch(() => {})
      router.replace('/watchlist')
      return
    }
    // Confirm email ON → no session yet; user must click the email link.
    setSignupSent(true)
  }

  async function signInGoogle() {
    setLoading(true)
    resetMessages()
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/oauth?next=/watchlist`,
      },
    })
    // On success the browser is redirected to Google, so we only land here on error.
    if (error) { setError(error.message); setLoading(false) }
  }

  // ---- OTP (unchanged) ---------------------------------------------------

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    setLoading(false)
    if (error) { setError(error.message) } else { setStep('code') }
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
    if (error) { setError(error.message); return }
    await fetch('/api/auth/sync', { method: 'POST' }).catch(() => {})
    router.replace('/watchlist')
  }

  // ---- OTP views (unchanged behaviour) -----------------------------------

  if (view === 'otp' && step === 'code') {
    return (
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
          {error && <p className="font-dm-sans text-sm text-rust">{error}</p>}
          <button type="submit" disabled={loading || code.length < 6} className={BTN_CLS}>
            {loading ? 'Verifying…' : 'Sign in'}
          </button>
        </form>
        <button
          onClick={() => { setStep('email'); setCode(''); setError(null) }}
          className={`mt-4 inline-block ${LINK_CLS}`}
        >
          ← Use a different email
        </button>
      </div>
    )
  }

  if (view === 'otp') {
    return (
      <div className="w-full max-w-sm">
        <p className="font-fraunces text-2xl font-semibold text-forest-green">
          Sign in to Dryline
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
          {error && <p className="font-dm-sans text-sm text-rust">{error}</p>}
          <button type="submit" disabled={loading} className={BTN_CLS}>
            {loading ? 'Sending…' : 'Send code'}
          </button>
        </form>
        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => { setView('password'); setError(null) }}
            className={LINK_CLS}
          >
            ← Use a password instead
          </button>
          <Link href="/" className={LINK_CLS}>
            Back to Dryline
          </Link>
        </div>
      </div>
    )
  }

  // ---- Password: "check your email" confirmation state -------------------

  if (signupSent) {
    return (
      <div className="w-full max-w-sm">
        <p className="font-fraunces text-2xl font-semibold text-forest-green">
          Confirm your email
        </p>
        <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
          We sent a confirmation link to{' '}
          <strong className="text-forest-green">{email}</strong>. Click it to
          finish creating your account, then you&apos;ll be signed in.
        </p>
        <button
          onClick={() => { setSignupSent(false); setPwMode('signin'); setPassword(''); setError(null) }}
          className={`mt-6 inline-block ${LINK_CLS}`}
        >
          ← Back to sign in
        </button>
      </div>
    )
  }

  // ---- Password: primary view --------------------------------------------

  const isSignup = pwMode === 'signup'

  return (
    <div className="w-full max-w-sm">
      <p className="font-fraunces text-2xl font-semibold text-forest-green">
        {isSignup ? 'Create your account' : 'Sign in to Dryline'}
      </p>
      <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
        {isSignup
          ? 'Use your email and a password.'
          : 'Welcome back. Enter your email and password.'}
      </p>

      {GOOGLE_ENABLED && (
        <>
          <button
            type="button"
            onClick={signInGoogle}
            disabled={loading}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-forest-green/20 bg-white px-4 py-3 font-dm-sans text-sm font-medium text-forest-green hover:bg-forest-green/5 disabled:opacity-50 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
            </svg>
            Continue with Google
          </button>
          <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-forest-green/15" />
            <span className="font-dm-sans text-xs text-forest-green/40">or</span>
            <span className="h-px flex-1 bg-forest-green/15" />
          </div>
        </>
      )}

      <form
        onSubmit={isSignup ? signUpPassword : signInPassword}
        className={`${GOOGLE_ENABLED ? '' : 'mt-6 '}space-y-3`}
      >
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
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          required
          minLength={6}
          className={INPUT_CLS}
        />
        {error && <p className="font-dm-sans text-sm text-rust">{error}</p>}
        <button type="submit" disabled={loading} className={BTN_CLS}>
          {loading
            ? (isSignup ? 'Creating…' : 'Signing in…')
            : (isSignup ? 'Create account' : 'Sign in')}
        </button>
      </form>

      {isSignup && (
        <p className="mt-3 font-dm-sans text-xs leading-relaxed text-forest-green/50">
          By creating an account you agree to our{' '}
          <Link href="/terms" className="underline hover:text-forest-green">Terms</Link>
          {' '}and{' '}
          <Link href="/privacy" className="underline hover:text-forest-green">Privacy Policy</Link>.
        </p>
      )}

      {!isSignup && (
        <Link href="/auth/reset" className={`mt-3 inline-block ${LINK_CLS}`}>
          Forgot password?
        </Link>
      )}

      <p className="mt-4 font-dm-sans text-sm text-forest-green/60">
        {isSignup ? 'Already have an account? ' : "Don't have an account? "}
        <button
          type="button"
          onClick={() => { setPwMode(isSignup ? 'signin' : 'signup'); setError(null) }}
          className="font-medium text-forest-green hover:underline"
        >
          {isSignup ? 'Sign in' : 'Create one'}
        </button>
      </p>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => { setView('otp'); setStep('email'); setError(null) }}
          className={LINK_CLS}
        >
          Email me a code instead
        </button>
        <Link href="/" className={LINK_CLS}>
          Back to Dryline
        </Link>
      </div>
    </div>
  )
}
