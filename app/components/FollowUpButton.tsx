'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { settleFollowUp, type FollowUp } from '@/lib/outbox'
import type { Lot } from '@/lib/herd'
import { warning } from '@/lib/brand-colors'

// ─── "Change bunch to 274?" (Block 14) ────────────────────────────────────────
// A count never silently changes a bunch's head count. When the count differs
// from what the bunch said, the answer offers ONE button. Tap it and the
// bunch's head count is set to the count — through the same PATCH the bunch
// form uses, so it writes a head_count_set row like any edit and the
// projection follows it. Ignore it and nothing happens. Either way it shows
// once: taken or left, it is settled on the item.
export default function FollowUpButton({ itemId, followUp }: { itemId: string; followUp: FollowUp }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (followUp.done && !done) return null

  async function take() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/herd/lots')
      const j = await res.json().catch(() => ({})) as { lots?: Lot[] }
      const lot = (j.lots ?? []).find(l => l.id === followUp.lot_id)
      if (!lot) { setError('That bunch is not on the list any more.'); return }
      const put = await fetch(`/api/herd/lots/${lot.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...lot, head_count: followUp.head, expected_updated_at: lot.updated_at }),
      })
      const pj = await put.json().catch(() => ({})) as { error?: string }
      if (!put.ok) { setError(pj.error ?? 'The bunch could not be changed just now.'); return }
      settleFollowUp(itemId)
      setDone(`Bunch changed to ${followUp.head.toLocaleString()}.`)
      router.refresh()
    } catch { setError('No connection — the bunch was not changed. Try again when you have signal.') }
    finally { setBusy(false) }
  }

  if (done) return <p className="mt-2 font-dm-sans text-[16px] font-semibold text-forest-green" data-audit="follow-up-done">{done}</p>
  return (
    <div className="mt-2" data-audit="follow-up" data-kind={followUp.kind}>
      <button type="button" disabled={busy} onClick={() => void take()} className="min-h-[48px] rounded-lg border border-forest-green/40 bg-surface px-4 font-dm-sans text-[16px] font-semibold text-forest-green disabled:opacity-50" data-audit="follow-up-take">
        {busy ? 'Changing…' : followUp.label}
      </button>
      {error && <p role="alert" className="mt-1 font-dm-sans text-[15px] font-semibold" style={{ color: warning }} data-audit="follow-up-error">{error}</p>}
    </div>
  )
}
