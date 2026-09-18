import { TALLY_KEY, tallyDroppedForRecord, forgetTallyDropped } from '@/lib/local-space'

// ─── The tally at the gate (Block 22) ────────────────────────────────────────
//
// A man stands at a gate. Cattle come through in ones, twos, threes, fours. He
// taps. At the end he has a number he trusts. He is wearing gloves, watching
// cattle and not the screen, and if the count is lost he re-gathers and
// re-counts and loses an hour of daylight.
//
// So this module has one job and takes it seriously: EVERY TAP IS WRITTEN
// BEFORE ANYTHING ELSE HAPPENS. Not batched, not debounced, not written on a
// timer — written, then the screen catches up. A tap that reached the phone is
// on the phone. Killing the app after forty-seven taps returns forty-seven.
//
// THE TAPS ARE KEPT, NOT THE TOTAL. Undo removes the last TAP, not the last
// animal (ruling 4), so the list of taps is the record and the total is
// derived from it. Storing a total and subtracting would make "undo" a guess
// about what was added last, and at a gate the operator knows exactly what he
// just pressed.
//
// WHERE IT SITS WHEN THE PHONE IS FULL (ruling 3): above the ride draft and
// below a pending record. lib/local-space.ts owns that order — a live count
// outranks a draft of one, and a record someone already made outranks both.

/** What one tap can be. Not a step size the operator sets once — a choice per bunch. */
export const TAP_SIZES = [1, 2, 3, 4] as const
export type TapSize = (typeof TAP_SIZES)[number]

export interface Tally {
  startedAt: number
  savedAt: number
  /** Every tap, in order. The total is their sum; undo drops the last one. */
  taps: TapSize[]
  /** The bunch this count is about, when it was started from one. */
  lotId: string | null
}

/** What the phone did with a tap. Anything but 'kept' has to reach the screen. */
export type TallyWrite = 'kept' | 'refused'

export const total = (taps: readonly TapSize[]): number => taps.reduce((n, t) => n + t, 0)

export function loadTally(): Tally | null {
  try {
    const raw = localStorage.getItem(TALLY_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as Tally
    if (!t || !Array.isArray(t.taps)) return null
    const taps = t.taps.filter((n): n is TapSize => (TAP_SIZES as readonly number[]).includes(n))
    return { startedAt: Number(t.startedAt) || Date.now(), savedAt: Number(t.savedAt) || Date.now(), taps, lotId: typeof t.lotId === 'string' ? t.lotId : null }
  } catch {
    return null
  }
}

/**
 * Write the count. Synchronous and unthrottled on purpose — a tally is a few
 * hundred bytes after a hundred taps, and the whole point is that the write
 * has already happened by the time the screen moves.
 *
 * Never throws. A phone that will not keep the count says so on the screen;
 * it is not reported as anything to do with the network (Block 21, ruling 5).
 */
export function saveTally(t: Tally): TallyWrite {
  try {
    localStorage.setItem(TALLY_KEY, JSON.stringify({ ...t, savedAt: Date.now() }))
    return 'kept'
  } catch {
    return 'refused'
  }
}

export function clearTally(): void {
  try { localStorage.removeItem(TALLY_KEY) } catch { /* private mode */ }
  forgetTallyDropped()
}

/** True when a record has taken the count's space — the screen must say so. */
export const tallyWasDropped = tallyDroppedForRecord

// ── The two things the operator does ─────────────────────────────────────────
// Both return the NEW tally and what the phone did with it, so a caller cannot
// show a total the phone has not kept.

export function addTap(t: Tally, size: TapSize): { tally: Tally; wrote: TallyWrite } {
  const tally: Tally = { ...t, taps: [...t.taps, size] }
  return { tally, wrote: saveTally(tally) }
}

/**
 * Ruling 4: undo removes the last TAP. It returns what it removed so the
 * screen can say "removed +3" — at a gate, "undone" is not enough to know
 * whether the right thing went.
 */
export function undoTap(t: Tally): { tally: Tally; removed: TapSize | null; wrote: TallyWrite } {
  if (t.taps.length === 0) return { tally: t, removed: null, wrote: 'kept' }
  const removed = t.taps[t.taps.length - 1]
  const tally: Tally = { ...t, taps: t.taps.slice(0, -1) }
  return { tally, removed, wrote: saveTally(tally) }
}

export function startTally(lotId: string | null = null): Tally {
  const t: Tally = { startedAt: Date.now(), savedAt: Date.now(), taps: [], lotId }
  saveTally(t)
  return t
}
