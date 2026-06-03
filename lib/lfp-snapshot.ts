import 'server-only'
import { createServiceClient } from './supabase'
import { computeLfpEligibility } from './lfp-eligibility'
import { estimatePayment } from './lfp-payment'
import { resolveDefaultGrazingWindow } from './grazing-window'

// ─── LFP weekly snapshot capture (increment 1 — live capture only) ─────────────
//
// Persists the AUDITED engine's output, once per active county per USDM week, into
// lfp_eligibility_snapshots. This module NEVER reimplements tier/payment logic — it
// calls the real computeLfpEligibility + estimatePayment and stores what they return,
// so a stored row always equals what the live dashboard would have said for the same
// county + grazing window ending that week. (See migration 018 for the contract.)
//
// Scope: the ACTIVE SET only — distinct counties from user_watchlist ∪
// profiles.home_county_fips. We do NOT snapshot all ~3,143 counties.
//
// Runs as a decoupled step in /api/cron/drought-update, AFTER fetchAndStoreDroughtData()
// so drought_data is fresh before the engine's tier-2 (7-of-8) and as-of reads, and
// reusing that step's weekDate so the week key is consistent.

// Each computeLfpEligibility makes 4 live USDM calls (each bounded by an 8s timeout),
// so keep the in-flight county count modest — mirrors drought-service's STATE_CONCURRENCY.
const COUNTY_CONCURRENCY = 8

// Chunk .in() lookups to stay under Supabase's 1,000-row default cap (as drought-service does).
const CHUNK = 1000

type ServiceClient = ReturnType<typeof createServiceClient>

interface ActiveCounty {
  id:   number
  fips: string
}

type CaptureOutcome = 'captured' | 'no_result' | 'decrease_blocked' | 'error'

// ─── Active set: watchlist ∪ home counties ─────────────────────────────────────

async function getActiveCounties(db: ServiceClient): Promise<ActiveCounty[]> {
  const [wlRes, profRes] = await Promise.all([
    db.from('user_watchlist').select('county_id'),
    db.from('profiles').select('home_county_fips').not('home_county_fips', 'is', null),
  ])

  if (wlRes.error)   console.error(`[lfp-snapshot] watchlist query failed: ${wlRes.error.message}`)
  if (profRes.error) console.error(`[lfp-snapshot] home-county query failed: ${profRes.error.message}`)

  const watchlistIds = [...new Set((wlRes.data ?? []).map(r => (r as { county_id: number }).county_id))]
  const homeFips     = [...new Set((profRes.data ?? []).map(r => (r as { home_county_fips: string }).home_county_fips))]

  // Resolve both sources to a single {id, fips} set, deduped by county_id.
  const byId = new Map<number, string>()

  for (let i = 0; i < watchlistIds.length; i += CHUNK) {
    const { data, error } = await db
      .from('counties')
      .select('id, fips')
      .in('id', watchlistIds.slice(i, i + CHUNK))
    if (error) throw new Error(`counties lookup by id failed: ${error.message}`)
    for (const c of data ?? []) byId.set((c as ActiveCounty).id, (c as ActiveCounty).fips)
  }

  for (let i = 0; i < homeFips.length; i += CHUNK) {
    const { data, error } = await db
      .from('counties')
      .select('id, fips')
      .in('fips', homeFips.slice(i, i + CHUNK))
    if (error) throw new Error(`counties lookup by fips failed: ${error.message}`)
    for (const c of data ?? []) byId.set((c as ActiveCounty).id, (c as ActiveCounty).fips)
  }

  return [...byId.entries()].map(([id, fips]) => ({ id, fips }))
}

// ─── Per-county capture ────────────────────────────────────────────────────────

