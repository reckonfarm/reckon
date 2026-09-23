// ─── The phone's shelf, and who gets it (Block 21, ruling 4) ─────────────────
//
// The outbox and the ride draft write to the same localStorage, and the shelf
// is not endless. PK's ruling settles the order: A RECORD SOMEONE MADE
// OUTRANKS A DRAFT OF ONE THEY ARE STILL MAKING. So when the shelf is tight
// the draft is what gets thrown away — never a pending record.
//
// This module owns that order. It names what may be sacrificed and it is the
// only thing that throws any of it away; lib/outbox.ts asks it for room, and
// lib/places/ride-draft.ts asks it whether it has already given way. Nothing
// else decides what a record is allowed to outrank.
//
// A draft that has been given up is NOT rewritten for the rest of that ride —
// it stands down rather than racing the outbox for the space it just freed.
// The ride itself goes on recording, and the screen says what is no longer
// being kept. Losing the crash-copy of a ride is a small loss; losing a
// feeding someone recorded in a coulee is not.

/** The ride draft's key. Declared here because this is what may be sacrificed. */
export const RIDE_DRAFT_KEY = 'dryline_ride_v1'
/** The live gate tally's key (Block 22). */
export const TALLY_KEY = 'dryline_tally_v1'

/**
 * IN THE ORDER THEY ARE GIVEN UP — and the order is the whole ruling.
 *
 * A ride draft is a copy of work still in progress: losing it costs the
 * crash-protection on a ride the operator is still holding in the app.
 * A LIVE TALLY is different. It is a number a man is building at a gate with
 * cattle going past, and losing it costs him the gather — he re-pens and
 * re-counts and the hour is gone. So the ride draft goes first, and the tally
 * is given up only if that was not enough and a record still cannot be
 * written (Block 22, ruling 3: above the ride draft, below a pending record).
 *
 * Only work-in-progress ever belongs in this list. A record someone has
 * already made is never in it.
 */
const SACRIFICIAL_KEYS = [RIDE_DRAFT_KEY, TALLY_KEY]

let droppedForRecord = false
let tallyDropped = false

/**
 * A quota refusal, under the several names browsers give it. Anything else —
 * private mode, a disabled shelf, a thrown SecurityError — is NOT a full
 * phone, and throwing a draft away would not help it.
 */
export function isQuotaError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const err = e as { name?: unknown; code?: unknown }
  return err.name === 'QuotaExceededError'
    || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || err.code === 22
    || err.code === 1014
}

/**
 * Throw away everything a record is allowed to outrank. Returns true when
 * something actually went, so the caller knows a retry is worth making.
 */
export function makeRoomForRecords(): boolean {
  let freed = false
  for (const key of SACRIFICIAL_KEYS) {
    try {
      if (localStorage.getItem(key) == null) continue
      localStorage.removeItem(key)
      freed = true
      if (key === TALLY_KEY) tallyDropped = true
      // ONE AT A TIME, cheapest first. If letting the ride draft go is enough
      // for the record to be written, the tally is never touched — which is
      // the difference between a lost crash-copy and a lost gather.
      break
    } catch {
      // Nothing further this module can do; the caller reports the failure.
    }
  }
  if (freed) droppedForRecord = true
  return freed
}

/** True once a LIVE TALLY has been given up so a record could be written. */
export function tallyDroppedForRecord(): boolean { return tallyDropped }
export function forgetTallyDropped(): void { tallyDropped = false }

/**
 * The room a record must always find. Ruling 4 says to RESERVE the outbox's
 * space, not merely to win the fight when it happens — so a draft checks that
 * this much is still free after every write, and gives way the moment it is
 * not. 64 KB is far more than any one record needs and more than the whole
 * outbox's growth; a ride's crash-copy is never worth sitting on it.
 */
export const RECORD_RESERVE_BYTES = 64 * 1024
const PROBE_KEY = '__dryline_reserve__'

/** True while a record could still be written. Leaves nothing behind either way. */
export function roomLeftForRecords(): boolean {
  try {
    localStorage.setItem(PROBE_KEY, 'r'.repeat(RECORD_RESERVE_BYTES))
    localStorage.removeItem(PROBE_KEY)
    return true
  } catch {
    try { localStorage.removeItem(PROBE_KEY) } catch { /* nothing more to do */ }
    return false
  }
}

/** True once a draft has been given up so a record could be written. */
export function draftDroppedForRecord(): boolean {
  return droppedForRecord
}

/** The ride is over — saved or thrown away — so the next one starts even. */
export function forgetDraftDropped(): void {
  droppedForRecord = false
}
