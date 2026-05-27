'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'

export default function SignInPage() {
  const [email, setEmail]     = useState('')
  const [sent, setSent]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
        shouldCreateUser: true,
      },
    })

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  if (sent) {
    return (
      <>
        <SiteHeader />
        <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <div className="w-full max-w-sm text-center">
          <p className="font-fraunces text-2xl font-semibold text-forest-green">
            Check your email
          </p>
          <p className="mt-3 font-dm-sans text-sm leading-relaxed text-forest-green/60">
            We sent a magic link to <strong className="text-forest-green">{email}</strong>.
            Click it to sign in.
          </p>
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

  return (
    <>
      <SiteHeader />
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm">
        <p className="font-fraunces text-2xl font-semibold text-forest-green">
          Sign in to Reckon
        </p>
        <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
          We&apos;ll send a magic link to your email.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
            className="w-full rounded-lg border border-forest-green/20 bg-white px-4 py-3 font-dm-sans text-sm text-forest-green placeholder:text-forest-green/30 focus:border-forest-green/50 focus:outline-none"
          />
          {error && (
            <p className="font-dm-sans text-sm text-rust">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-forest-green px-4 py-3 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Sending…' : 'Send magic link'}
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
