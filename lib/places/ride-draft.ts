import type { CaptureFix } from '@/lib/places/capture'
import { RIDE_DRAFT_KEY, draftDroppedForRecord, forgetDraftDropped } from '@/lib/local-space'

// ─── The ride draft (Block 21, ruling 1) ─────────────────────────────────────
//
// THE RIDE NEVER DISCARDS THE TRACK. Every fix the receiver gives during a
// perimeter ride is written here — localStorage, the same shelf the outbox
// uses — so a reload, a crash, a tab swap or a guard that will not grade the
// loop leaves the work exactly where it was. The draft lives on the phone
// only; it reaches the ranch as the evidence behind a place (capture.track in
// /api/places, no new column) the moment the ride is closed and named. It is
// cleared by a save or by the operator throwing it away — never by code that
// merely failed to make sense of it.
//
// Writes are throttled: a JSON of a long ride is a few hundred kilobytes and
// the receiver ticks once a second. Every fifth fix, or after three seconds,
// and always on demand (stop, hide, finish).

const KEY = RIDE_DRAFT_KEY
const EVERY_N = 5
const EVERY_MS = 3_000
// The outbox lives on this same shelf, and an unsent feeding that cannot be
// written is a lost record. A ride is capped well below the origin's quota so
// it can never be the reason a record fails to save: 2 MB is about seven hours
// at 1 Hz, far past any fence line, and leaves the outbox all the room it has
// ever needed. Past the cap the ride goes on — the last snapshot is kept and
// the screen says the phone has stopped keeping up.
const MAX_BYTES = 2_000_000

export interface RideDraft {
  startedAt: number
  savedAt: number
  fixes: CaptureFix[]
}

let lastWriteAt = 0
let lastWriteN = 0

/** What the phone did with the last write — the screen says so when it is not 'kept'. */
export type DraftWrite = 'kept' | 'too_big' | 'refused' | 'yielded'

export function loadRideDraft(): RideDraft | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as RideDraft
    if (!d || !Array.isArray(d.fixes) || d.fixes.length === 0) return null
    return d
  } catch { return null }
}

/** Write the ride; `force` skips the throttle. Never throws — it reports. */
export function saveRideDraft(fixes: CaptureFix[], startedAt: number, force = false): DraftWrite {
  if (fixes.length === 0) return 'kept'
  // Ruling 4: this draft has already been given up so a record could be
  // written. It stands down for the rest of the ride rather than racing the
  // outbox for the space it just freed. The ride goes on; only the crash-copy
  // is gone, and the screen says so.
  if (draftDroppedForRecord()) return 'yielded'
  const now = Date.now()
  if (!force && fixes.length - lastWriteN < EVERY_N && now - lastWriteAt < EVERY_MS) return 'kept'
  const json = JSON.stringify({ startedAt, savedAt: now, fixes } satisfies RideDraft)
  if (json.length > MAX_BYTES) return 'too_big'
  try {
    localStorage.setItem(KEY, json)
    lastWriteAt = now; lastWriteN = fixes.length
    return 'kept'
  } catch { return 'refused' }
}

export function clearRideDraft(): void {
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
  forgetDraftDropped()
  lastWriteAt = 0; lastWriteN = 0
}
