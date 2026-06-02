'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { trackEvent } from '@/lib/analytics'

interface Props {
  countyFips: string
  countyName: string
}

// Designate this county as the user's Home — the one the dashboard opens to by
// default (see app/dashboard/page.tsx). Exactly one Home per user; setting a new
// one replaces the old. Independent of the watchlist. Hidden for signed-out
// visitors (the Watch button already carries the sign-in prompt next to it).
export default function HomeCountyButton({ countyFips, countyName }: Props) {
  const [authed, setAuthed] = useState<boolean | null>(null) // null = loading
  const [isHome, setIsHome] = useState(false)
  const [busy, setBusy]     = useState(false)
  const [justSet, setJustSet] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setAuthed(false); return }
      setAuthed(true)

      const res = await fetch('/api/home-county').then(r => r.ok ? r.json() : null).catch(() => null)
      setIsHome(res?.fips === countyFips)
    }

    load()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => load())
    return () => subscription.unsubscribe()
  }, [countyFips])

  async function toggle() {
    setBusy(true)
    if (isHome) {
      // Already home → clear it
      await fetch('/api/home-county', { method: 'DELETE' }).catch(() => {})
      setIsHome(false)
    } else {
      const res = await fetch('/api/home-county', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fips: countyFips }),
      }).catch(() => null)
      if (res?.ok) {
        setIsHome(true)
        trackEvent('home_county_set', { fips: countyFips })
        setJustSet(true)
        setTimeout(() => setJustSet(false), 3000)
      }
    }
    setBusy(false)
  }

  // Not yet determined, or signed out — render nothing.
  if (authed !== true) return null

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        onClick={toggle}
        disabled={busy}
        className={[
          'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium font-dm-sans transition-colors disabled:opacity-40',
          isHome
            ? 'bg-forest-green text-cream hover:bg-forest-green/90'
            : 'border border-forest-green/20 bg-white text-forest-green hover:bg-cream',
        ].join(' ')}
        aria-label={isHome ? `${countyName} is your home county — tap to unset` : `Set ${countyName} as your home county`}
        title={isHome ? 'Your home county — opens by default' : 'Set as your home county'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4 shrink-0"
          fill={isHome ? 'currentColor' : 'none'}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9" />
        </svg>
        <span>{busy ? '…' : isHome ? 'Home' : 'Set Home'}</span>
      </button>

      {justSet && (
        <span className="text-xs font-dm-sans text-forest-green/70">
          Your dashboard opens here now
        </span>
      )}
    </div>
  )
}
