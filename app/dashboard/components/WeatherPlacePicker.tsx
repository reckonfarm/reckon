'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── The places not on the Weather list (Block 7D.4) ──────────────────────────
// Weather shows the places that earn a row: a rain reading, a device, or a pin.
// The rest live here, one tap away, each with the pin that puts it on the list.
// Nothing is hidden from the ranch — only from the list — and this says exactly
// how many there are rather than implying the ranch has no other places.

export default function WeatherPlacePicker({ rest }: { rest: { id: string; name: string }[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (rest.length === 0) return null

  async function pin(id: string) {
    setBusy(id); setError(null)
    try {
      const res = await fetch(`/api/places/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      })
      if (!res.ok) { setError('That place could not be pinned just now.'); setBusy(null); return }
      router.refresh()
    } catch {
      setError('That place could not be pinned just now.'); setBusy(null)
    }
  }

  return (
    <details className="mt-3 rounded-xl border border-rule bg-surface" data-audit="weather-place-picker">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center px-4 py-3 font-dm-sans text-[16px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {rest.length} other {rest.length === 1 ? 'place' : 'places'} — pin one to watch it
      </summary>
      <ul className="border-t border-rule">
        {rest.map(p => (
          <li key={p.id} className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2 last:border-b-0">
            <span className="min-w-0 font-dm-sans text-[16px] text-ink">{p.name}</span>
            <button type="button" disabled={busy === p.id} onClick={() => void pin(p.id)}
              className="min-h-[44px] shrink-0 font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2 disabled:opacity-50"
              data-audit="weather-place-pin">
              {busy === p.id ? 'Pinning…' : 'Pin'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="px-4 py-2 font-dm-sans text-[15px] text-secondary-ink" data-audit="weather-pin-error">{error}</p>}
    </details>
  )
}
