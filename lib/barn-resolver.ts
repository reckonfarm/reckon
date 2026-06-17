import { createServiceClient } from './supabase'
import { rankFreshBarns, type BarnSnapshot, type ResolveResult } from './barn-geo'

// ─── Nearest-fresh-barn resolver (DB-backed wrapper) ─────────────────────────────────────
// The geo table, types, constants, and the PURE rankFreshBarns live in ./barn-geo — a module
// that imports nothing touching Supabase — so a cron (GitHub Actions, no NEXT_PUBLIC env /
// Node WebSocket for lib/supabase) and unit tests can use the ranking directly. This file adds
// the service-role read (county centroid + fresh barns) and re-exports the ./barn-geo surface,
// so existing importers (the /herd page, lib/herd-estimate's type imports) are UNCHANGED.
//
// RLS: mars_price_snapshots is RLS-on-with-no-policies (service-role only). resolveBarns is
// server-side ONLY (don't import it into a client component); the secret is protected as
// lib/supabase relies on (SUPABASE_SERVICE_ROLE_KEY is non-public, stripped from client bundles).
export { FRESH_DAYS, HAUL_RADIUS_MI, BARN_GEO, rankFreshBarns } from './barn-geo'
export type { MarsPriceRow, BarnSnapshot, RankedBarn, ResolveTier, ResolveResult } from './barn-geo'

// Thin read wrapper — county centroid + fresh barns, then rank. Degrades honestly: missing
// centroid or any read error → regional-only (never throws, never fakes a local barn). The
// HerdEstimate layers regional/national (the LRP national floor) context in every tier.
export async function resolveBarns(countyFips: string): Promise<ResolveResult> {
  try {
    const db = createServiceClient()
    const [countyRes, snapRes] = await Promise.all([
      db.from('counties').select('name, lat, lon').eq('fips', countyFips).maybeSingle(),
      db.from('mars_price_snapshots').select('slug_id, barn_name, city, state, report_date, row_count, rows'),
    ])

    const county = countyRes.data as { name: string | null; lat: number | string | null; lon: number | string | null } | null
    const countyName = county?.name ?? null
    // numeric(9,6) can arrive as a string from PostgREST — coerce, then null-check.
    const lat = county?.lat == null ? null : Number(county.lat)
    const lon = county?.lon == null ? null : Number(county.lon)

    if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) {
      return {
        county_fips: countyFips, county_name: countyName, centroid: null,
        tier: 'regional-only', local: [], nearest_comp: null, ranked: [], stale: [],
        summary: 'No county centroid on file — regional/national context only',
      }
    }

    const barns = (snapRes.data ?? []) as BarnSnapshot[]
    const core = rankFreshBarns({ lat, lon }, barns, Date.now())
    return { county_fips: countyFips, county_name: countyName, centroid: { lat, lon }, ...core }
  } catch (err) {
    console.error('[barn-resolver] read failed:', err instanceof Error ? err.message : err)
    return {
      county_fips: countyFips, county_name: null, centroid: null,
      tier: 'regional-only', local: [], nearest_comp: null, ranked: [], stale: [],
      summary: 'Resolver read failed — regional/national context only',
    }
  }
}