async function captureOne(
  db:       ServiceClient,
  county:   ActiveCounty,
  weekDate: string,
): Promise<CaptureOutcome> {
  const window      = resolveDefaultGrazingWindow(county.fips)
  const programYear = parseInt(window.startDate.slice(0, 4), 10)  // grazing-window start year

  // The audited engine — called, never reimplemented.
  const result = await computeLfpEligibility(county.fips, { grazingPeriod: window })
  if (!result) return 'no_result'

  const { maxTier, payments } = result

  // Monotonic invariant: within a program year + window, max_tier and payments can only
  // hold or rise as the season advances. Compare against the most-recent EARLIER week for
  // this county/window; a decrease is a data error, so we log it and skip — never store a
  // bad delta. (See migration 018.)
  const { data: priorRow } = await db
    .from('lfp_eligibility_snapshots')
    .select('max_tier, payments, week_date')
    .eq('county_id', county.id)
    .eq('program_year', programYear)
    .eq('grazing_start', window.startDate)
    .lt('week_date', weekDate)
    .order('week_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const prior = priorRow as { max_tier: number; payments: number; week_date: string } | null
  if (prior && (maxTier < prior.max_tier || payments < prior.payments)) {
    console.error(
      `[lfp-snapshot] MONOTONIC VIOLATION ${county.fips} week ${weekDate}: ` +
      `prior(${prior.week_date}) tier=${prior.max_tier}/pay=${prior.payments} → ` +
      `now tier=${maxTier}/pay=${payments}. Skipping — refusing to store a decrease.`,
    )
    return 'decrease_blocked'
  }

  // Reference scale only (generic 100-head beef) — NOT a real rancher's payment.
  // estimatePayment throws when numPayments <= 0, so guard on payments > 0.
  const refEstimate = payments > 0
    ? estimatePayment('beef_adult', 100, payments).cappedEstimate
    : null

  const { error } = await db
    .from('lfp_eligibility_snapshots')
    .upsert(
      {
        county_id:               county.id,
        fips:                    county.fips,
        week_date:               weekDate,
        program_year:            programYear,
        grazing_start:           window.startDate,
        grazing_end:             window.endDate,
        max_tier:                maxTier,
        payments,
        data_as_of:              result.dataAsOf,
        ref_estimate_100hd_beef: refEstimate,
        result,                                   // full LfpEligibilityResult → jsonb
        capture_source:          'live',
      },
      { onConflict: 'county_id,program_year,week_date,grazing_start' },
    )

  if (error) {
    console.error(`[lfp-snapshot] upsert failed ${county.fips} week ${weekDate}: ${error.message}`)
    return 'error'
  }
  return 'captured'
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function captureLfpSnapshots(weekDate: string): Promise<{
  weekDate:         string
  activeCounties:   number
  captured:         number
  noResult:         number
  decreasesBlocked: number
  errors:           number
}> {
  const db       = createServiceClient()
  const counties = await getActiveCounties(db)

  let captured = 0, noResult = 0, decreasesBlocked = 0, errors = 0

  // Throttled batches — mirrors drought-service's STATE_CONCURRENCY pattern.
  for (let i = 0; i < counties.length; i += COUNTY_CONCURRENCY) {
    const batch = counties.slice(i, i + COUNTY_CONCURRENCY)
    const outcomes = await Promise.all(
      batch.map(c =>
        captureOne(db, c, weekDate).catch((err): CaptureOutcome => {
          console.error(`[lfp-snapshot] ${c.fips} threw: ${err instanceof Error ? err.message : String(err)}`)
          return 'error'
        }),
      ),
    )
    for (const o of outcomes) {
      if      (o === 'captured')         captured++
      else if (o === 'no_result')        noResult++
      else if (o === 'decrease_blocked') decreasesBlocked++
      else                               errors++
    }
  }

  console.log(
    `[lfp-snapshot] week ${weekDate}: ${counties.length} active counties → ` +
    `${captured} captured, ${noResult} no-result, ${decreasesBlocked} decreases-blocked, ${errors} errors`,
  )

  return {
    weekDate,
    activeCounties: counties.length,
    captured,
    noResult,
    decreasesBlocked,
    errors,
  }
}
