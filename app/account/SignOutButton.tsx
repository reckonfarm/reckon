'use client'

import { useState } from 'react'
import { flush, unsyncedCount } from '@/lib/outbox'
import { signOutEverywhere } from '@/lib/private-state'
import { Card } from '@/app/components/ui/Card'
import { warning } from '@/lib/brand-colors'

// ─── Sign out, without silently losing work (Block 7.1) ───────────────────────
//
// What this replaced: a native window.confirm reading "Some entries have not
// synced to the ranch yet. Sign out anyway and lose them?" — a system dialog
// that offered no way to fix the problem it named, and that never appeared at
// all for a FAILED entry, because the guard counted only local|queued. A
// rejected entry is unsynced work; clearPrivateState() deletes it either way.
// It now asks unsyncedCount(), which includes failed.
//
// The order of operations is the point. Sign-out first TRIES to sync, because
// the honest answer to "3 entries haven't reached the ranch" is usually to
// send them, not to make the operator choose. Only what is still stuck after
// that reaches the sheet, and the sheet says how many and what each button
// does to them. Nothing is discarded without the word "discard" being tapped.
//
// Everything else about sign-out is unchanged: signOutEverywhere ends the
// session, clears every private key, and loads a fresh signed-out document.

type Mode = 'idle' | 'syncing' | 'blocked' | 'going'

export default function SignOutButton() {
  const [mode, setMode] = useState<Mode>('idle')
  const [stuck, setStuck] = useState(0)

  async function begin() {
    if (unsyncedCount() === 0) { setMode('going'); await signOutEverywhere('/'); return }
    setMode('syncing')
    try { await flush() } catch { /* whatever is left is counted below */ }
    const left = unsyncedCount()
    if (left === 0) { setMode('going'); await signOutEverywhere('/'); return }
    setStuck(left)
    setMode('blocked')
  }

  if (mode === 'blocked') {
    const n = stuck
    return (
      <Card className="mt-3 p-4 sm:p-5" role="dialog" aria-modal="true" aria-label="Entries not yet synced" data-audit="signout-block">
        <p className="font-dm-sans text-[17px] font-semibold text-ink" data-audit="signout-block-count">
          {n} {n === 1 ? 'entry hasn’t' : 'entries haven’t'} reached the ranch yet.
        </p>
        <p className="mt-1 font-dm-sans text-[16px] leading-snug text-secondary-ink">
          {n === 1
            ? 'It is on this phone only. Signing out clears the phone, so it would be gone for good.'
            : 'They are on this phone only. Signing out clears the phone, so they would be gone for good.'}
        </p>
        <button
          type="button"
          onClick={() => { setMode('idle'); setStuck(0) }}
          className="mt-4 min-h-[52px] w-full rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream"
          data-audit="signout-stay"
        >
          Stay signed in
        </button>
        <button
          type="button"
          onClick={async () => { setMode('going'); await signOutEverywhere('/') }}
          className="mt-2 min-h-[52px] w-full rounded-lg border px-4 font-dm-sans text-[17px] font-semibold"
          style={{ color: warning, borderColor: warning }}
          data-audit="signout-discard"
        >
          Sign out and discard {n === 1 ? 'the entry' : `all ${n} entries`}
        </button>
      </Card>
    )
  }

  return (
    <button
      type="button"
      onClick={begin}
      disabled={mode !== 'idle'}
      className="mt-3 inline-flex min-h-[48px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink hover:bg-forest-green/5 disabled:opacity-60"
      data-audit="sign-out"
    >
      {mode === 'syncing' ? 'Sending what’s left…' : mode === 'going' ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
