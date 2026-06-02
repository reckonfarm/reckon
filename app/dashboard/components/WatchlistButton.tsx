'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { trackEvent } from '@/lib/analytics'
import type { TriggeredLevel } from '@/lib/alert-service'

interface WatchlistEntry {
  countyId: number
  alertLevel: number
}

interface Props {
  countyId: number
  countyName: string
}

export default function WatchlistButton({ countyId, countyName }: Props) {
  const [authed, setAuthed]           = useState<boolean | null>(null) // null = loading
  const [watching, setWatching]       = useState(false)
  const [alerts, setAlerts]           = useState<TriggeredLevel[]>([])
  const [busy, setBusy]               = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [showAdded, setShowAdded]     = useState(false)

  useEffect(() => {
    const supabase = createClient()

    // Fetch watchlist/alert state for an already-known signed-in status. Calls no
    // auth method itself, so it's safe from inside onAuthStateChange (re-calling
    // getSession/getUser there re-enters the GoTrueClient lock → DEADLOCK — the bug).
    async function loadWatch() {
      try {
        const [watchlistRes, alertRes] = await Promise.all([
          fetch('/api/watchlist').then(r => r.ok ? r.json() : []),
          fetch('/api/watchlist?alerts=1').then(r => r.ok ? r.json() : []),
        ])
        const wl: WatchlistEntry[] = Array.isArray(watchlistRes) ? watchlistRes : []
        setWatching(wl.some(e => e.countyId === countyId))
        const match = Array.isArray(alertRes)
          ? alertRes.find((a: { countyId: number; triggered: TriggeredLevel[] }) => a.countyId === countyId)
          : null
        setAlerts(match?.triggered ?? [])
      } catch { /* keep current state; never strand the button */ }
    }

    // Initial read: one-shot getSession (local, no network getUser). (f7380dc pattern.)
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setAuthed(!!session)
        if (session) loadWatch()
      })
      .catch(() => setAuthed(false))

    // Auth changes: use the session PASSED to the callback — never re-call getSession here.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setAuthed(!!session)
      if (session) loadWatch(); else { setWatching(false); setAlerts([]) }
    })
    return () => subscription.unsubscribe()
  }, [countyId])

  async function toggle() {
    setBusy(true)
    const method = watching ? 'DELETE' : 'POST'
    await fetch('/api/watchlist', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countyId, alertLevel: 3 }),
    })
    setWatching(w => !w)
    if (watching) {
      setAlerts([])
    } else {
      trackEvent('alert_optin', { type: 'watchlist' })
      setShowAdded(true)
      setTimeout(() => setShowAdded(false), 4000)
    }
    setBusy(false)
  }

  const hasAlert = alerts.length > 0

  // Not yet determined
  if (authed === null) return null

  // Not signed in — prompt to sign in
  if (!authed) {
    return (
      <Link
        href="/signin"
        className="inline-flex items-center gap-1.5 rounded-lg border border-forest-green/20 bg-white px-3 py-1.5 text-sm font-medium font-dm-sans text-forest-green hover:bg-cream transition-colors"
        aria-label={`Sign in to watch ${countyName}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        Sign in to watch
      </Link>
    )
  }

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        onClick={toggle}
        disabled={busy}
        onMouseEnter={() => hasAlert && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={[
          'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium font-dm-sans transition-colors disabled:opacity-40',
          watching
            ? hasAlert
              ? 'bg-rust text-cream hover:bg-rust/90'
              : 'bg-forest-green text-cream hover:bg-forest-green/90'
            : 'border border-forest-green/20 bg-white text-forest-green hover:bg-cream',
        ].join(' ')}
        aria-label={watching ? `Unwatch ${countyName}` : `Watch ${countyName} for drought alerts`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4 shrink-0"
          fill={watching ? 'currentColor' : 'none'}
          viewBox="0 0 24 24"
          stroke={watching ? 'none' : 'currentColor'}
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        <span>
          {busy ? '…' : watching ? (hasAlert ? 'Alert' : 'Watching') : 'Watch'}
        </span>

        {hasAlert && (
          <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-cream/30 text-xs font-bold">
            {alerts.length}
          </span>
        )}
      </button>

      {showAdded && (
        <span className="text-xs font-dm-sans text-forest-green/70">
          Added to{' '}
          <Link href="/watchlist" className="underline hover:text-forest-green">
            My Counties
          </Link>
        </span>
      )}

      {showTooltip && hasAlert && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-56 rounded-lg border border-forest-green/10 bg-white p-3 shadow-lg">
          <p className="mb-1.5 text-xs font-semibold text-forest-green font-dm-sans">
            Active drought alerts
          </p>
          <ul className="space-y-1">
            {alerts.map(a => (
              <li key={a.level} className="flex items-center justify-between text-xs font-dm-sans">
                <span className="font-medium text-forest-green">{a.level} {a.label}</span>
                <span className="text-forest-green/60">{a.pct.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-forest-green/40 font-dm-sans">% of county area affected</p>
        </div>
      )}
    </div>
  )
}
