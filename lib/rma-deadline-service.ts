import 'server-only'

import { createServiceClient } from './supabase'

// ─── RMA deadline service (read path) ────────────────────────────────────────────
//
// Reads public.rma_deadlines (migration 021) for the dashboard's "next deadline"
// countdown. This is PUBLIC reference data (RLS-on-with-no-policies), so it reads with
// the SERVICE-ROLE client — NOT the SSR/anon client. (Deliberately the OPPOSITE of
// lib/operation-profile-service.ts, which is user-owned and must run as the user.)
//
// HONEST RESULT (mirrors lib/cattle-market-service.ts — discriminated, never fabricate):
//   • { status: 'ok', deadlines }      → one or more upcoming dates (soonest first).
//   • { status: 'none' }               → genuine absence: nothing dated today-or-later
//                                        for this county/crops (e.g. PRF 12/1 already past).
//   • { status: 'data_unavailable' }   → query error, or the county FIPS didn't resolve.
// A PAST date is NEVER returned as upcoming, daysUntil is NEVER negative, and no date
// is ever invented — past dates are filtered out in the query (deadline_date >= today).

export interface UpcomingDeadline {
  crop_or_program: string
  deadline_type:   string
  deadline_date:   string        // ISO 'YYYY-MM-DD'
  daysUntil:       number        // ≥ 0 (today = 0); never negative
  source:          string
  as_of:           string | null
}

export type UpcomingDeadlinesResult =
  | { status: 'ok'; deadlines: UpcomingDeadline[] }
  | { status: 'none' }
  | { status: 'data_unavailable' }

interface DeadlineRow {
  county_fips:     string | null
  crop_or_program: string
  deadline_type:   string
  deadline_date:   string
  crop_year:       number
  source:          string
  as_of:           string | null
}

// Whole-day count between two ISO dates, both anchored at UTC midnight so the result is
// a clean integer regardless of server timezone. Inputs are 'YYYY-MM-DD'.
function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`)
  const b = Date.parse(`${toISO}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

// county_fips IS NULL ⇒ statewide; a real FIPS ⇒ county override. The override wins for
// the same crop_or_program + deadline_type + crop_year. (No overrides seeded today, but
// the precedence is built now so it scales.)
function precedenceKey(r: DeadlineRow): string {
  return `${r.crop_or_program}|${r.deadline_type}|${r.crop_year}`
}

// Program-level obligations: state-wide filings EVERY producer must make (e.g. the FSA
// seeded-acres report and the RMA acreage report), not crop-specific deadlines. Their
// crop_or_program is a program slug, not a real crop, so they must ALWAYS show — they
// bypass the producer crop filter below. Without this, a producer who entered their crops
// would lose these obligations entirely (a program slug matches no crop).
const PROGRAM_LEVEL = new Set(['fsa_acreage', 'rma_acreage'])

export async function getUpcomingDeadlines(
  countyFips: string,
  crops?: string[] | null,
): Promise<UpcomingDeadlinesResult> {
  try {
    const db = createServiceClient()

    // 1) Resolve the county's state. An unresolved FIPS is a real failure, not absence.
    const { data: countyRow, error: countyErr } = await db
      .from('counties')
      .select('state')
      .eq('fips', countyFips)
      .maybeSingle()

    if (countyErr) {
      console.error('[rma-deadline] county lookup failed:', countyErr.message)
      return { status: 'data_unavailable' }
    }
    const state = (countyRow as { state: string } | null)?.state
    if (!state) return { status: 'data_unavailable' }

    // 2) Upcoming deadlines for this state — statewide rows + this county's overrides —
    //    dated today-or-later only (the "next occurrence ≥ today" rule), soonest first.
    const today = new Date().toISOString().slice(0, 10)   // server date, date-only
    const { data, error } = await db
      .from('rma_deadlines')
      .select('county_fips, crop_or_program, deadline_type, deadline_date, crop_year, source, as_of')
      .eq('state', state)
      .or(`county_fips.is.null,county_fips.eq.${countyFips}`)
      .gte('deadline_date', today)
      .order('deadline_date', { ascending: true })

    if (error) {
      console.error('[rma-deadline] deadlines read failed:', error.message)
      return { status: 'data_unavailable' }
    }

    let rows = (data ?? []) as DeadlineRow[]

    // 4) County-override precedence: drop the statewide row when a county-specific row
    //    exists for the same crop/type/year.
    const overridden = new Set<string>()
    for (const r of rows) if (r.county_fips === countyFips) overridden.add(precedenceKey(r))
    rows = rows.filter(r => !(r.county_fips === null && overridden.has(precedenceKey(r))))

    // 3) Crop filter — only when a non-empty crop list is given (a producer with
    //    herd-but-no-crops passes null and gets the full county/state list). A row is kept
    //    if it's a PROGRAM-LEVEL obligation (always — state-wide filing every producer
    //    makes) OR it matches one of the producer's crops. Equivalently: only filter OUT a
    //    real-crop row that isn't in their set. So crops=['alfalfa'] still surfaces both
    //    July 15 program rows alongside any alfalfa-specific deadlines.
    if (Array.isArray(crops) && crops.length > 0) {
      const wanted = new Set(crops)
      rows = rows.filter(r => PROGRAM_LEVEL.has(r.crop_or_program) || wanted.has(r.crop_or_program))
    }

    if (rows.length === 0) return { status: 'none' }

    // Order is preserved through the filters, so rows[0] is the soonest.
    const deadlines: UpcomingDeadline[] = rows.map(r => ({
      crop_or_program: r.crop_or_program,
      deadline_type:   r.deadline_type,
      deadline_date:   r.deadline_date,
      daysUntil:       daysBetween(today, r.deadline_date),   // ≥ 0 (filtered ≥ today)
      source:          r.source,
      as_of:           r.as_of,
    }))

    return { status: 'ok', deadlines }
  } catch (err) {
    console.error('[rma-deadline] read threw:', err)
    return { status: 'data_unavailable' }
  }
}
