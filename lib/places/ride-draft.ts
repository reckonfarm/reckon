import type { CaptureFix } from '@/lib/places/capture'

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

const KEY = 'dryline_ride_v1'
const EVERY_N = 5
const EVERY_MS = 3_000

export interface RideDraft {
  startedAt: number
  savedAt: number
  fixes: CaptureFix[]
}

let lastWriteAt = 0
let lastWriteN = 0

export function loadRideDraft(): RideDraft | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as RideDraft
    if (!d || !Array.isArray(d.fixes) || d.fixes.length === 0) return null
    return d
  } catch { return null }
}

/** Write the ride; `force` skips the throttle. Returns false when the phone would not keep it. */
export function saveRideDraft(fixes: CaptureFix[], startedAt: number, force = false): boolean {
  if (fixes.length === 0) return true
  const now = Date.now()
  if (!force && fixes.length - lastWriteN < EVERY_N && now - lastWriteAt < EVERY_MS) return true
  try {
    localStorage.setItem(KEY, JSON.stringify({ startedAt, savedAt: now, fixes } satisfies RideDraft))
    lastWriteAt = now; lastWriteN = fixes.length
    return true
  } catch { return false }
}

export function clearRideDraft(): void {
  try { localStorage.removeItem(KEY) } catch { /* private mode */ }
  lastWriteAt = 0; lastWriteN = 0
}
