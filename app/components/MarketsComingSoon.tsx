'use client'

import { trackEvent } from '@/lib/analytics'
import { useEffect, useState } from 'react'

// Markets-surface demand probe — a strictly additive sibling of ComingSoon. The live
// ComingSoon has a hardcoded tile list and renders on the homepage, and Phase 1 is
// additive-only (no edits to live-rendered files), so its card + /api/feature-interest
// probe pattern is mirrored here with the two Markets tiles instead of editing it.
// Behaviour matches ComingSoon: signed-in taps post directly; signed-out collect an
// email first. Nothing here gates any existing feature.

interface Feature {
  key: string
  title: string
  body: string
}

const FEATURES: Feature[] = [
  {
    key: 'cattle_market_data',
    title: 'Cattle market data',
    body: 'Feeder, fed-cattle, and boxed-beef prices pulled straight from USDA Market News — your local read and the national trend, in plain numbers.',
  },
  {
    key: 'herd_estimate',
    title: 'HerdEstimate',
    body: 'A running estimate of what your herd is worth at today’s prices — by weight class, updated as the market moves.',
  },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DONE_PREFIX = 'dryline_mfi_' // sessionStorage flag per feature (markets-scoped)

type TileStatus = 'idle' | 'email' | 'sending' | 'done' | 'error'

export default function MarketsComingSoon({ signedIn }: { signedIn: boolean }) {
  const [status, setStatus] = useState<Record<string, TileStatus>>({})
  const [emails, setEmails] = useState<Record<string, string>>({})

  useEffect(() => {
    const restored: Record<string, TileStatus> = {}
    for (const f of FEATURES) {
      try {
        if (sessionStorage.getItem(DONE_PREFIX + f.key) === '1') restored[f.key] = 'done'
      } catch {
        /* sessionStorage unavailable */
      }
    }
    if (Object.keys(restored).length) setStatus(s => ({ ...restored, ...s }))
  }, [])

  function markDone(key: string) {
    setStatus(s => ({ ...s, [key]: 'done' }))
    try {
      sessionStorage.setItem(DONE_PREFIX + key, '1')
    } catch {
      /* ignore */
    }
  }

  async function post(key: string, email?: string) {
    setStatus(s => ({ ...s, [key]: 'sending' }))
    try {
      const res = await fetch('/api/feature-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_key: key, source: 'markets', email: email ?? null }),
      })
      if (!res.ok) throw new Error('request failed')
      markDone(key)
    } catch {
      setStatus(s => ({ ...s, [key]: 'error' }))
    }
  }

  function onNotify(key: string) {
    trackEvent('feature_interest_tap', { feature_key: key })
    if (signedIn) {
      post(key)
      return
    }
    setStatus(s => ({ ...s, [key]: 'email' }))
  }

  function onSubmitEmail(key: string) {
    const email = (emails[key] ?? '').trim()
    if (!EMAIL_RE.test(email)) {
      setStatus(s => ({ ...s, [key]: 'error' }))
      return
    }
    post(key, email)
  }

  return (
    <section className="mt-16">
      <h2 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
        Coming soon
      </h2>
      <p className="mt-2 font-dm-sans text-base leading-relaxed text-forest-green/60">
        Tap the ones you&apos;d use — it tells us what to build next.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FEATURES.map(f => {
          const st = status[f.key] ?? 'idle'
          return (
            <div
              key={f.key}
              className="flex flex-col rounded-xl border border-forest-green/10 bg-white p-5 shadow-sm"
            >
              <span className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-forest-green/8 px-2.5 py-0.5 font-dm-sans text-[11px] font-medium text-forest-green/60">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-rust/60" />
                Coming soon
              </span>

              <p className="font-fraunces text-base font-semibold text-forest-green">{f.title}</p>
              <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/60">
                {f.body}
              </p>

              <div className="mt-auto pt-4">
                {st === 'done' ? (
                  <button
                    type="button"
                    disabled
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-forest-green/10 px-4 py-2 font-dm-sans text-sm font-semibold text-forest-green"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l3.5 3.5L15 7" />
                    </svg>
                    Got it — we&apos;ll let you know
                  </button>
                ) : st === 'email' || st === 'error' ? (
                  <div className="space-y-2">
                    {!signedIn && (
                      <input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        placeholder="you@email.com"
                        value={emails[f.key] ?? ''}
                        onChange={e => setEmails(m => ({ ...m, [f.key]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') onSubmitEmail(f.key)
                        }}
                        className="w-full rounded-lg border border-forest-green/20 bg-cream px-3 py-2 font-dm-sans text-sm text-forest-green placeholder:text-forest-green/30 focus:border-forest-green/40 focus:outline-none"
                      />
                    )}
                    {st === 'error' && (
                      <p className="font-dm-sans text-xs text-rust">
                        {signedIn
                          ? 'Something went wrong — try again.'
                          : 'Enter a valid email, then try again.'}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => (signedIn ? post(f.key) : onSubmitEmail(f.key))}
                      className="w-full rounded-lg bg-forest-green px-4 py-2 font-dm-sans text-sm font-semibold text-white transition-colors hover:bg-forest-green/90"
                    >
                      Notify me
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNotify(f.key)}
                    disabled={st === 'sending'}
                    className="w-full rounded-lg bg-forest-green px-4 py-2 font-dm-sans text-sm font-semibold text-white transition-colors hover:bg-forest-green/90 disabled:opacity-60"
                  >
                    {st === 'sending' ? 'Sending…' : 'Notify me'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
