import { dayKey, todayKey } from '@/lib/jobs/format'
import { MIN_FEED_DAYS, type HayEntry, type OnHand } from './queries'

// ─── Will the hay reach grass? (Block 9) ──────────────────────────────────────
//
// The hay ledger already answers "how long at the rate I have been feeding".
// That is a runway with no runway's end. This adds the target — the day the
// cattle go back to grass — and answers the only question that changes what a
// man does in November: do I have enough, and if not, how short am I.
//
// PK's rulings, and where each one lives:
//
//  * WORST CASE IS TWO DATES, NOT A WORST RATE. "Two dates is a question I can
//    act on; a worst rate is a number I'd argue with." So the answer is a
//    pair: turnout as he expects it, and turnout LATE_DAYS late. One rate,
//    two targets.
//
//  * THE RATE COMES FROM HIS OWN LEDGER — his worst sustained fourteen days
//    this winter, not climatology and not a new data source. Planning at the
//    trailing average is planning for an average winter, which is not what the
//    hay has to survive.
//
//  * IF THERE IS NOT ENOUGH WINTER YET, SAY SO PLAINLY INSTEAD OF SUBSTITUTING
//    SOMETHING. A ledger that does not yet span fourteen days has no worst
//    fourteen days in it. The rate is then measured over what there is and
//    reports `full: false`, and the surface must never call that a worst case.
//
//  * THE ANSWER APPEARS BEFORE THE RUN-OUT DATE'S GATE DOES. The run-out
//    projection in lib/hay/queries stays behind MIN_FEED_DAYS, because a date
//    is a claim. This is a comparison, and it is useful the first week — "5
//    days of feeding so far — this will sharpen" beats a blank screen in
//    November when the decision is whether to buy hay. `thin` says which.
//
// Pure, so scripts/hay-ledger-harness.ts locks every number without a database.

/** The window a "sustained" rate is measured over. Matches BURN_WINDOW_DAYS. */
export const WORST_WINDOW_DAYS = 14

/** How late the second date is. Three weeks, PK's number. */
export const LATE_DAYS = 21

const DAY_MS = 86_400_000

