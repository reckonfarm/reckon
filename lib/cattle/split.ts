import { LOT_CLASS_LABELS, type Lot, type LotClass } from '@/lib/herd'
import { MAX_GROUP_NAME } from './kinds'

// ─── Splitting a bunch — the one place (Block 19, ruling 1) ───────────────────
//
// Splitting cattle is not a preg-check feature. It is what a person does to a
// bunch: some head leave, they become their own bunch, and the one they came
// from drops by that many. PK's 220 replacement heifers could not be split for
// exactly this reason — the only split the app had lived inside the preg
// check, and that bunch never came through one.
//
// So the split lives HERE, once. The split sheet calls it. The preg check
// calls it. There is no second implementation to drift.
//
// THE ARITHMETIC IS NOT HERE. Migration 071 owns it: the count is what the
// bunch holds now, what stays is the rest, and p_counted / p_stay are ignored
// for a split so that nothing on this side can work it out, disagree, and be
// believed. What is here is the SHAPE of the request and the WORDS — and the
// words below are the database's own, letter for letter, pinned by
// scripts/split-harness.ts so the two can never drift apart. They are shown in
// the sheet only so that a person standing in a corral with no signal gets the
// answer now instead of when the phone next finds a bar.

/** Migration 071's refusal when more head leave than the bunch holds. */
export const splitTooManyMessage = (leaving: number, head: number) =>
  `${leaving} head cannot leave a bunch of ${head}.`

/** Migration 071's refusal when nothing is actually leaving. */
export const SPLIT_NEEDS_ONE = 'A split has to move at least one head.'

/**
 * The only thing a split can get wrong, said the way the ranch will say it.
 * Null means nothing here is untrue — which is not the same as "it will save":
 * the database is still the gate, and it answers for itself.
 */
export function splitRefusal(leaving: number, head: number): string | null {
  if (!Number.isFinite(leaving) || !Number.isInteger(leaving) || leaving < 1) return SPLIT_NEEDS_ONE
  if (leaving > head) return splitTooManyMessage(leaving, head)
  return null
}

// ─── What the new bunch is called, and what it is ────────────────────────────
// Block 15 set these for the preg check and they belong to the split now that
// the split is its own action: cows, old cows and pairs that leave are culls;
// any other class keeps its class (open yearling heifers are still heifers).
// A plain split offers the source's own class instead — nothing about a bunch
// splitting in two says the ones leaving are culls.

export function defaultSplitClass(source: LotClass, opts: { culls?: boolean } = {}): LotClass {
  if (!opts.culls) return source
  return source === 'cows' || source === 'old_cows' || source === 'pairs' ? 'old_cows' : source
}

export function defaultSplitName(source: Lot, today: string, opts: { culls?: boolean } = {}): string {
  const what = source.class === 'cows' || source.class === 'old_cows' || source.class === 'pairs'
    ? 'cows'
    : LOT_CLASS_LABELS[source.class].toLowerCase()
  return opts.culls ? `Open ${what} ${today}` : `${what.charAt(0).toUpperCase()}${what.slice(1)} off ${lotShort(source)} ${today}`
}

const lotShort = (l: Lot) => (l.name?.trim() ? l.name.trim().slice(0, 16) : LOT_CLASS_LABELS[l.class].toLowerCase())

// ─── The request ─────────────────────────────────────────────────────────────

export interface SplitGroup {
  lot_id: null
  name: string
  class: LotClass
  head: number
}

/**
 * The group that leaves. One shape, whether a split sheet built it or a preg
 * check did — which is what stops the two from disagreeing about what a split
 * even is.
 */
export function splitGroup(head: number, name: string, klass: LotClass): SplitGroup {
  return { lot_id: null, name: name.trim().slice(0, MAX_GROUP_NAME), class: klass, head }
}

export interface SplitBodyIn {
  id: string
  source: Lot
  head: number
  name: string
  class: LotClass
  ts?: string
}

/**
 * The whole request for a plain split, ready for the outbox.
 *
 * counted and stay are sent as zero and say so: 071 ignores them for a split
 * and works both out from the bunch itself. Sending the numbers we think they
 * are would be a second opinion the database never asked for, and a second
 * opinion is how 070 changed nothing for a day.
 */
export function splitBody(input: SplitBodyIn): Record<string, unknown> {
  return {
    id: input.id,
    type: 'group_action',
    action: 'split',
    source_lot_id: input.source.id,
    expected_head: input.source.head_count,
    counted: 0,
    stay: 0,
    results: [splitGroup(input.head, input.name, input.class)],
    ...(input.ts ? { ts: input.ts } : {}),
  }
}

/** The line the strip and the record show. */
export function splitLabel(source: Lot, head: number, name: string): string {
  const from = source.name?.trim() ? source.name.trim() : LOT_CLASS_LABELS[source.class]
  return `Split · ${head} head from ${from} to ${name.trim()}`
}
