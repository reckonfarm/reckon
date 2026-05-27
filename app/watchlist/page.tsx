'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import SiteHeader from '@/app/components/SiteHeader'
import type { WatchlistEntry } from '@/lib/concierge-service'
import type { DroughtAlert } from '@/lib/alert-service'

export default function WatchlistPage() {
  const [authed, setAuthed]     = useState<boolean | null>(null)
  const [entries, setEntries]   = useState<WatchlistEntry[]>([])
  const [alerts, setAlerts]     = useState<DroughtAlert[]>([])
  const [loading, setLoading]   = useState(true)
  const [removing, setRemoving] = useState<Set<number>>(new Set())

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setAuthed(false); setLoading(false); return }
      setAuthed(true)

      try {
        const [watchlist, alertData] = await Promise.all([
          fetch('/api/watchlist').then(r => r.ok ? r.json() : []),
          fetch('/api/watchlist?alerts=1').then(r => r.ok ? r.json() : []),
        ])
        setEntries(Array.isArray(watchlist) ? watchlist : [])
        setAlerts(Array.isArray(alertData) ? alertData : [])
      } catch {
        setEntries([])
        setAlerts([])
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  async function remove(countyId: number) {
    setRemoving(prev => new Set(prev).add(countyId))

    await fetch('/api/watchlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countyId }),
    }).catch(() => {})

    setEntries(prev => prev.filter(e => e.countyId !== countyId))
    setAlerts(prev  => prev.filter(a => a.countyId !== countyId))
    setRemoving(prev => { const next = new Set(prev); next.delete(countyId); return next })
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
          My Counties
        </h1>
        <p className="mt-1 text-sm text-forest-green/50 font-dm-sans">
          Counties you&apos;re watching for drought conditions.
        </p>

        <div className="mt-6">
          {authed === null || loading ? (
            <div className="space-y-3 mt-6">
              {[1,2,3].map(i => (
                <div key={i} className="h-16 rounded-lg bg-forest-green/8 animate-pulse" />
              ))}
            </div>
          ) : !authed ? (
            <div className="mt-8 border-2 border-dashed border-forest-green/20 rounded-xl p-8 text-center">
              <p className="font-fraunces text-xl text-forest-green mb-2">Track drought conditions in your counties</p>
              <p className="text-sm text-forest-green/60 font-dm-sans mb-6">Get alerted when your counties hit LFP trigger thresholds. Sign in to save your watchlist.</p>
              <a href="/signin" className="inline-block bg-forest-green text-cream font-dm-sans text-sm font-medium px-6 py-3 rounded-lg hover:bg-forest-green/90 transition-colors">Sign in to get started</a>
            </div>
          ) : entries.length === 0 ? (
            <div className="rounded-xl border border-forest-green/10 bg-white px-6 py-12 text-center shadow-sm">
              <p className="text-sm text-forest-green/60 font-dm-sans">
                No counties watched yet.{' '}
                <Link href="/dashboard" className="underline hover:text-forest-green">
                  Search for a county
                </Link>{' '}
                and click Watch to track its drought status.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {entries.map(entry => {
                const alert   = alerts.find(a => a.countyId === entry.countyId) ?? null
                const busy    = removing.has(entry.countyId)
                const highest = alert?.triggered.at(-1) ?? null

                return (
                  <li
                    key={entry.countyId}
                    className="rounded-xl border border-forest-green/10 bg-white px-4 py-4 shadow-sm sm:px-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-fraunces text-base font-semibold text-forest-green">
                            {entry.county.name}, {entry.county.state}
                          </h2>
                          {alert?.alerted && (
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-red-200 font-dm-sans">
                              Alert
                            </span>
                          )}
                        </div>
                        {alert && (
                          <p className="mt-1">
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-dm-sans text-gray-600 ring-1 ring-gray-200">
                              {highest ? `${highest.level} ${highest.label}` : 'No Drought'}
                            </span>
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-forest-green/40 font-dm-sans">
                          FIPS {entry.county.fips}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Link
                          href={`/dashboard?fips=${entry.county.fips}`}
                          className="rounded-lg border border-forest-green/20 px-3 py-1.5 text-xs font-medium text-forest-green font-dm-sans hover:bg-cream"
                        >
                          View Dashboard →
                        </Link>
                        <button
                          onClick={() => remove(entry.countyId)}
                          disabled={busy}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 font-dm-sans hover:bg-red-50 disabled:opacity-40"
                        >
                          {busy ? '…' : 'Remove'}
                        </button>
                      </div>
                    </div>

                    {alert?.alerted && alert.triggered.length > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {alert.triggered.map(t => (
                          <li
                            key={t.level}
                            className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-dm-sans text-red-700 ring-1 ring-red-200"
                          >
                            {t.level} {t.label} — {t.pct.toFixed(1)}%
                          </li>
                        ))}
                      </ul>
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
