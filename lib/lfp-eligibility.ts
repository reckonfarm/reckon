import 'server-only'
import { unstable_cache } from 'next/cache'
import { createServiceClient } from './supabase'

// ─── Source provenance ────────────────────────────────────────────────────────
//
// Eligibility is derived from the USDM consecutive-weeks API — the same data
// source used by the NDMC FSA Eligibility Tool at droughtmonitor.unl.edu/fsa.
// The 7-of-8 sliding-window tier is computed from our own drought_data table
// because no public API implements that specific window check.
//
// This is an ESTIMATE. FSA confirms eligibility at signup; local office makes
// the final determination. Grazing period dates matter — producers should
// supply their actual FSA-assigned grazing period for their forage type.
//
// Trigger rules: 7 CFR 1416; OBBBA tiers (D2-based) effective July 2025.
// Confirmed at droughtmonitor.unl.edu/FSA/About/DroughtMonitorTriggers.aspx

const USDM_CONSEC_API =
  'https://usdmdataservices.unl.edu/api/ConsecutiveNonConsecutiveStatistics'

// Bound each live USDM call so a hanging API degrades to an honest "unavailable"
// state in the caller rather than stalling the whole dashboard render.
const USDM_TIMEOUT_MS = 8000

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GrazingPeriod {
  startDate: string  // YYYY-MM-DD (inclusive)
  endDate:   string  // YYYY-MM-DD (inclusive)
}

interface ConsecutiveRun {
  fips:             string
  startDate:        string  // YYYY-MM-DD
  endDate:          string  // YYYY-MM-DD
  consecutiveWeeks: number
}

export interface LfpTierStatus {
  tier:      number   // 1–6
  payments:  number   // monthly payments at this tier
  label:     string   // human-readable trigger description
  triggered: boolean
}

export interface LfpEligibilityResult {
  fips:              string
  countyName:        string
  state:             string
  maxTier:           number           // 0 = not eligible; 1–6 = highest qualifying tier
  payments:          number           // monthly payments at maxTier (0, 1, 2, 3, 4, or 5)
  tiers:             LfpTierStatus[]  // all 6 tiers with triggered flag
  currentD2Streak:   number           // consecutive D2+ weeks in the most-recent ongoing run
  longestD2Run:      number           // longest completed consecutive D2+ run (weeks) in the grazing period
  weeksUntilTier1:   number | null    // null if already tier 1+; remaining weeks of D2 needed
  grazingPeriod:     GrazingPeriod
  dataAsOf:          string           // latest USDM week_date used in calculation
  disclaimer:        string
  obbbaNote:         string
  enforcement:       LfpEnforcement   // FSA-enforcement state (see OBBBA_FSA_IMPLEMENTED)
  d2EightWeek:       boolean | null   // old-rule D2 ≥8 consecutive; null = check failed
}

// ─── Tier definitions ─────────────────────────────────────────────────────────
// OBBBA 6-tier ladder, effective July 2025.
// Tiers are EXCLUSIVE-MAX: a county receives payment for the HIGHEST tier it hits.
// Tier 5 and 4 both yield 4 payments — whichever fires first when checking top-down.

const TIER_DEFS: Array<{ tier: number; payments: number; label: string }> = [
  { tier: 1, payments: 1, label: 'D2 (Severe) for ≥4 consecutive weeks'                       },
  { tier: 2, payments: 2, label: 'D2 (Severe) for ≥7 of any 8 consecutive weeks (OBBBA 2025)' },
  { tier: 3, payments: 3, label: 'D3 (Extreme) at any time during the grazing period'          },
  { tier: 4, payments: 4, label: 'D3 (Extreme) for ≥4 weeks during the grazing period'        },
  { tier: 5, payments: 4, label: 'D4 (Exceptional) at any time during the grazing period'     },
  { tier: 6, payments: 5, label: 'D4 (Exceptional) for ≥4 weeks during the grazing period'   },
]

export const LFP_DISCLAIMER =
  'This is an estimate based on U.S. Drought Monitor data. ' +
  'Your local FSA office makes the final eligibility and payment determination at signup. ' +
  'Eligibility is confirmed only after the FSA signup period opens and a producer ' +
  'completes all required enrollment materials with their local FSA service center.'

