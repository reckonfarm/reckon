// ─── Block 25: a move names its bunch ────────────────────────────────────────
// ONE wording for a move, everywhere a person reads one — the receipt, the
// waiting line, Activity, Today, a place's history, the trash. A bunch is never
// just a name, so it reads name · class · head; the head is the head MOVED,
// which is what was recorded, never the bunch's size today read back into the
// past.
//
// A move from before Block 25 may name no bunch. It is never given one: the
// line says so plainly instead of reading as if nothing were missing.
import { LOT_CLASS_LABELS, lotLabel, type Lot } from '@/lib/herd'

export type MovedBunch = { name?: string | null; class: Lot['class']; deleted?: boolean }

export const NO_BUNCH_NAMED = 'no bunch named'
/** Block 28: the one mark for a place or bunch that is in the trash, wherever history still names it.
 *  Not "removed" — that already means a voided entry, and one word cannot mean two things on a line. */
export const REMOVED = 'in trash'
export const removedName = (name: string, removed: boolean | null | undefined) => (removed ? `${name} (${REMOVED})` : name)
/** The refusal, said by the record route and shown by the sheet before it — one string, two places. */
export const MOVE_NEEDS_BUNCH = 'Pick the bunch you moved.'

/** " · no bunch named" for a move that names none — said LAST, after where they went. */
export const unnamed = (bunch: MovedBunch | null) => (bunch ? '' : ` · ${NO_BUNCH_NAMED}`)

/** "Fall Cows · Cows · 40 head" — or just "40 head" when no bunch was named. */
export function movedWho(head: number | null, bunch: MovedBunch | null): string {
  const n = head == null ? null : `${head.toLocaleString('en-US')} head`
  if (!bunch) return n ?? 'Cattle'
  const name = removedName(lotLabel({ class: bunch.class, name: bunch.name ?? undefined }), bunch.deleted)
  // An unnamed bunch is called by its class already — do not say it twice.
  return [name, bunch.name?.trim() ? LOT_CLASS_LABELS[bunch.class] : null, n].filter(Boolean).join(' · ')
}

export function moveRoute(from: string | null, to: string | null): string {
  return from && to ? ` ${from} → ${to}` : to ? ` to ${to}` : from ? ` from ${from}` : ''
}

/** "Moved Fall Cows · Cows · 40 head West pasture → East pasture" · "Moved 12 head to East pasture · no bunch named" */
export function moveLine(head: number | null, bunch: MovedBunch | null, from: string | null, to: string | null, placement = false): string {
  // Block 25b: a bunch given a place with no move behind it — made there, or
  // made by a working where its source stood — was PLACED, never "moved".
  if (placement) return `${movedWho(head, bunch)} placed${to ? ` at ${to}` : ''}${unnamed(bunch)}`
  return `Moved ${movedWho(head, bunch)}${moveRoute(from, to)}${unnamed(bunch)}`
}

/** payload.placement === true — the one test for "placed, not moved". */
export const isPlacement = (payload: Record<string, unknown> | null | undefined) => payload?.placement === true

/** Block 25b (ruling 2): what a bunch with no live move reads as. */
export const NO_PLACE_RECORDED = 'No place recorded'
