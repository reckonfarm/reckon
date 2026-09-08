'use client'

import { useSyncExternalStore } from 'react'

// ─── Is a record sheet open? (Block 6A) ───────────────────────────────────────
// One tiny store the sheet writes and the Record FAB reads, so the FAB is gone
// the moment a sheet is up — it never covers a form control or the keyboard.
// Mirrored onto <html data-record-sheet="open"> so the smoke can measure it.

let openNow = false
const listeners = new Set<() => void>()

export function setRecordSheetOpen(open: boolean): void {
  if (openNow === open) return
  openNow = open
  try { if (open) document.documentElement.dataset.recordSheet = 'open'; else delete document.documentElement.dataset.recordSheet } catch { /* SSR */ }
  for (const l of listeners) l()
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }

export function useRecordSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, () => openNow, () => false)
}
