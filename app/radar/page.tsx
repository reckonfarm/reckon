'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'

interface RadarMatch {
  listing_id:    number
  sent_at:       string
  hay_type:      string | null
  listing_type:  string | null
  price_per_ton: number | null
  county_name:   string | null
  state:         string | null
}

interface SavedSearch {
  id:                 number
  state:              string | null
  hay_type:           string | null
  listing_type:       string | null
  max_price_per_ton:  number | null
  max_distance_miles: number | null
  origin_county_id:   number | null
  origin_county_name: string | null
  label:              string | null
  active:             boolean
  created_at:         string
  matches:            RadarMatch[]
}

const TYPE_LABEL: Record<string, string> = { sell: 'For sale', donate: 'Donations' }

function criteriaChips(s: SavedSearch): string[] {
  const chips: string[] = []
  if (s.hay_type) chips.push(s.hay_type)
  if (s.state) chips.push(s.state)
  if (s.listing_type) chips.push(TYPE_LABEL[s.listing_type] ?? s.listing_type)
  if (s.max_price_per_ton != null) chips.push(`≤ $${s.max_price_per_ton}/ton`)
  if (s.max_distance_miles != null && s.origin_county_name) chips.push(`within ${s.max_distance_miles} mi of ${s.origin_county_name}`)
  if (chips.length === 0) chips.push('All hay listings')
  return chips
}

function matchDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function RadarPage() {
  const [authed, setAuthed]   = useState<boolean | null>(null)
  const [searches, setSearches] = useState<SavedSearch[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<Set<number>>(new Set())

  useEffect(() => {
    const supabase = createClient()
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setAuthed(false); setLoading(false); return }
      setAuthed(true)
      try {
        const data = await fetch('/api/radar').then(r => r.ok ? r.json() : [])
        setSearches(Array.isArray(data) ? data : [])
      } catch {
        setSearches([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function remove(id: number) {
    setBusy(prev => new Set(prev).add(id))
    await fetch('/api/radar', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {})
    setSearches(prev => prev.filter(s => s.id !== id))
    setBusy(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  async function toggle(id: number, active: boolean) {
    setBusy(prev => new Set(prev).add(id))
    await fetch('/api/radar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active }),
    }).catch(() => {})
    setSearches(prev => prev.map(s => s.id === id ? { ...s, active } : s))
    setBusy(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
          Hay Radar
        </h1>
        <p className="mt-1 text-sm text-forest-green/50 font-dm-sans">
          Saved hay searches. We email you the moment a new listing matches.
        </p>

        <div className="mt-6">
          {authed === null || loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-forest-green/8 animate-pulse" />)}
            </div>
          ) : !authed ? (
            <div className="mt-8 rounded-xl border-2 border-dashed border-forest-green/20 p-8 text-center">
              <p className="font-fraunces text-xl text-forest-green mb-2">Let the hay come to you</p>
              <p className="text-sm text-forest-green/60 font-dm-sans mb-6">
                Save a search — hay type, state, price, distance — and Dryline emails you when a new
                listing matches. Sign in to set up your radar.
              </p>
              <a href="/signin" className="inline-block bg-forest-green text-cream font-dm-sans text-sm font-medium px-6 py-3 rounded-lg hover:bg-forest-green/90 transition-colors">
                Sign in to get started
              </a>
            </div>
          ) : searches.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-forest-green/20 bg-white px-6 py-12 text-center">
              <p className="font-fraunces text-base font-semibold text-forest-green">No saved searches yet</p>
              <p className="mt-1 font-dm-sans text-sm text-forest-green/55 max-w-md mx-auto">
                Hay Radar watches new listings for you. Set your filters on the Hay Network and tap
                &ldquo;Save this search&rdquo; — we&apos;ll email you the moment matching hay is posted.
              </p>
              <Link href="/hay" className="mt-4 inline-block rounded-lg bg-forest-green px-5 py-2.5 font-dm-sans text-sm font-medium text-cream hover:bg-forest-green/90 transition-colors">
                Browse the Hay Network →
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {searches.map(s => {
                const working = busy.has(s.id)
                return (
                  <li key={s.id} className="rounded-xl border border-forest-green/10 bg-white px-4 py-4 shadow-sm sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-fraunces text-base font-semibold text-forest-green">
                            {s.label || 'Saved search'}
                          </h2>
                          {!s.active && (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-dm-sans text-gray-500 ring-1 ring-gray-200">
                              Paused
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {criteriaChips(s).map((c, i) => (
                            <span key={i} className="inline-flex items-center rounded-full bg-forest-green/5 px-2 py-0.5 text-xs font-dm-sans text-forest-green/70 ring-1 ring-forest-green/15">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => toggle(s.id, !s.active)}
                          disabled={working}
                          className="rounded-lg border border-forest-green/20 px-3 py-1.5 text-xs font-medium text-forest-green font-dm-sans hover:bg-cream disabled:opacity-40"
                        >
                          {working ? '…' : s.active ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          onClick={() => remove(s.id)}
                          disabled={working}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 font-dm-sans hover:bg-red-50 disabled:opacity-40"
                        >
                          {working ? '…' : 'Delete'}
                        </button>
                      </div>
                    </div>

                    {s.matches.length > 0 && (
                      <div className="mt-3 border-t border-forest-green/8 pt-3">
                        <p className="font-dm-sans text-xs font-semibold uppercase tracking-wide text-forest-green/45 mb-2">
                          Recent matches
                        </p>
                        <ul className="space-y-1.5">
                          {s.matches.map(m => (
                            <li key={m.listing_id} className="flex items-center justify-between gap-3">
                              <Link
                                href={`/hay/${m.listing_id}`}
                                className="font-dm-sans text-sm text-forest-green underline hover:text-forest-green/70 truncate"
                              >
                                {m.hay_type ?? 'Hay'}{m.county_name ? ` — ${m.county_name}, ${m.state}` : ''}
                                {m.listing_type !== 'donate' && m.price_per_ton != null ? ` · $${m.price_per_ton}/ton` : ''}
                              </Link>
                              <span className="shrink-0 font-dm-sans text-xs text-forest-green/40">{matchDate(m.sent_at)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </main>
    </>
  )
}