export const LFP_OBBBA_NOTE =
  'Tiers 1 and 2 (D2 triggers) were added by the One Big Beautiful Bill Act (OBBBA), ' +
  'effective for LFP program year 2025 forward. Pre-OBBBA, the D2 category produced no ' +
  'LFP payment. Now: D2 for ≥4 consecutive weeks = 1 payment; D2 for ≥7 of any 8 weeks = 2 payments.'

// FSA has not yet loaded OBBBA D2 thresholds into the 2026 LFP eligibility maps
// (fsa.usda.gov/resources/programs/livestock-forage-disaster-program-lfp/maps).
// null = OBBBA D2 not yet FSA-enforceable. Set to the implementation date (YYYY-MM-DD)
// the day FSA flips the maps — that one change promotes every pending county to official.
export const OBBBA_FSA_IMPLEMENTED: string | null = null

export type LfpEnforcement = 'officially_eligible' | 'pending_obbba' | 'not_eligible'

// ─── Program year helpers ─────────────────────────────────────────────────────

// LFP program year: Oct 1 – Sep 30.
// Default end date is today so the check reflects the most recent USDM release.
export function defaultGrazingPeriod(): GrazingPeriod {
  const today = new Date()
  const year  = today.getUTCFullYear()
  const month = today.getUTCMonth()  // 0-indexed; 9 = October
  const programYearStartYear = month >= 9 ? year : year - 1
  return {
    startDate: `${programYearStartYear}-10-01`,
    endDate:   today.toISOString().slice(0, 10),
  }
}

// ─── USDM consecutive-weeks API ───────────────────────────────────────────────

