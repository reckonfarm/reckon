'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TrashItem } from '@/lib/trash'
import RowActions from '@/app/components/RowActions'
import { warning } from '@/lib/brand-colors'

// ─── The trash, listed (Block 12 12.4 · Block 13) ─────────────────────────────
// Every row says what it is, when it went, and the day it will be gone for
// good. Block 13: the same hold as everywhere — hold a row and "Put it back" is
// the one thing it offers; there is no Delete, because the purge is the cron's
// job and nobody's tap, and the sheet says so. A refusal is a sentence.

const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmtDay = (key: string) => new Date(`${key}T12:00:00-06:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function TrashList({ items }: { items: TrashItem[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  async function restore(item: TrashItem) {
    setError(null)
    try {
      const res = await fetch('/api/trash', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ table: item.table, id: item.id }) })
      const j = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(j.error ?? 'That could not be put back just now.'); return }
      router.refresh()
    } catch {
      setError('No connection — nothing changed. Try again when you have signal.')
    }
  }

  return (
    <ul className="divide-y divide-rule" data-audit="trash-list">
      {items.map(item => (
        <li key={`${item.table}:${item.id}`} data-audit="trash-row" data-table={item.table} data-id={item.id}>
          <RowActions links={{
            label: item.label,
            fixNote: 'It is in the trash. Put it back to fix it.',
            extra: [{ label: 'Put it back', onSelect: () => restore(item) }],
            deleteNote: `It goes for good on ${fmtDay(item.goneOn)}. Nothing here deletes sooner.`,
          }}>
            <div className="flex min-h-[64px] items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block font-dm-sans text-[17px] text-ink">{item.label}</span>
                <span className="block font-dm-sans text-[14px] text-secondary-ink">Deleted {fmt(item.deletedAt)} · gone for good {fmtDay(item.goneOn)}</span>
              </span>
              <span aria-hidden className="shrink-0 font-dm-sans text-[14px] text-secondary-ink">hold</span>
            </div>
          </RowActions>
        </li>
      ))}
      {error && <li className="px-4 py-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} role="alert" data-audit="trash-error">{error}</li>}
    </ul>
  )
}
