'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { warning } from '@/lib/brand-colors'

// ─── Delete a device (Block 7D.3) ─────────────────────────────────────────────
// The first delete surface devices have ever had. Same shape as a place: one
// tap, and whether it deletes or answers with what points at it is the route's
// call against a real count. This screen does not pre-judge it, so the button
// never lies about what it will do by being absent on a guess.
//
// Everything that names a device does so through a foreign key with ON DELETE
// SET NULL, so a delete would not orphan anything — it would DETACH
// observations from the machine that made them. Quieter damage, same sentence
// before it happens.

type Mode = 'idle' | 'confirm' | 'referenced'

export default function DeleteDevice({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refs, setRefs] = useState<string | null>(null)

  async function remove() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/devices/${id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({})) as { deleted?: boolean; message?: string; error?: string }
      if (res.status === 409 && json.error === 'still referenced') {
        setRefs(json.message ?? 'Something still points at it.'); setMode('referenced'); setBusy(false); return
      }
      if (!res.ok) { setError(json.error ?? 'That device could not be deleted just now'); setBusy(false); return }
      router.refresh()
    } catch {
      setError('That device could not be deleted just now'); setBusy(false)
    }
  }

  if (mode === 'referenced') {
    return (
      <div className="mt-3 rounded-lg border p-3" style={{ borderColor: warning }} data-audit="device-referenced">
        <p className="font-dm-sans text-[16px] font-semibold text-ink">{name} wasn&rsquo;t deleted.</p>
        <p className="mt-1 font-dm-sans text-[15px] leading-snug text-secondary-ink" data-audit="device-referenced-count">
          {refs} Deleting it would cut them loose from the machine that recorded them.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link href={`/ranch/work?device=${id}`} className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="device-referenced-go">
            See its work →
          </Link>
          <button type="button" onClick={() => { setMode('idle'); setRefs(null) }} className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="device-referenced-cancel">
            Leave it
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'confirm') {
    return (
      <div className="mt-3 rounded-lg border p-3" style={{ borderColor: warning }} data-audit="device-confirm-delete">
        <p className="font-dm-sans text-[16px] font-semibold text-ink">Delete {name}?</p>
        <p className="mt-1 font-dm-sans text-[15px] leading-snug text-secondary-ink">
          If nothing points at it, it is gone for good. If anything still does, it won&rsquo;t be deleted —
          you&rsquo;ll be told what.
        </p>
        {error && <p role="alert" className="mt-2 font-dm-sans text-[15px] font-semibold" style={{ color: warning }} data-audit="device-delete-error">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-[48px] rounded-lg px-4 font-dm-sans text-[16px] font-semibold text-cream disabled:opacity-50" style={{ backgroundColor: warning }} data-audit="device-delete-confirm">
            {busy ? 'Deleting…' : 'Delete it'}
          </button>
          <button type="button" disabled={busy} onClick={() => { setMode('idle'); setError(null) }} className="min-h-[48px] rounded-lg px-4 font-dm-sans text-[16px] font-semibold text-secondary-ink underline underline-offset-2 disabled:opacity-50" data-audit="device-delete-cancel">
            Keep it
          </button>
        </div>
      </div>
    )
  }

  return (
    <button type="button" onClick={() => setMode('confirm')} className="mt-3 inline-flex min-h-[44px] items-center font-dm-sans text-[15px] font-semibold underline underline-offset-2" style={{ color: warning }} data-audit="device-delete-open">
      Delete this device
    </button>
  )
}
