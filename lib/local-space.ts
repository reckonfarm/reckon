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

/** In the order they are given up. Only drafts ever belong in this list. */
const SACRIFICIAL_KEYS = [RIDE_DRAFT_KEY]

let droppedForRecord = false

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
    } catch {
      // Nothing further this module can do; the caller reports the failure.
    }
  }
  if (freed) droppedForRecord = true
  return freed
}

/** True once a draft has been given up so a record could be written. */
export function draftDroppedForRecord(): boolean {
  return droppedForRecord
}

/** The ride is over — saved or thrown away — so the next one starts even. */
export function forgetDraftDropped(): void {
  droppedForRecord = false
}
