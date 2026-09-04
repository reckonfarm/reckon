import type { SupabaseClient } from '@supabase/supabase-js'
import { dayKey } from '@/lib/jobs/format'

// ─── Hay ledger — the operator's own hay lines, added up honestly ─────────────
//
// Typed functions over a passed-in SupabaseClient (user-scoped SSR client on
// pages → RLS exercised; service client in scripts), the lib/detections/
// queries doctrine: the query layer is the API, a route handler later is just
// transport. Returns empty on error, never throws — /home must render.
//
// Pure derivation over manual events (payload->>source = 'manual'):
//   bales_stacked {count}          → hay in
//   hay_fed       {bales}          → hay out
//   hay_inventory {bales, as_of}   → a counted baseline ("N bales on hand as of D")
// No table, no migration. NOTHING here is a hay marketplace concern — the
// hay_* tables and lib/hay-service.ts are radar/listings and untouched.
//
// Provenance on every number (jobs doctrine): a total says how many entries
// stand behind it; a rate says how many of its window's days actually had an
// entry. Hay ON HAND is NEVER stacked − fed alone — the logs can't know what
// was in the stack before logging started. It exists only when a counted
// baseline does, and it is labeled with that baseline's date.

export const HAY_EVENT_TYPES = ['bales_stacked', 'hay_fed', 'hay_inventory'] as const
export type HayEventType = (typeof HAY_EVENT_TYPES)[number]

export interface HayEntry {
  id: string
  type: HayEventType
  ts: string                 // ISO — when it happened (operator-stated)
  bales: number              // count | bales | bales — the one number every line carries
  place_id: string | null
  herd_lot_id: string | null // hay_fed only
  as_of: string | null       // hay_inventory only, 'YYYY-MM-DD' ranch day
}

export interface Provenanced {
  bales: number
  entries: number
}

export interface BurnRate {
  balesPerDay: number        // bales fed ÷ windowDays — a rate over the WHOLE window
  windowDays: number         // 14
  daysWithEntries: number    // of those 14, how many had at least one hay_fed line
  bales: number              // bales fed inside the window
  entries: number
  from: string               // ranch-day keys bounding the window
  to: string
}

export interface Baseline {
  bales: number
  asOf: string               // 'YYYY-MM-DD'
  loggedAt: string           // ISO ts of the hay_inventory entry
}

export interface OnHand {
  bales: number              // baseline + stackedSince − fedSince (may go negative — say so, don't hide it)
  baseline: Baseline
  stackedSince: Provenanced
  fedSince: Provenanced
}

// A run-out date is a PROJECTION, never a fact. It exists only when BOTH a
// counted baseline exists AND feeding has been logged on at least
// MIN_FEED_DAYS distinct days — and it always carries its basis. Thin data
// gets the burn rate alone and no date.
export interface RunOut {
  date: string               // 'YYYY-MM-DD' ranch day the stack reaches zero at this rate
  daysLeft: number           // onHand ÷ balesPerDay, rounded down
  basis: {
    balesPerDay: number
    windowDays: number
    daysWithEntries: number  // of the window
    feedDaysLogged: number   // distinct feeding days overall — the gate
    onHandBales: number
    baselineAsOf: string
  }
  withheld?: undefined
}

export type RunOutVerdict =
  | RunOut
  | { date?: undefined; withheld: 'no_baseline' | 'thin_feeding' | 'no_recent_feeding' | 'nothing_left' }

export interface HaySummary {
  stacked: Provenanced | null
  fed: (Provenanced & { days: number; first: string; last: string }) | null
  burnRate: BurnRate | null  // null when nothing was fed in the trailing window
  range: { from: string; to: string } | null   // ISO ts of first/last hay line of any kind
  baseline: Baseline | null
  onHand: OnHand | null      // only with a baseline — never from logs alone
  runOut: RunOutVerdict      // a date only when the gates pass; otherwise says which gate held it
}

