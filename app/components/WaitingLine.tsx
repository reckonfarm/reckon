'use client'

import { useState } from 'react'
import { useOutbox, useStorageFull, STATE_LABEL, type OutboxItem } from '@/lib/outbox'
import { useUndoOwnsTheSlot } from '@/lib/undo'
import { openLogIt, draftFromBody } from '@/app/dashboard/components/LogIt'

// ─── "3 waiting for signal" (Block 15, ruling 5) ──────────────────────────────
// If anything is waiting, one line says how many. Tap it to see them. That is
// the whole feature. A refused record shows here, once, with the reason on
// one line and one button: Fix (ruling 2). Nothing here retries, discards or
// sends — the outbox sends on its own; Fix opens the record; the way to throw
// one away is inside Fix, behind the numbers.
export default function WaitingLine() {
  const items = useOutbox()
  // Block 21 (ruling 5): a full phone is not a lost signal. It gets its own
  // line, ahead of the count, because what a person does about it is
  // different — free some space, not find a hilltop.
  const full = useStorageFull()
  // Block 23 (ruling 2): this line and an Undo are drawn in the same slot. For
  // the ten seconds an Undo is live it has the slot to itself; the count of
  // what is waiting has waited this long and can wait ten seconds more.
  const undoShowing = useUndoOwnsTheSlot()
  const [open, setOpen] = useState(false)
  const waiting = items.filter(i => i.state !== 'synced')
  if (waiting.length === 0 || (undoShowing && !open)) return null
  const failed = waiting.filter(i => i.state === 'failed')
  const n = waiting.length
  const line = full
    ? `${n} waiting · this phone is full`
    : failed.length === n
    ? `${n} couldn't send`
    : failed.length > 0 ? `${n} waiting · ${failed.length} couldn't send` : `${n} waiting for signal`

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 z-30 px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 64px)' }} data-audit="waiting-layer">
        <button type="button" onClick={() => setOpen(true)} className="pointer-events-auto mx-auto flex min-h-[48px] w-full max-w-2xl items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 font-dm-sans text-[16px] font-semibold text-amber-900 shadow" data-audit="waiting-line" data-count={n}>
          <span>{line}</span><span aria-hidden>›</span>
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Waiting to send" data-audit="waiting-sheet">
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-cream px-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-4 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <p className="font-dm-sans text-[17px] font-semibold text-ink">{line}</p>
            {full && (
              <p className="mt-2 rounded-lg border border-rust/40 bg-rust/5 p-3 font-dm-sans text-[16px] leading-snug text-ink" data-audit="waiting-storage">
                This phone is full, so it cannot keep anything new. Everything below is still here and still goes when there is room. Free some space on the phone — photos or an app you do not use — and it carries on by itself.
              </p>
            )}
            <ul className="mt-3 divide-y divide-rule" data-audit="waiting-list">
              {waiting.slice().reverse().map(item => <WaitingRow key={item.id} item={item} onFix={() => setOpen(false)} />)}
            </ul>
            <button type="button" onClick={() => setOpen(false)} className="mt-3 min-h-[48px] w-full font-dm-sans text-[16px] font-semibold text-secondary-ink" data-audit="waiting-close">Close</button>
          </div>
        </div>
      )}
    </>
  )
}

function WaitingRow({ item, onFix }: { item: OutboxItem; onFix: () => void }) {
  const draft = item.state === 'failed' ? draftFromBody(item.body, item.id) : null
  return (
    <li className="py-3" data-audit="waiting-row" data-state={item.state} data-id={item.id}>
      <p className="font-dm-sans text-[16px] text-ink">{item.label}</p>
      <p className={`mt-0.5 font-dm-sans text-[15px] font-semibold ${item.state === 'failed' ? 'text-rust' : 'text-amber-900'}`} data-audit="waiting-state" data-save-word>{STATE_LABEL[item.state]}</p>
      {item.state === 'failed' && item.lastError && <p className="mt-0.5 font-dm-sans text-[15px] leading-snug text-ink" data-audit="waiting-reason">{item.lastError}</p>}
      {item.state === 'failed' && (
        draft
          ? <button type="button" onClick={() => { onFix(); openLogIt(draft) }} className="mt-2 min-h-[48px] rounded-lg bg-forest-green px-5 font-dm-sans text-[16px] font-semibold text-cream" data-audit="waiting-fix">Fix</button>
          : <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="waiting-nofix">This one is a place. Open Ranch → Places to record it again.</p>
      )}
    </li>
  )
}