async function fetchConsecutiveRunsLive(
  fips:         string,
  dx:           number,
  minimumWeeks: number,
  gp:           GrazingPeriod,
): Promise<ConsecutiveRun[]> {
  const url =
    `${USDM_CONSEC_API}/GetConsecutiveWeeksCounty` +
    `?aoi=${fips}&dx=${dx}&minimumweeks=${minimumWeeks}` +
    `&startdate=${gp.startDate}&enddate=${gp.endDate}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), USDM_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
  if (!res.ok) {
    throw new Error(
      `USDM consecutive-weeks API failed (HTTP ${res.status}) for ` +
      `aoi=${fips} dx=${dx} minWeeks=${minimumWeeks}`,
    )
  }

  const data = await res.json() as Array<{
    fips:             string
    startDate:        string
    endDate:          string
    consecutiveWeeks: number
  }>

  // Clip each run so only weeks that start on or after gp.startDate are counted.
  // The USDM API returns the full consecutive run even when it started before startdate.
  // USDM weeks always start on Tuesdays; a week whose start date is before gp.startDate
  // is excluded. clipped = ceil((gpStart - runStart) / 7 days).
  const gpStartMs = new Date(gp.startDate).getTime()
  return data
    .map(r => {
      const runStartMs = new Date(r.startDate.slice(0, 10)).getTime()
      const prePeriod  = runStartMs < gpStartMs
        ? Math.ceil((gpStartMs - runStartMs) / (7 * 24 * 60 * 60 * 1000))
        : 0
      return {
        fips:             r.fips,
        startDate:        r.startDate.slice(0, 10),
        endDate:          r.endDate.slice(0, 10),
        consecutiveWeeks: r.consecutiveWeeks - prePeriod,
      }
    })
    .filter(r => r.consecutiveWeeks > 0)
}

// USDM consecutive-weeks is cached per (county, dx, minweeks, grazing window) and —
// critically — per USDM RELEASE DATE. The release-date key is the real guarantee: the
// moment a new weekly USDM reading lands in our drought_data, the key changes and the
// cache busts, so an eligibility number is NEVER computed against a prior week's
// reading. The 6h revalidate is only a floor. On fetch failure the inner function
// THROWS (non-2xx / timeout) → unstable_cache caches nothing → the caller degrades to
// "temporarily unavailable"; a failure is never cached as success.
const fetchConsecutiveRunsCached = unstable_cache(
  async (
    fips:         string,
    dx:           number,
    minimumWeeks: number,
    startDate:    string,
    endDate:      string,
    _releaseKey:  string,
  ): Promise<ConsecutiveRun[]> =>
    fetchConsecutiveRunsLive(fips, dx, minimumWeeks, { startDate, endDate }),
  ['lfp-consecutive-weeks'],
  { revalidate: 21600 }, // 6h floor; the release-date key is the real cache-bust
)

// ─── 7-of-8 sliding window ────────────────────────────────────────────────────
// Checks whether any 8-week window within the grazing period contained ≥7 weeks
// where the county had any D2+ coverage (d2 + d3 + d4 > 0).
// Uses our own drought_data table — no public API implements this window check.

async function sevenOfEightWindowCheck(
  db:       ReturnType<typeof createServiceClient>,
  countyId: number,
  gp:       GrazingPeriod,
): Promise<boolean> {
  const { data, error } = await db
    .from('drought_data')
    .select('week_date, d2, d3, d4')
    .eq('county_id', countyId)
    .gte('week_date', gp.startDate)
    .lte('week_date', gp.endDate)
    .order('week_date', { ascending: true })

  if (error || !data || data.length < 8) return false

  const qualifying = data.map(
    row => ((row.d2 ?? 0) + (row.d3 ?? 0) + (row.d4 ?? 0)) > 0,
  )

  for (let i = 0; i <= qualifying.length - 8; i++) {
    const windowCount = qualifying.slice(i, i + 8).filter(Boolean).length
    if (windowCount >= 7) return true
  }

  return false
}

// ─── Current D2 streak ────────────────────────────────────────────────────────
// Returns the length of the most-recent D2 run if it is still ongoing
// (its endDate is within one USDM release cycle of the query end).
// Returns 0 if the county is not currently in a D2 streak.

function getCurrentD2Streak(runs: ConsecutiveRun[], queryEndDate: string): number {
  if (runs.length === 0) return 0

  const sorted = [...runs].sort((a, b) => b.endDate.localeCompare(a.endDate))
  const latest = sorted[0]

  const endMs   = new Date(latest.endDate).getTime()
  const queryMs = new Date(queryEndDate).getTime()
  const daysDiff = (queryMs - endMs) / 86_400_000

  // Within 8 days = one USDM release cycle; run is still ongoing
  return daysDiff <= 8 ? latest.consecutiveWeeks : 0
}

// ─── Latest USDM week in our DB ───────────────────────────────────────────────

async function latestWeekDate(
  db:       ReturnType<typeof createServiceClient>,
  countyId: number,
  gp:       GrazingPeriod,
): Promise<string> {
  const { data } = await db
    .from('drought_data')
    .select('week_date')
    .eq('county_id', countyId)
    .gte('week_date', gp.startDate)
    .order('week_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (data as { week_date: string } | null)?.week_date ?? gp.endDate
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function computeLfpEligibility(
  fips:    string,
  options?: { grazingPeriod?: GrazingPeriod },
): Promise<LfpEligibilityResult | null> {
  const db = createServiceClient()
  const gp = options?.grazingPeriod ?? defaultGrazingPeriod()
  const paddedFips = fips.padStart(5, '0')

  // County lookup
  const { data: county } = await db
    .from('counties')
    .select('id, name, state')
    .eq('fips', paddedFips)
    .maybeSingle()

  if (!county) return null

  // Resolve the latest USDM release date FIRST — it is the cache-bust key for the USDM
  // consecutive-weeks calls (a new weekly reading → new key → fresh fetch) and is also
  // the eligibility's dataAsOf. One cheap query, before the parallel block.
  const releaseKey = await latestWeekDate(db, county.id as number, gp)

  // Parallel: 4 USDM API calls (cached, keyed by releaseKey) + 7-of-8 DB check.
  // D3 ≥4 weeks and D4 ≥4 weeks are NON-CONSECUTIVE totals (NDMC/FSA definition):
  // sum all run weeks from minimumweeks=1 calls rather than requiring a single ≥4-week run.
  const [
    runsD2_4,   // tier 1: D2 ≥4 consecutive
    runsD3_1,   // tier 3 + tier 4: D3 any time; sum gives total non-consecutive D3 weeks
    runsD4_1,   // tier 5 + tier 6: D4 any time; sum gives total non-consecutive D4 weeks
    runsD2_1,   // all D2 runs — used for streak detection only
    tier2,
    runsD2_8,   // OLD-rule check: D2 ≥8 consecutive — FSA-enforceable today; failure-isolated
  ] = await Promise.all([
    fetchConsecutiveRunsCached(paddedFips, 2, 4, gp.startDate, gp.endDate, releaseKey),
    fetchConsecutiveRunsCached(paddedFips, 3, 1, gp.startDate, gp.endDate, releaseKey),
    fetchConsecutiveRunsCached(paddedFips, 4, 1, gp.startDate, gp.endDate, releaseKey),
    fetchConsecutiveRunsCached(paddedFips, 2, 1, gp.startDate, gp.endDate, releaseKey),
    sevenOfEightWindowCheck(db, county.id as number, gp),
    // .catch on THIS call only: a failed old-rule check degrades to null (under-claim),
    // never taking down the other five throw-to-degrade calls.
    fetchConsecutiveRunsCached(paddedFips, 2, 8, gp.startDate, gp.endDate, releaseKey)
      .catch(() => null),
  ])
  const asOf = releaseKey

  const d2EightWeek: boolean | null =
    runsD2_8 === null ? null : runsD2_8.some(r => r.consecutiveWeeks >= 8)

  const totalD3Weeks = runsD3_1.reduce((sum, r) => sum + r.consecutiveWeeks, 0)
  const totalD4Weeks = runsD4_1.reduce((sum, r) => sum + r.consecutiveWeeks, 0)

  // Determine which tiers are triggered
  const triggered = [
    runsD2_4.some(r => r.consecutiveWeeks >= 4),  // tier 1: D2 ≥4 consecutive weeks within period
    tier2,                  // tier 2: D2 ≥7 of any 8 weeks (sliding window)
    runsD3_1.length > 0,   // tier 3: D3 at any time
    totalD3Weeks >= 4,      // tier 4: D3 ≥4 non-consecutive total weeks (NDMC definition)
    runsD4_1.length > 0,   // tier 5: D4 at any time
    totalD4Weeks >= 4,      // tier 6: D4 ≥4 non-consecutive total weeks (NDMC definition)
  ]

  // FSA-enforcement state. D3+ and the old-rule D2 ≥8-week trigger are enforceable on the
  // 2026 FSA maps today; the OBBBA D2 tiers (1 & 2) are not until OBBBA_FSA_IMPLEMENTED is set.
  // Safe degrade: if d2EightWeek is null (old-rule call failed) on an OBBBA-D2 county, it lands
  // in pending_obbba — an under-claim, never a false green. An 8-week county is always also
  // Tier 1, so no county is ever wrongly dropped to not_eligible by that failure.
  const d3OrWorse = triggered[2] || triggered[3] || triggered[4] || triggered[5]
  const obbbaD2   = triggered[0] || triggered[1]
  const fsaLiveD2 = OBBBA_FSA_IMPLEMENTED !== null && obbbaD2
  let enforcement: LfpEnforcement
  if (d2EightWeek === true || d3OrWorse || fsaLiveD2) enforcement = 'officially_eligible'
  else if (obbbaD2)                                   enforcement = 'pending_obbba'
  else                                                enforcement = 'not_eligible'

  // Maximum tier = highest index that is true
  let maxTier = 0
  for (let i = triggered.length - 1; i >= 0; i--) {
    if (triggered[i]) { maxTier = i + 1; break }
  }

  const payments = maxTier > 0 ? TIER_DEFS[maxTier - 1].payments : 0

  const tiers: LfpTierStatus[] = TIER_DEFS.map((def, i) => ({
    tier:      def.tier,
    payments:  def.payments,
    label:     def.label,
    triggered: triggered[i],
  }))

  // Current D2 streak and "weeks until tier 1"
  const longestD2Run    = runsD2_1.reduce((max, r) => Math.max(max, r.consecutiveWeeks), 0)
  const currentD2Streak = getCurrentD2Streak(runsD2_1, new Date().toISOString().slice(0, 10))
  const weeksUntilTier1 = maxTier >= 1
    ? null
    : Math.max(0, 4 - currentD2Streak)

  return {
    fips:            paddedFips,
    countyName:      county.name as string,
    state:           county.state as string,
    maxTier,
    payments,
    tiers,
    currentD2Streak,
    longestD2Run,
    weeksUntilTier1,
    grazingPeriod:   gp,
    dataAsOf:        asOf,
    disclaimer:      LFP_DISCLAIMER,
    obbbaNote:       LFP_OBBBA_NOTE,
    enforcement,
    d2EightWeek,
  }
}
