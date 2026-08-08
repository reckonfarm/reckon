'use client'

import { useEffect, useReducer } from 'react'

// "Scout 01 · last heard 40 s ago" — the system-is-alive line. Renders from
// devices.last_seen (refreshed by ingest on every accepted reading) and ticks
// client-side every 10 s. Date.now() stays in module-level helpers, never in
// the render body (react-hooks/purity; same shape as ActivityFeed's fmtAge).

export interface DeviceLivenessRow {
  name: string | null
  lastSeen: string | null
}

const FRESH_MS = 10 * 60 * 1000

function ageLabel(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 5) return 'just now'
  if (s < 90) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

function isFresh(iso: string): boolean {
  return Date.now() - Date.parse(iso) < FRESH_MS
}

export default function DeviceLiveness({ devices }: { devices: DeviceLivenessRow[] }) {
  const [, bump] = useReducer((c: number) => c + 1, 0)
  useEffect(() => {
    const id = setInterval(bump, 10_000)
    return () => clearInterval(id)
  }, [])

  if (devices.length === 0) return null
  return (
    <div className="mt-2 space-y-0.5">
      {devices.map((d, i) => {
        const fresh = d.lastSeen != null && isFresh(d.lastSeen)
        return (
          <p key={i} className="flex items-center gap-1.5 font-dm-sans text-xs text-forest-green/50">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${fresh ? 'bg-up' : 'bg-forest-green/25'}`}
            />
            <span className="font-medium text-forest-green/70">{d.name ?? 'Unknown device'}</span>
            <span className="text-forest-green/25">·</span>
            {d.lastSeen ? `last heard ${ageLabel(d.lastSeen)}` : 'never heard'}
          </p>
        )
      })}
    </div>
  )
}
