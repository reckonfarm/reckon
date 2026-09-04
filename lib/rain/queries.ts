import type { SupabaseClient } from '@supabase/supabase-js'
import { dayKey } from '@/lib/jobs/format'

// ─── Rain ledger — what the operator measured, by place ──────────────────────
//
// Typed function over a passed-in SupabaseClient (lib/hay/queries doctrine:
// user-scoped SSR client on pages → RLS exercised; empty on error, never
// throws). Pure derivation over manual rain events (payload->>source =
// 'manual', type 'rain', payload.inches). No table, no migration.
//
// These are GAUGE READINGS ON THE GROUND — a different kind of fact from the
// county percent-of-normal (a station or PRISM estimate, lib/precip-normal).
// Nothing here compares, subtracts, or normalizes against that series.
//
// Grouped by place (a "no place" group keeps readings logged without one) and,
// inside each place, by ranch month — so a monthly view is available later.
// The card uses year-to-date only today: the county series is YTD-only, and a
// monthly comparison would be inventing its other half.

export interface RainEntry {
  id: string
  ts: string
  inches: number
  place_id: string | null
}

export interface RainTotal {
  inches: number
  entries: number
}

export interface PlaceRain {
  place_id: string | null        // null = logged without a place
  name: string | null            // resolved place name; null for the no-place group
  total: RainTotal               // every reading at this place
  first: string                  // ISO ts of the earliest reading
  last: string                   // ISO ts of the latest reading
  ytd: RainTotal & { year: string }   // readings whose ranch day falls in the current ranch year
  months: Record<string, RainTotal>   // 'YYYY-MM' ranch month → total (for a later monthly view)
}

export interface RainLedger {
  entries: RainEntry[]           // every reading, oldest first
  places: PlaceRain[]            // most YTD rain first; the no-place group last
  total: RainTotal
  ytd: RainTotal & { year: string }
}

const EMPTY: RainLedger = {
  entries: [],
  places: [],
  total: { inches: 0, entries: 0 },
  ytd: { inches: 0, entries: 0, year: '' },
}

interface EventRow {
  id: string
  ts: string
  payload: Record<string, unknown> | null
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

function toEntry(r: EventRow): RainEntry | null {
  const p = r.payload ?? {}
  if (p.source !== 'manual') return null
  const inches = num(p.inches)
  if (inches == null || inches < 0) return null
  return { id: r.id, ts: r.ts, inches, place_id: str(p.place_id) }
}

// Reads the rain lines (RLS-scoped by the caller's client), resolves place
// names in one lookup, and derives the ledger. `since` (ISO) trims the read;
// `now` fixes the ranch year (tests pass it; pages let it default).
export async function getRainLedger(
  supabase: SupabaseClient,
  opts: { since?: string; now?: number } = {},
): Promise<RainLedger> {
  try {
    let q = supabase
      .from('events')
      .select('id, ts, payload')
      .eq('type', 'rain')
      .eq('payload->>source', 'manual')
      .order('ts', { ascending: true })
    if (opts.since) q = q.gte('ts', opts.since)
    const { data, error } = await q
    if (error) return EMPTY
    const entries = ((data ?? []) as EventRow[]).map(toEntry).filter((e): e is RainEntry => e !== null)

    const ids = [...new Set(entries.map(e => e.place_id).filter((v): v is string => v !== null))]
    const names = new Map<string, string>()
    if (ids.length > 0) {
      const { data: places } = await supabase.from('places').select('id, name').in('id', ids)
      for (const p of places ?? []) names.set(p.id, p.name)
    }
    return summarizeRain(entries, names, opts.now)
  } catch {
    return EMPTY
  }
}

const round = (n: number) => Math.round(n * 100) / 100

// Pure: entries (any order) + place names → ledger. Exported so a harness can
// lock it without a database.
export function summarizeRain(
  input: RainEntry[],
  names: Map<string, string> = new Map(),
  nowMs: number = Date.now(),
): RainLedger {
  const entries = [...input].sort((a, b) => a.ts.localeCompare(b.ts))
  const year = dayKey(nowMs).slice(0, 4)
  if (entries.length === 0) return { ...EMPTY, ytd: { inches: 0, entries: 0, year } }

  const groups = new Map<string | null, RainEntry[]>()
  for (const e of entries) {
    const list = groups.get(e.place_id) ?? []
    list.push(e)
    groups.set(e.place_id, list)
  }

  const total = (rows: RainEntry[]): RainTotal => ({
    inches: round(rows.reduce((s, e) => s + e.inches, 0)),
    entries: rows.length,
  })

  const places: PlaceRain[] = []
  for (const [place_id, rows] of groups) {
    const months: Record<string, RainTotal> = {}
    for (const e of rows) {
      const m = dayKey(e.ts).slice(0, 7)
      const cur = months[m] ?? { inches: 0, entries: 0 }
      months[m] = { inches: round(cur.inches + e.inches), entries: cur.entries + 1 }
    }
    const ytdRows = rows.filter(e => dayKey(e.ts).startsWith(year))
    places.push({
      place_id,
      name: place_id ? names.get(place_id) ?? null : null,
      total: total(rows),
      first: rows[0].ts,
      last: rows[rows.length - 1].ts,
      ytd: { ...total(ytdRows), year },
      months,
    })
  }
  // Most YTD rain first; the no-place group always last.
  places.sort((a, b) => {
    if (a.place_id === null) return 1
    if (b.place_id === null) return -1
    return b.ytd.inches - a.ytd.inches || b.total.inches - a.total.inches
  })

  const ytdRows = entries.filter(e => dayKey(e.ts).startsWith(year))
  return { entries, places, total: total(entries), ytd: { ...total(ytdRows), year } }
}
