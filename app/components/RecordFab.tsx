'use client'

import { usePathname } from 'next/navigation'
import { useRecordSheetOpen } from '@/lib/record-sheet-state'
import { openLogIt } from '@/app/dashboard/components/LogIt'

// ─── Record — the one action (Block 6A) ───────────────────────────────────────
// Mobile: a FAB above the bottom bar, clear of the safe area, hidden while any
// record sheet is open. Desktop: the header carries a Record button instead
// (SiteHeader). Record is an action, never a destination. Rendered only for a
// signed-in person (the host that mounts the sheet gates on the session).

const HIDDEN_ON = ['/signin', '/auth', '/invite', '/terms', '/privacy']

export default function RecordFab() {
  const pathname = usePathname()
  const sheetOpen = useRecordSheetOpen()
  if (HIDDEN_ON.some(p => pathname.startsWith(p)) || pathname === '/') return null
  if (sheetOpen) return null
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
