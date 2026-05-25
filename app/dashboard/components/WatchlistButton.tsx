'use client'

import { useState, useEffect } from 'react'
import type { TriggeredLevel } from '@/lib/alert-service'

// ─── Persistent anonymous user ID ─────────────────────────────────────────────
// Stored in localStorage so the watchlist survives page reloads.
// Swap this for the real auth user ID once auth is wired up.
const LS_KEY = 'reckon_user_id'

function getUserId(): string {
  let id = localStorage.getItem(LS_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(LS_KEY, id)
  }
  return id
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface WatchlistEntry {
  countyId: number
  alertLevel: number
}

interface Props {
  countyId: number
  countyName: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WatchlistButton({ countyId, countyName }: Props) {
  const [watching, setWatching]       = useState(false)
  const [alerts, setAlerts]           = useState<TriggeredLevel[]>([])
  const [busy, setBusy]               = useState(true)
  const [showTooltip, setShowTooltip] = useState(false)

  // On mount: check if this county is already watched, then fetch any active alerts
  useEffect(() => {
    const userId = getUserId()

    Promise.all([
      fetch('/api/watchlist',           { headers: { 'X-User-Id': userId } }).then(r => r.json()),
      fetch('/api/watchlist?alerts=1',  { headers: { 'X-User-Id': userId } }).then(r => r.json()),
    ]).then(([watchlist, alertData]) => {
      const wl: WatchlistEntry[] = Array.isArray(watchlist) ? watchlist : []
      setWatching(wl.some(e => e.countyId === countyId))

      const match = Array.isArray(alertData)
        ? alertData.find((a: { countyId: number; triggered: TriggeredLevel[] }) => a.countyId === countyId)
        : null
      setAlerts(match?.triggered ?? [])
    }).catch(() => {
      // Silently fail — watchlist is non-critical
    }).finally(() => setBusy(false))
  }, [countyId])

  async function toggle() {
    const userId = getUserId()
    setBusy(true)

    const method = watching ? 'DELETE' : 'POST'
    await fetch('/api/watchlist', {
      method,
      headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ countyId, alertLevel: 3 }),
    })

    setWatching(w => !w)
    if (watching) setAlerts([]) // clear alert badge when unwatching
    setBusy(false)
  }

  const hasAlert = alerts.length > 0

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        onClick={toggle}
        disabled={busy}
        onMouseEnter={() => hasAlert && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={[
          'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium font-dm-sans transition-colors disabled:opacity-40',
          watching
            ? hasAlert
              ? 'bg-rust text-cream hover:bg-rust/90'
              : 'bg-forest-green text-cream hover:bg-forest-green/90'
            : 'border border-forest-green/20 bg-white text-forest-green hover:bg-cream',
        ].join(' ')}
        aria-label={watching ? `Unwatch ${countyName}` : `Watch ${countyName} for drought alerts`}
      >
        {/* Bell icon */}
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

        {/* Alert count badge */}
        {hasAlert && (
          <span className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-cream/30 text-xs font-bold">
            {alerts.length}
          </span>
        )}
      </button>

      {/* Tooltip listing triggered drought levels */}
      {showTooltip && hasAlert && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-56 rounded-lg border border-forest-green/10 bg-white p-3 shadow-lg">
          <p className="mb-1.5 text-xs font-semibold text-forest-green font-dm-sans">
            Active drought alerts
          </p>
          <ul className="space-y-1">
            {alerts.map(a => (
              <li key={a.level} className="flex items-center justify-between text-xs font-dm-sans">
                <span className="font-medium text-forest-green">
                  {a.level} {a.label}
                </span>
                <span className="text-forest-green/60">{a.pct.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-forest-green/40 font-dm-sans">
            % of county area affected
          </p>
        </div>
      )}
    </div>
  )
}
