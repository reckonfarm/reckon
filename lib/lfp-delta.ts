import 'server-only'
import { createServiceClient } from './supabase'

// ─── LFP week-over-week delta (read-only) ──────────────────────────────────────
// Reads the LFP snapshot store (lfp_eligibility_snapshots) and produces an HONEST
// week-over-week delta for a county. Never writes; never fabricates.
//
// Honesty invariants (see migration 018):
//   • The money delta is based on the STORED monotonic figures (payments →
//     ref_estimate_100hd_beef). max_tier/payments only hold-or-rise within a program
//     year + grazing window, so a decrease can't legitimately happen — if one ever
//     appears (data error), we render nothing rather than show it.
//   • currentD2Streak is trusted ONLY when BOTH compared rows are live-captured
//     ('live'). Backfilled rows computed it vs new Date(), so it's unreliable there.
//   • Any read failure, or no prior week to compare against, → null (caller renders
//     nothing). The empty state is a complete non-event.

export type LfpDelta =
  | { kind: 'tracking_begins' }
  | { kind: 'unchanged'; priorWeek: string; currentWeek: string }
  | { kind: 'money';     dollars: number; priorWeek: string; currentWeek: string }
  | { kind: 'streak';    weeks: number;   priorWeek: string; currentWeek: string }

interface SnapRow {
  week_date:               string
  program_year:            number
  grazing_start:           string
  ref_estimate_100hd_beef: number | null
  capture_source:          string
  result:                  { currentD2Streak?: number } | null
}

export async function getLfpDelta(fips: string): Promise<LfpDelta | null> {
  try {
    const db = createServiceClient()
    const paddedFips = fips.padStart(5, '0')

    // Most-recent snapshot for this county.
    const { data: latestData, error } = await db
      .from('lfp_eligibility_snapshots')
      .select('week_date, program_year, grazing_start, ref_estimate_100hd_beef, capture_source, result')
      .eq('fips', paddedFips)
      .order('week_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !latestData) return null   // no data for this county (today's universal case) → nothing

    const cur = latestData as SnapRow

    // The immediately-prior week within the SAME program year + grazing window (the basis
    // the monotonic invariant is defined over).
    const { data: priorData } = await db
      .from('lfp_eligibility_snapshots')
      .select('week_date, ref_estimate_100hd_beef, capture_source, result')
      .eq('fips', paddedFips)
      .eq('program_year', cur.program_year)
      .eq('grazing_start', cur.grazing_start)
      .lt('week_date', cur.week_date)
      .order('week_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!priorData) return { kind: 'tracking_begins' }   // one week captured; nothing to compare yet

    const prior = priorData as Pick<SnapRow, 'week_date' | 'ref_estimate_100hd_beef' | 'capture_source' | 'result'>

    const deltaDollars = (cur.ref_estimate_100hd_beef ?? 0) - (prior.ref_estimate_100hd_beef ?? 0)

    if (deltaDollars > 0) {
      return { kind: 'money', dollars: deltaDollars, priorWeek: prior.week_date, currentWeek: cur.week_date }
    }
    if (deltaDollars < 0) {
      return null   // monotonic invariant violated (capture blocks this) — never show a decrease
    }

    // Money unchanged. Pre-trigger streak movement — only when BOTH rows are live-captured.
    const curStreak   = typeof cur.result?.currentD2Streak === 'number' ? cur.result.currentD2Streak : null
    const priorStreak = typeof prior.result?.currentD2Streak === 'number' ? prior.result.currentD2Streak : null
    if (
      cur.capture_source === 'live' && prior.capture_source === 'live' &&
      curStreak !== null && priorStreak !== null && curStreak > priorStreak
    ) {
      return { kind: 'streak', weeks: curStreak - priorStreak, priorWeek: prior.week_date, currentWeek: cur.week_date }
    }

    return { kind: 'unchanged', priorWeek: prior.week_date, currentWeek: cur.week_date }
  } catch {
    return null   // any failure → render nothing, never a fabricated number
  }
}
