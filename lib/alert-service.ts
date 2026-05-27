import 'server-only'
import { createServiceClient } from './supabase'
import { computeLfpEligibility, defaultGrazingPeriod } from './lfp-eligibility'
import { sendDroughtAlert } from './email'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TriggeredLevel {
  level: string    // "D3"
  label: string    // "Extreme"
  pct: number      // percentage of county area in this drought category
}

export interface DroughtAlert {
  countyId: number
  fips: string
  countyName: string
  state: string
  weekDate: string
  alertLevel: number  // the threshold that was set (e.g. 3 = watching for D3+)
  alerted: boolean
  triggered: TriggeredLevel[]
}

const LEVEL_LABELS = [
  'Abnormally Dry',
  'Moderate',
  'Severe',
  'Extreme',
  'Exceptional',
] as const

// ─── Core check ───────────────────────────────────────────────────────────────

/**
 * Checks every county on the user's watchlist against the latest drought data.
 * Returns an alert for each county where any drought level >= alertLevel has
 * coverage > 0% in the most recent weekly release.
 *
 * Designed to be called from the drought-update cron after each ingestion run,
 * and from the dashboard to show live alert status.
 */
export async function checkAlerts(userId: string): Promise<DroughtAlert[]> {
  const db = createServiceClient()

  // 1. Fetch watchlist with county details
  const { data: watchlist, error: wErr } = await db
    .from('user_watchlist')
    .select('county_id, alert_level, counties(fips, name, state)')
    .eq('user_id', userId)

  if (wErr) throw new Error(`Watchlist fetch failed: ${wErr.message}`)
  if (!watchlist || watchlist.length === 0) return []

  // 2. Find the latest published week across all drought data
  const { data: latest, error: lErr } = await db
    .from('drought_data')
    .select('week_date')
    .order('week_date', { ascending: false })
    .limit(1)
    .single()

  if (lErr || !latest) return [] // no data ingested yet

  // 3. Fetch readings for watched counties on the latest week
  const countyIds = watchlist.map(w => w.county_id)

  const { data: readings, error: rErr } = await db
    .from('drought_data')
    .select('county_id, week_date, d0, d1, d2, d3, d4')
    .in('county_id', countyIds)
    .eq('week_date', latest.week_date)

  if (rErr) throw new Error(`Drought readings fetch failed: ${rErr.message}`)

  const readingByCounty = Object.fromEntries(
    (readings ?? []).map(r => [r.county_id, r]),
  )

  // 4. Evaluate each watchlist entry against its threshold
  const alerts: DroughtAlert[] = []

  for (const entry of watchlist) {
    const reading = readingByCounty[entry.county_id]
    if (!reading) continue // county has no drought data yet

    const county  = entry.counties as unknown as { fips: string; name: string; state: string }
    const minLevel = entry.alert_level

    const triggered: TriggeredLevel[] = []

    for (let l = minLevel; l <= 4; l++) {
      const pct = (reading[`d${l}` as 'd0' | 'd1' | 'd2' | 'd3' | 'd4'] as number | null) ?? 0
      if (pct > 0) {
        triggered.push({ level: `D${l}`, label: LEVEL_LABELS[l], pct })
      }
    }

    const alerted = triggered.length > 0

    // For non-alerted counties, collect sub-threshold levels so the UI can
    // display current conditions even when no alert fired.
    if (!alerted) {
      for (let l = 0; l < minLevel; l++) {
        const pct = (reading[`d${l}` as 'd0' | 'd1' | 'd2' | 'd3' | 'd4'] as number | null) ?? 0
        if (pct > 0) {
          triggered.push({ level: `D${l}`, label: LEVEL_LABELS[l], pct })
        }
      }
    }

    alerts.push({
      countyId: entry.county_id,
      fips: county.fips,
      countyName: county.name,
      state: county.state,
      weekDate: reading.week_date,
      alertLevel: minLevel,
      alerted,
      triggered,
    })
  }

  return alerts
}

// ─── Fan-out alert sender ─────────────────────────────────────────────────────

export interface AlertSendResult {
  checked: number
  sent:    number
  skipped: number  // dedup hits
  errors:  string[]
}

/**
 * Called by the drought-update cron after each successful ingestion.
 * Fans out across every authenticated user's watchlist, computes LFP eligibility
 * per unique county, and sends one email per user/county/week_date via Resend.
 * Deduplicates via alert_sent — safe to call multiple times for the same week.
 */
export async function checkAndSendAlerts(weekDate: string): Promise<AlertSendResult> {
  const db = createServiceClient()

  // 1. All authenticated watchlist entries (null user_ids are anonymous, skip them)
  const { data: watchlistData, error: wErr } = await db
    .from('user_watchlist')
    .select('user_id, county_id, counties(id, fips, name, state)')
    .not('user_id', 'is', null)

  if (wErr) throw new Error(`Watchlist fetch failed: ${wErr.message}`)
  if (!watchlistData || watchlistData.length === 0) {
    return { checked: 0, sent: 0, skipped: 0, errors: [] }
  }

  // 2. Resolve email addresses from profiles
  const userIds = [...new Set(watchlistData.map(w => w.user_id as string))]
  const { data: profiles } = await db
    .from('profiles')
    .select('id, email')
    .in('id', userIds)

  const emailByUser: Record<string, string> = Object.fromEntries(
    (profiles ?? []).map(p => [p.id as string, p.email as string]),
  )

  // 3. Compute LFP eligibility once per unique county (avoids N×users USDM API calls)
  const uniqueFips = [
    ...new Set(
      watchlistData.map(w => (w.counties as unknown as { fips: string }).fips),
    ),
  ]

  const gp = defaultGrazingPeriod()
  const eligibilityByFips: Record<string, Awaited<ReturnType<typeof computeLfpEligibility>>> = {}

  await Promise.allSettled(
    uniqueFips.map(async fips => {
      try {
        eligibilityByFips[fips] = await computeLfpEligibility(fips, { grazingPeriod: gp })
      } catch {
        eligibilityByFips[fips] = null
      }
    }),
  )

  // 4. Fan out — one alert per user/county if tier > 0 and not already sent this week
  let sent    = 0
  let skipped = 0
  let checked = 0
  const errors: string[] = []

  for (const entry of watchlistData) {
    const userId = entry.user_id as string
    const email  = emailByUser[userId]
    if (!email) continue

    const county = entry.counties as unknown as { id: number; fips: string; name: string; state: string }
    const elig   = eligibilityByFips[county.fips]

    checked++

    if (!elig || elig.maxTier === 0) continue

    // Dedup: one email per user/county per USDM release date
    const { count } = await db
      .from('alert_sent')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('county_id', county.id)
      .eq('week_date', weekDate)

    if ((count ?? 0) > 0) { skipped++; continue }

    try {
      await sendDroughtAlert({
        to:                 email,
        countyName:         elig.countyName,
        state:              elig.state,
        fips:               elig.fips,
        tier:               elig.maxTier,
        payments:           elig.payments,
        tierLabel:          elig.tiers[elig.maxTier - 1].label,
        grazingPeriodStart: gp.startDate,
        grazingPeriodEnd:   gp.endDate,
        weekDate,
      })

      await db.from('alert_sent').insert({
        user_id:   userId,
        county_id: county.id,
        week_date: weekDate,
        tier:      elig.maxTier,
      })

      sent++
    } catch (err) {
      errors.push(
        `${county.fips} → ${email}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return { checked, sent, skipped, errors }
}
