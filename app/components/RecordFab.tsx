'use client'

import { usePathname } from 'next/navigation'
import { useRecordAvailable, useRecordSheetOpen } from '@/lib/record-sheet-state'
import { openLogIt } from '@/app/dashboard/components/LogIt'
import { useUndoOwnsTheSlot } from '@/lib/undo'

// ─── Record — the pill, back (Block 12, 12.1) ─────────────────────────────────
// PK liked it. It comes back UNDER the 11.4 rule, not instead of it: no
// floating element may sit over an interactive control on any screen.
//
// Two things make that true with a pill on the page:
//   · the phone body reserves room for the bar AND the pill zone above it
//     (globals.css), so anything on a page can always be scrolled clear;
//   · the overlap check in the daily loop iterates every fixed element and
//     asks the browser what is on top at the centre of every control beneath
//     it — on ten screens at 390 and 320. The pill is tested the moment it
//     exists. If it cannot pass, the bar keeps Record and this file goes.
//
// Gated on a sheet actually being mounted (useRecordAvailable): the bar
// taught us that a Record control in the root layout is offered to signed-out
// visitors too, and a button that does nothing is the same defect class as
// one you cannot reach. Hidden while a sheet is open, so it never covers a
// form control or the keyboard. Desktop keeps the header's Record.

const HIDDEN_ON = ['/signin', '/auth', '/invite', '/terms', '/privacy']

export default function RecordFab() {
  const pathname = usePathname()
  const sheetOpen = useRecordSheetOpen()
  const available = useRecordAvailable()
  // Block 23 (ruling 2): an Undo owns the bottom of the screen while it is
  // showing. The pill is the thing that used to cover it, so the pill goes —
  // for ten seconds, on a screen where the person's next tap is Undo or
  // nothing.
  const undoShowing = useUndoOwnsTheSlot()
  if (!available || sheetOpen || undoShowing) return null
  if (pathname === '/' || HIDDEN_ON.some(p => pathname.startsWith(p))) return null
  return (
    <button
      type="button"
      onClick={() => openLogIt({ type: null })}
      aria-label="Record work"
      data-audit="record-fab"
      className="fixed right-4 z-40 flex h-14 items-center gap-2 rounded-full bg-forest-green pl-4 pr-5 font-dm-sans text-[17px] font-semibold text-cream shadow-lg ring-4 ring-cream md:hidden"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)' }}
    >
      <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      Record
    </button>
  )
}
