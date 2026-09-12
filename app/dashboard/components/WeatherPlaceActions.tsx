'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { warning } from '@/lib/brand-colors'

// ─── Unpin or delete, from the Weather list itself (Block 7D.4) ───────────────
// The list is where someone notices a place they no longer want, so the two
// ways off it live here rather than three taps away on the place page.
//
//   Unpin   it leaves the list and keeps everything it has.
//   Delete  the same rule as everywhere else — gone when nothing points at it,
//           and a counted answer when something does. Never a silent orphan.

export default function WeatherPlaceActions({ id, name, pinned }: { id: string; name: string; pinned: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [refs, setRefs] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function unpin() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/places/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: false }) })
      if (!res.ok) { setError('That place could not be unpinned just now.'); setBusy(false); return }
      router.refresh()
    } catch { setError('That place could not be unpinned just now.'); setBusy(false) }
  }

  async function remove() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/places/${id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({})) as { deleted?: boolean; message?: string; error?: string }
      if (res.status === 409 && json.error === 'still referenced') {
        setRefs(json.message ?? 'Something still points at it.'); setConfirming(false); setBusy(false); return
      }
      if (!res.ok) { setError(json.error ?? 'That place could not be deleted just now.'); setBusy(false); return }
      router.refresh()
    } catch { setError('That place could not be deleted just now.'); setBusy(false) }
  }

  if (refs) {
    return (
      <p className="mt-1 font-dm-sans text-[15px] leading-snug text-secondary-ink" data-audit="weather-place-referenced">
        {name} wasn&rsquo;t deleted. {refs}{' '}
        <button type="button" onClick={() => setRefs(null)} className="font-semibold text-brand underline underline-offset-2">Close</button>
      </p>
    )
  }

  if (confirming) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-3" data-audit="weather-place-confirm-delete">
        <span className="font-dm-sans text-[15px] text-secondary-ink">Delete {name}?</span>
        <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-[44px] font-dm-sans text-[15px] font-semibold underline underline-offset-2 disabled:opacity-50" style={{ color: warning }} data-audit="weather-place-delete-confirm">
          {busy ? 'Deleting…' : 'Yes, delete it'}
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-[44px] font-dm-sans text-[15px] font-semibold text-secondary-ink underline underline-offset-2 disabled:opacity-50" data-audit="weather-place-delete-cancel">
          Keep it
        </button>
      </div>
    )
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-3" data-audit="weather-place-actions">
      {pinned && (
        <button type="button" disabled={busy} onClick={() => void unpin()} className="min-h-[44px] font-dm-sans text-[15px] font-semibold text-secondary-ink underline underline-offset-2 disabled:opacity-50" data-audit="weather-place-unpin">
          {busy ? 'Unpinning…' : 'Unpin'}
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="min-h-[44px] font-dm-sans text-[15px] font-semibold underline underline-offset-2 disabled:opacity-50" style={{ color: warning }} data-audit="weather-place-delete-open">
        Delete
      </button>
      {error && <span role="alert" className="font-dm-sans text-[15px]" style={{ color: warning }} data-audit="weather-place-error">{error}</span>}
    </div>
  )
}
