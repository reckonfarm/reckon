import 'server-only'
import { createServiceClient } from './supabase'

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
