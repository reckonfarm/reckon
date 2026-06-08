import type { FeatureCollection } from 'geojson'

// Northern Plains county geometry — the data + visual spine for the Hay Opportunity
// Score. Full-fidelity Census cb_2023 20m boundaries, filtered to the 5 target states
// (STATEFP 30 MT, 38 ND, 46 SD, 56 WY, 31 NE) → 291 counties. Each feature carries
// GEOID (5-digit FIPS = STATEFP+COUNTYFP), NAME, and STATEFP. GEOID is the join key to
// the score snapshot, matching counties.fips / home_county_fips (zero-padded 5-char
// strings, no normalization).
//
// Static bundled asset, fetched client-side — same pattern as RegionalMapClient's
// county reference lines (a module-level cache so re-mounts never re-fetch; honest-
// degraded so a failed fetch yields null rather than throwing). NOTHING imports this
// yet: it lands the geometry + load plumbing for later commits (zonal aggregation,
// the score snapshot, and the choropleth layer).
export const NP_COUNTIES_SRC = '/geo/np-counties.geojson'

// Module-level cache: the geometry is static and county-independent, so one fetch per
// session is enough no matter how many times callers ask.
let npCountiesCache: FeatureCollection | null = null

export async function loadNpCounties(): Promise<FeatureCollection | null> {
  if (npCountiesCache) return npCountiesCache
  try {
    const res = await fetch(NP_COUNTIES_SRC)
    if (!res.ok) return null
    const geo = (await res.json()) as FeatureCollection
    if (geo?.type !== 'FeatureCollection' || !Array.isArray(geo.features)) return null
    npCountiesCache = geo
    return geo
  } catch {
    // Reference/geometry asset — on failure, callers render nothing rather than error.
    return null
  }
}
