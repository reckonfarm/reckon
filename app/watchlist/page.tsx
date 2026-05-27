'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { WatchlistEntry } from '@/lib/concierge-service'
import type { DroughtAlert } from '@/lib/alert-service'

const LS_KEY = 'reckon_user_id'

function getUserId(): string | null {
  return localStorage.getItem(LS_KEY)
}

export default function WatchlistPage() {
  const [entries, setEntries]   = useState<WatchlistEntry[]>([])
  const [alerts, setAlerts]     = useState<DroughtAlert[]>([])
  const [loading, setLoading]   = useState(true)
  const [removing, setRemoving] = useState<Set<number>>(new Set())

  useEffect(() => {
    const userId = getUserId()
    if (!userId) { setLoading(false); return }

    const headers = { 'X-User-Id': userId }

    Promise.all([
      fetch('/api/watchlist',          { headers }).then(r => r.json()),
      fetch('/api/watchlist?alerts=1', { headers }).then(r => r.json()),
    ]).then(([watchlist, alertData]) => {
      setEntries(Array.isArray(watchlist)  ? watchlist  : [])
      setAlerts(Array.isArray(alertData)   ? alertData  : [])
    }).catch(() => {
      setEntries([])
      setAlerts([])
    }).finally(() => setLoading(false))
  }, [])

  async function remove(countyId: number) {
    const userId = getUserId()
    if (!userId) return

    setRemoving(prev => new Set(prev).add(countyId))

    await fetch('/api/watchlist', {
      method: 'DELETE',
      headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ countyId }),
    }).catch(() => {})

    setEntries(prev => prev.filter(e => e.countyId !== countyId))
    setAlerts(prev  => prev.filter(a => a.countyId !== countyId))
    setRemoving(prev => { const next = new Set(prev); next.delete(countyId); return next })
  }

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-forest-green/10 bg-cream/80 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="font-fraunces text-2xl font-bold text-forest-green hover:opacity-80 transition-opacity">
              Reckon
            </Link>
            <Link href="/" className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors">
              ← Back to search
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
        My Counties
      </h1>
      <p className="mt-1 text-sm text-forest-green/50 font-dm-sans">
        Counties you&apos;re watching for drought conditions.
      </p>

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-forest-green/50 font-dm-sans">Loading…</p>
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