export interface HayLedger {
  entries: HayEntry[]        // every hay line, oldest first
  summary: HaySummary
}

export const BURN_WINDOW_DAYS = 14
export const MIN_FEED_DAYS = 7

const EMPTY: HayLedger = {
  entries: [],
  summary: { stacked: null, fed: null, burnRate: null, range: null, baseline: null, onHand: null, runOut: { withheld: 'no_baseline' } },
}

interface EventRow {
  id: string
  type: string
  ts: string
  payload: Record<string, unknown> | null
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

function toEntry(r: EventRow): HayEntry | null {
  const p = r.payload ?? {}
  if (p.source !== 'manual') return null
  let bales: number | null = null
  let as_of: string | null = null
  switch (r.type) {
    case 'bales_stacked': bales = num(p.count); break
    case 'hay_fed':       bales = num(p.bales); break
    case 'hay_inventory': bales = num(p.bales); as_of = str(p.as_of); if (!as_of) return null; break
    default: return null
  }
  if (bales == null) return null
  return {
    id: r.id,
    type: r.type as HayEventType,
    ts: r.ts,
    bales,
    place_id: str(p.place_id),
    herd_lot_id: str(p.herd_lot_id),
    as_of,
  }
}

// Hard cap on one ledger read. PostgREST silently truncates at 1,000 anyway;
// saying it out loud keeps the truncation a known quantity (a daily feeding
// line for a year is ~200 rows).
export const HAY_ROW_CAP = 1000

// Reads the hay lines (RLS-scoped by the caller's client) and derives the
// summary. `since` (ISO) trims the read; `now` fixes the burn-rate window
// (tests pass it; pages let it default).
//
// The baseline survives the floor: hay ON HAND exists only with a counted
// baseline (the most recent hay_inventory line), and that count may predate
// `since` — a November count feeding a January ledger. So when a floor is
// given, the latest count is read on its own (one row) and merged in if the
// bounded read didn't already carry it. The season totals (stacked / fed /
// burn rate) stay bounded; only the anchor is exempt.
export async function getHayLedger(
  supabase: SupabaseClient,
  opts: { since?: string; now?: number } = {},
): Promise<HayLedger> {
  try {
    let q = supabase
      .from('events')
      .select('id, type, ts, payload')
      .in('type', [...HAY_EVENT_TYPES])
      .eq('payload->>source', 'manual')
      .order('ts', { ascending: true })
      .limit(HAY_ROW_CAP)
    if (opts.since) q = q.gte('ts', opts.since)
    const { data, error } = await q
    if (error) return EMPTY
    const rows = (data ?? []) as EventRow[]

    if (opts.since && !rows.some(r => r.type === 'hay_inventory')) {
      const { data: latestCount } = await supabase
        .from('events')
        .select('id, type, ts, payload')
        .eq('type', 'hay_inventory')
        .eq('payload->>source', 'manual')
        .order('ts', { ascending: false })
        .limit(1)
      for (const r of (latestCount ?? []) as EventRow[]) rows.push(r)
    }

    const entries = rows.map(toEntry).filter((e): e is HayEntry => e !== null)
    return { entries, summary: summarizeHay(entries, opts.now) }
  } catch {
    return EMPTY
  }
}

// Pure: entries (any order) → summary. Exported so the harness can lock it
// without a database.
export function summarizeHay(input: HayEntry[], nowMs: number = Date.now()): HaySummary {
  const entries = [...input].sort((a, b) => a.ts.localeCompare(b.ts))
  if (entries.length === 0) return EMPTY.summary

  const stackedRows = entries.filter(e => e.type === 'bales_stacked')
  const fedRows = entries.filter(e => e.type === 'hay_fed')
  const invRows = entries.filter(e => e.type === 'hay_inventory')

  const sum = (rows: HayEntry[]): Provenanced => ({
    bales: rows.reduce((s, e) => s + e.bales, 0),
    entries: rows.length,
  })

  const stacked = stackedRows.length > 0 ? sum(stackedRows) : null

  let fed: HaySummary['fed'] = null
  if (fedRows.length > 0) {
    const days = new Set(fedRows.map(e => dayKey(e.ts)))
    fed = { ...sum(fedRows), days: days.size, first: fedRows[0].ts, last: fedRows[fedRows.length - 1].ts }
  }

  // Trailing window: the 14 ranch days ending today (inclusive). A rate over
  // the whole window, with the count of days that actually had a line — so
  // "3 bales/day (fed on 2 of 14 days)" reads as what it is.
  let burnRate: BurnRate | null = null
  {
    const to = dayKey(nowMs)
    const from = dayKey(nowMs - (BURN_WINDOW_DAYS - 1) * 86_400_000)
    const inWindow = fedRows.filter(e => { const k = dayKey(e.ts); return k >= from && k <= to })
    if (inWindow.length > 0) {
      const bales = inWindow.reduce((s, e) => s + e.bales, 0)
      burnRate = {
        balesPerDay: bales / BURN_WINDOW_DAYS,
        windowDays: BURN_WINDOW_DAYS,
        daysWithEntries: new Set(inWindow.map(e => dayKey(e.ts))).size,
        bales,
        entries: inWindow.length,
        from,
        to,
      }
    }
  }

  // Baseline = the most recent COUNT (latest as_of; ties → latest logged).
  let baseline: Baseline | null = null
  if (invRows.length > 0) {
    const latest = invRows.reduce((best, e) =>
      (e.as_of! > best.as_of!) || (e.as_of === best.as_of && e.ts > best.ts) ? e : best)
    baseline = { bales: latest.bales, asOf: latest.as_of!, loggedAt: latest.ts }
  }

  // On hand: baseline + stacked since − fed since, where "since" is the
  // baseline's ranch day (inclusive). Only ever with a baseline.
  let onHand: OnHand | null = null
  if (baseline) {
    const asOf = baseline.asOf
    const stackedSince = sum(stackedRows.filter(e => dayKey(e.ts) >= asOf))
    const fedSince = sum(fedRows.filter(e => dayKey(e.ts) >= asOf))
    onHand = {
      bales: baseline.bales + stackedSince.bales - fedSince.bales,
      baseline,
      stackedSince,
      fedSince,
    }
  }

  return {
    stacked,
    fed,
    burnRate,
    range: { from: entries[0].ts, to: entries[entries.length - 1].ts },
    baseline,
    onHand,
    runOut: projectRunOut({ onHand, burnRate, feedDaysLogged: fed?.days ?? 0 }, nowMs),
  }
}

// Pure. Gates, in order: a baseline (on hand exists) → feeding logged on at
// least MIN_FEED_DAYS distinct days → something fed inside the trailing
// window (a rate to project with) → bales actually left. Each refusal names
// itself so the card can show the burn rate alone without pretending.
export function projectRunOut(
  input: { onHand: OnHand | null; burnRate: BurnRate | null; feedDaysLogged: number },
  nowMs: number = Date.now(),
): RunOutVerdict {
  const { onHand, burnRate, feedDaysLogged } = input
  if (!onHand) return { withheld: 'no_baseline' }
  if (feedDaysLogged < MIN_FEED_DAYS) return { withheld: 'thin_feeding' }
  if (!burnRate || burnRate.balesPerDay <= 0) return { withheld: 'no_recent_feeding' }
  if (onHand.bales <= 0) return { withheld: 'nothing_left' }
  const daysLeft = Math.floor(onHand.bales / burnRate.balesPerDay)
  return {
    date: dayKey(nowMs + daysLeft * 86_400_000),
    daysLeft,
    basis: {
      balesPerDay: burnRate.balesPerDay,
      windowDays: burnRate.windowDays,
      daysWithEntries: burnRate.daysWithEntries,
      feedDaysLogged,
      onHandBales: onHand.bales,
      baselineAsOf: onHand.baseline.asOf,
    },
  }
}
