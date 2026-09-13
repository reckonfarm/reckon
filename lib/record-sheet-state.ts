'use client'

import { useSyncExternalStore } from 'react'

// ─── Is a record sheet open, and is there one at all? (Block 6A / 11) ─────────
// One tiny store the sheet writes and the bar's Record item reads, so Record
// is gone the moment a sheet is up — it never covers a form control or the
// keyboard. Mirrored onto <html data-record-sheet="open"> so the smoke can
// measure it.
//
// Block 11: `available` was added when Record moved from the FAB into the
// bottom bar (11.4). The FAB lived INSIDE RecordSheetHost, which mounts only
// for a signed-in person, so being signed out made it disappear for free. The
// bar is in the root layout and renders for everyone, so without this a
// signed-out visitor would get a Record button with no sheet behind it — a
// control that does nothing, which is the same defect class as a control you
// cannot reach. The host reports its own presence; the bar believes it.

let openNow = false
let availableNow = false
const listeners = new Set<() => void>()

/** RecordSheetHost calls this when it mounts for a signed-in person, and false on the way out. */
export function setRecordAvailable(available: boolean): void {
  if (availableNow === available) return
  availableNow = available
  for (const l of listeners) l()
}

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

/** True only while a record sheet is actually mounted to receive the tap. */
export function useRecordAvailable(): boolean {
  return useSyncExternalStore(subscribe, () => availableNow, () => false)
}
