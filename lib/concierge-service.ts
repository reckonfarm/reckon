import 'server-only'
import { createServiceClient } from './supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WatchlistEntry {
  id: number
  countyId: number
  alertLevel: number  // 0-4: fire when any drought at this D-level or above is > 0%
  createdAt: string
  county: {
    fips:  string
    name:  string
    state: string
    lat:   number | null
    lon:   number | null
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getWatchlist(userId: string): Promise<WatchlistEntry[]> {
  const db = createServiceClient()

  const { data, error } = await db
    .from('user_watchlist')
    .select('id, county_id, alert_level, created_at, counties(fips, name, state, lat, lon)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`getWatchlist failed: ${error.message}`)

  return (data ?? []).map(row => ({
    id:         row.id,
    countyId:   row.county_id,
    alertLevel: row.alert_level,
    createdAt:  row.created_at,
    county:     row.counties as unknown as { fips: string; name: string; state: string; lat: number | null; lon: number | null },
  }))
}

export async function isWatching(userId: string, countyId: number): Promise<boolean> {
  const db = createServiceClient()

  const { count, error } = await db
    .from('user_watchlist')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('county_id', countyId)

  if (error) return false
  return (count ?? 0) > 0
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function addToWatchlist(
  userId: string,
  countyId: number,
  alertLevel: number = 3,
): Promise<void> {
  const db = createServiceClient()

  const { error } = await db
    .from('user_watchlist')
    .upsert(
      { user_id: userId, county_id: countyId, alert_level: alertLevel },
      { onConflict: 'user_id,county_id' },
    )

  if (error) throw new Error(`addToWatchlist failed: ${error.message}`)
}

export async function removeFromWatchlist(userId: string, countyId: number): Promise<void> {
  const db = createServiceClient()

  const { error } = await db
    .from('user_watchlist')
    .delete()
    .eq('user_id', userId)
    .eq('county_id', countyId)

  if (error) throw new Error(`removeFromWatchlist failed: ${error.message}`)
}