/** Whole ranch days from one 'YYYY-MM-DD' key to another. */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T12:00:00Z`) - Date.parse(`${fromKey}T12:00:00Z`)) / DAY_MS)
}

/** 'YYYY-MM-DD' n days after a key. */
export function addDays(key: string, n: number): string {
  return dayKey(Date.parse(`${key}T12:00:00Z`) + n * DAY_MS)
}

export interface Stretch {
  balesPerDay: number
  bales: number      // fed inside the measured window
  from: string       // ranch-day keys bounding it
  to: string
  days: number       // the span the rate was divided by
  /** True when a complete WORST_WINDOW_DAYS window was available to measure. */
  full: boolean
}

/**
 * The heaviest sustained feeding in the ledger: the WORST_WINDOW_DAYS window
 * with the most bales in it, anywhere between the first line and today. Quiet
 * days inside a window count as zero — that is what "sustained" means, and it
 * is why the answer is not simply the busiest day.
 *
 * When the ledger does not yet span a full window there is no worst fourteen
 * days to find, so the rate is measured over everything there is and `full`
 * is false. The caller must say so rather than dress it up.
 */
export function worstStretch(entries: HayEntry[], nowMs: number = Date.now()): Stretch | null {
  const fed = entries.filter(e => e.type === 'hay_fed')
  if (fed.length === 0) return null

  const perDay = new Map<string, number>()
  for (const e of fed) perDay.set(dayKey(e.ts), (perDay.get(dayKey(e.ts)) ?? 0) + e.bales)

  const today = todayKey(nowMs)
  // The domain starts at the first line of ANY kind — a count then a week of
  // feeding is a week of ledger, not a week of feeding history.
  const first = entries.reduce((a, e) => (dayKey(e.ts) < a ? dayKey(e.ts) : a), today)
  const span = daysBetween(first, today) + 1

  const sum = (fromKey: string, toKey: string) => {
    let n = 0
    for (const [k, v] of perDay) if (k >= fromKey && k <= toKey) n += v
    return n
  }

  if (span < WORST_WINDOW_DAYS) {
    const bales = sum(first, today)
    return { balesPerDay: bales / span, bales, from: first, to: today, days: span, full: false }
  }

  let best: Stretch | null = null
  for (let end = WORST_WINDOW_DAYS - 1; end < span; end++) {
    const to = addDays(first, end)
    const from = addDays(to, -(WORST_WINDOW_DAYS - 1))
    const bales = sum(from, to)
    if (!best || bales > best.bales) {
      best = { balesPerDay: bales / WORST_WINDOW_DAYS, bales, from, to, days: WORST_WINDOW_DAYS, full: true }
    }
  }
  return best
}

export interface Scenario {
  /** 'YYYY-MM-DD' the cattle go to grass in this scenario. */
  date: string
  /** Whole ranch days from today to that date. */
  days: number
  /** Bales the rate says it takes to get there — the DISPLAYED figure. */
  needed: number
  /** True when what is on hand covers `needed`. */
  reaches: boolean
  /** needed − on hand, when short. Zero otherwise. */
  short: number
  /** on hand − needed, when it reaches. Zero otherwise. */
  spare: number
  /** The ranch day the stack hits zero at this rate. Only when short. */
  runShort: string | null
}

// Every figure the surface prints is the one the arithmetic used, so a man who
// checks it on the back of an envelope gets the same answer (the 6C rule).
function scenario(turnout: string, today: string, onHand: number, rate: number): Scenario {
  const days = daysBetween(today, turnout)
  const needed = Math.round(rate * days)
  const reaches = onHand >= needed
  return {
    date: turnout,
    days,
    needed,
    reaches,
    short: reaches ? 0 : needed - onHand,
    spare: reaches ? onHand - needed : 0,
    runShort: reaches ? null : addDays(today, Math.floor(onHand / rate)),
  }
}

export type PlanWithheld =
  /** No turnout date set — the one thing only he can answer. */
  | 'no_turnout'
  /** The turnout he set has come and gone. */
  | 'turnout_past'
  /** No counted baseline, so there is no on-hand to compare against. */
  | 'no_baseline'
  /** Nothing fed yet, so there is no rate of his own to plan at. */
  | 'no_feeding'

export interface HayPlan {
  turnout: string
  onHand: number
  rate: Stretch
  expected: Scenario
  late: Scenario
  /** Distinct feeding days behind the rate. */
  feedDays: number
  /** Under MIN_FEED_DAYS — the answer still shows, and says this. */
  thin: boolean
  withheld?: undefined
}

/**
 * The pair. One rate, two targets, both answered as bales needed against bales
 * on hand — and, when short, the day the stack runs out.
 */
export function planToTurnout(
  input: { turnout: string | null; onHand: OnHand | null; entries: HayEntry[] },
  nowMs: number = Date.now(),
): HayPlan | { withheld: PlanWithheld } {
  const { turnout, onHand, entries } = input
  if (!turnout) return { withheld: 'no_turnout' }
  const today = todayKey(nowMs)
  if (daysBetween(today, turnout) <= 0) return { withheld: 'turnout_past' }
  if (!onHand) return { withheld: 'no_baseline' }
  const rate = worstStretch(entries, nowMs)
  if (!rate || rate.balesPerDay <= 0) return { withheld: 'no_feeding' }

  const feedDays = new Set(entries.filter(e => e.type === 'hay_fed').map(e => dayKey(e.ts))).size
  return {
    turnout,
    onHand: onHand.bales,
    rate,
    expected: scenario(turnout, today, onHand.bales, rate.balesPerDay),
    late: scenario(addDays(turnout, LATE_DAYS), today, onHand.bales, rate.balesPerDay),
    feedDays,
    thin: feedDays < MIN_FEED_DAYS,
  }
}
