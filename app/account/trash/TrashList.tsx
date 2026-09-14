'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TrashItem } from '@/lib/trash'
import { warning } from '@/lib/brand-colors'

// ─── The trash, listed (Block 12, 12.4) ───────────────────────────────────────
// Every row says what it is, when it went, and the day it will be gone for
// good. Restore is one tap and says what it will do; a refusal is a sentence.
// Nothing here deletes — the purge is the cron's job and nobody's tap.

const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmtDay = (key: string) => new Date(`${key}T12:00:00-06:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function TrashList({ items }: { items: TrashItem[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function restore(item: TrashItem) {
    setBusy(item.id); setError(null)
    try {
      const res = await fetch('/api/trash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ table: item.table, id: item.id }) })
      const j = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(j.error ?? 'That could not be restored just now.'); setBusy(null); return }
      router.refresh()
    } catch {
      setError('No connection — nothing changed. Try again when you have signal.')
    } finally { setBusy(null) }
  }

  return (
    <ul className="divide-y divide-rule" data-audit="trash-list">
      {items.map(item => (
        <li key={`${item.table}:${item.id}`} className="flex min-h-[64px] items-center justify-between gap-3 px-4 py-3" data-audit="trash-row" data-table={item.table} data-id={item.id}>
          <span className="min-w-0">
            <span className="block font-dm-sans text-[17px] text-ink">{item.label}</span>
            <span className="block font-dm-sans text-[14px] text-secondary-ink">Deleted {fmt(item.deletedAt)} · gone for good {fmtDay(item.goneOn)}</span>
          </span>
          <button type="button" onClick={() => void restore(item)} disabled={busy === item.id} data-audit="trash-restore"
            className="inline-flex min-h-[48px] shrink-0 items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-brand disabled:opacity-50">
            {busy === item.id ? 'Restoring…' : 'Restore'}
          </button>
        </li>
      ))}
      {error && <li className="px-4 py-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} role="alert" data-audit="trash-error">{error}</li>}
    </ul>
  )
}
