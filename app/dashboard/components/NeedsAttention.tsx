'use client'

import Link from 'next/link'
import { flush, unsyncedCount, useOutbox } from '@/lib/outbox'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { warning } from '@/lib/brand-colors'
import { useState } from 'react'

// ─── Needs attention (Block 7.7) ──────────────────────────────────────────────
//
// Only real state, and nothing at all when there is none. This section used to
// be where the LFP card and the deadline strip sat, which meant Today opened
// every single morning with a paragraph about Washington whether or not
// anything on the ranch needed doing. Those moved to Weather → Programs.
//
// What is left is work the phone is holding that the ranch does not have yet:
// entries that have not reached the ranch. It counts everything unsynced,
// FAILED included — the same count sign-out asks for, and the reason a rejected
// entry can no longer sit invisible until something deletes it.
//
// Renders nothing when the outbox is clear. No empty state, no "all caught up",
// no reserved box — an empty section on a work screen is noise.

export default function NeedsAttention() {
  const items = useOutbox()
  const [busy, setBusy] = useState(false)
  const n = items.filter(i => i.state !== 'synced').length
  if (n === 0) return null

  const failed = items.filter(i => i.state === 'failed')
  return (
    <section aria-labelledby="needs-attention-h" data-audit="needs-attention">
      <h2 id="needs-attention-h" className={`${EYEBROW} !text-ink`}>Needs attention</h2>
      <Card className="mt-2 p-4 sm:p-5">
        <p className="font-dm-sans text-[17px] font-semibold text-ink" data-audit="needs-attention-count">
          {n} {n === 1 ? 'entry has' : 'entries have'} not reached the ranch yet.
        </p>
        <p className="mt-1 font-dm-sans text-[16px] leading-snug text-secondary-ink">
          {failed.length > 0
            ? `${failed.length === n ? (n === 1 ? 'It was' : 'They were') : `${failed.length} of them ${failed.length === 1 ? 'was' : 'were'}`} refused by the ranch: ${failed[0].lastError ?? 'the server did not accept it'}.`
            : 'They are saved on this phone and will go up on their own.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={async () => { setBusy(true); try { await flush() } finally { setBusy(false) } }}
            className="min-h-[48px] rounded-lg border px-4 font-dm-sans text-[16px] font-semibold disabled:opacity-60"
            style={{ color: warning, borderColor: warning }}
            data-audit="needs-attention-sync"
          >
            {busy ? 'Sending…' : unsyncedCount() === 1 ? 'Send it now' : 'Send them now'}
          </button>
          <Link href="/ranch/activity" className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">
            The record →
          </Link>
        </div>
      </Card>
    </section>
  )
}
