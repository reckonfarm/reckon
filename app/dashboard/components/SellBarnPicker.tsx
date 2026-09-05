'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// "Where I sell" (Block 2.5 A2): the nearest reporting barn is often not the
// one a person hauls to. One select, saved to the operation profile; every
// auction figure then carries "Where you sell — <town>" instead of "Nearby
// auction reference". "Nearest reporting barn" clears the pin.

export interface BarnOption { slug: string; name: string; town: string }

export default function SellBarnPicker({ options, current }: { options: BarnOption[]; current: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (slug: string) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/operation-profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sell_barn_slug: slug || null }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Could not save'); return }
      router.refresh()
    } catch {
      setError('No connection — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-forest-green/10 bg-white px-4 py-3">
      <label className="block font-dm-sans text-[15px] font-semibold text-forest-green" htmlFor="sell-barn">Where I sell</label>
      <select
        id="sell-barn"
        value={current ?? ''}
        disabled={busy}
        onChange={e => void save(e.target.value)}
        className="mt-2 min-h-[48px] w-full rounded-lg border border-forest-green/20 bg-white px-3 font-dm-sans text-[16px] text-forest-green"
      >
        <option value="">Nearest reporting barn</option>
        {options.map(o => <option key={o.slug} value={o.slug}>{o.name} · {o.town}</option>)}
      </select>
      <p className="mt-1.5 font-dm-sans text-[13px] text-forest-green/80">
        Pins the barn you haul to. Prices are still that barn&apos;s report — the pin only picks which report you see first.
      </p>
      {error && <p role="alert" className="mt-1 font-dm-sans text-[14px] font-medium text-warning">{error}</p>}
    </div>
  )
}
