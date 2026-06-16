import { createServiceClient } from './supabase'
import { roadMiles } from './freight'

// ─── Nearest-fresh-barn resolver ──────────────────────────────────────────────────────
// For an operator's home county: which auction barn(s) should the Zestimate value their herd
// against, and HONESTLY at what tier? The entire fresh-barn universe today is 3 feeds in 2
// towns — Billings (1777 BLC + 1774 PAYS) and Miles City (1773) — all in
// public.mars_price_snapshots. Most of Montana has NO barn within a sane haul radius; this
// names that truth rather than faking "local".
//
// FRESHNESS = the table's report_date (the recon-validated row-level sale date), gated at
// ~10 days (weekly sales). HAUL RADIUS ~150 road miles (roadMiles = haversine × circuity,
// reused from lib/freight so it matches the hay haul-distance semantics).
//
// RLS: mars_price_snapshots is RLS-on-with-no-policies (service-role only), read with
// createServiceClient — same as lib/lrp-service.ts. resolveBarns is server-side ONLY (it reads
// the service-role client) — don't import it into a client component. We deliberately skip the
// `server-only` package guard so the PURE rankFreshBarns stays unit-testable outside Next; the
// secret is protected exactly as lib/supabase relies on (SUPABASE_SERVICE_ROLE_KEY is
// non-public, stripped from client bundles).

export const FRESH_DAYS = 10
export const HAUL_RADIUS_MI = 150

// Barn geo — MARS carries no coords, so we geocode the (few) barn towns ourselves, keyed by
// slug_id. A barn added to the pipeline (scripts/mars-snapshot.ts) MUST also be added here or
// it can't be ranked. (Dickinson ND — a fall-only far-eastern fallback — lands here + in the
// pipeline together when wanted; omitted now since it isn't seeded.)
export const BARN_GEO: Record<string, { town: string; lat: number; lon: number }> = {
  '1777': { town: 'Billings, MT',   lat: 45.7833, lon: -108.5007 },
  '1774': { town: 'Billings, MT',   lat: 45.7833, lon: -108.5007 },
  '1773': { town: 'Miles City, MT', lat: 46.4083, lon: -105.8406 },
}

// One priced row as stored in mars_price_snapshots.rows (auction schema). Nullable throughout
// (the writer maps defensively). price_unit ('Per Cwt' | 'Per Unit') is REQUIRED to interpret
// avg_price — per-head pairs/bred/fancy lots — and the Zestimate branches on it.
export interface MarsPriceRow {
  commodity: string | null
  class: string | null
  frame: string | null
  price_unit: string | null
  avg_weight: number | null
  avg_weight_min: number | null
  avg_weight_max: number | null
  avg_price: number | null
  avg_price_min: number | null
  avg_price_max: number | null
  head_count: number | null
  receipts: number | null
  receipts_week_ago: number | null
  receipts_year_ago: number | null
  lot_desc: string | null
  weight_break_low: number | null
  weight_break_high: number | null
}

// A snapshot row read from the table (pre-ranking).
export interface BarnSnapshot {
  slug_id: string
  barn_name: string
  city: string
  state: string
  report_date: string // 'YYYY-MM-DD'
  row_count: number
  rows: MarsPriceRow[]
}

// A barn after ranking: geo-resolved, distance + freshness computed. Carries `rows` so the
// Zestimate can value lots against it without a second read.
export interface RankedBarn {
  slug_id: string
  barn_name: string
  town: string
  miles: number // road miles from the county centroid (rounded)
  report_date: string
  age_days: number
  fresh: boolean
  row_count: number
  rows: MarsPriceRow[]
}

export type ResolveTier = 'local' | 'nearest-comp' | 'regional-only'

export interface ResolveResult {
  county_fips: string
  county_name: string | null
  centroid: { lat: number; lon: number } | null
  tier: ResolveTier
  local: RankedBarn[]             // fresh barns within HAUL_RADIUS_MI, nearest first
  nearest_comp: RankedBarn | null // nearest fresh barn BEYOND the radius (only when no local)
  ranked: RankedBarn[]            // ALL fresh barns, nearest first
  stale: RankedBarn[]             // present but past the freshness gate (honesty/debug)
  summary: string                 // one honest line
}

type RankResult = Pick<ResolveResult, 'tier' | 'local' | 'nearest_comp' | 'ranked' | 'stale' | 'summary'>

function ageDays(reportDate: string, nowMs: number): number {
  const t = Date.parse(`${reportDate}T00:00:00Z`)
  return Number.isNaN(t) ? Infinity : Math.floor((nowMs - t) / 86_400_000)
}

// ─── PURE core — deterministic given (centroid, barns, nowMs); no I/O; unit-testable. ───
export function rankFreshBarns(
  centroid: { lat: number; lon: number },
  barns: BarnSnapshot[],
  nowMs: number = Date.now(),
): RankResult {
  const geocoded: RankedBarn[] = []
  for (const b of barns) {
    const geo = BARN_GEO[b.slug_id]
    if (!geo) continue // ungeocoded slug — can't rank by distance (a pipeline add must add geo)
    const age = ageDays(b.report_date, nowMs)
    geocoded.push({
      slug_id: b.slug_id,
      barn_name: b.barn_name,
      town: geo.town,
      miles: Math.round(roadMiles(centroid.lat, centroid.lon, geo.lat, geo.lon)),
      report_date: b.report_date,
      age_days: age,
      fresh: age <= FRESH_DAYS,
      row_count: b.row_count,
      rows: b.rows,
    })
  }

  const ranked = geocoded.filter(b => b.fresh).sort((a, b) => a.miles - b.miles)
  const stale = geocoded.filter(b => !b.fresh).sort((a, b) => a.miles - b.miles)
  const local = ranked.filter(b => b.miles <= HAUL_RADIUS_MI)
  const nearest_comp = local.length === 0 ? ranked[0] ?? null : null
  const tier: ResolveTier = local.length > 0 ? 'local' : ranked.length > 0 ? 'nearest-comp' : 'regional-only'

  let summary: string
  if (tier === 'local') {
    summary = `${local.length} local barn${local.length > 1 ? 's' : ''} within ${HAUL_RADIUS_MI}mi — nearest ${local[0].town} ~${local[0].miles}mi`
  } else if (tier === 'nearest-comp' && nearest_comp) {
    summary = `No barn within ${HAUL_RADIUS_MI}mi; nearest comparable ${nearest_comp.town} ~${nearest_comp.miles}mi (not local) — layer regional context`
  } else {
    summary = 'No fresh barn in range — regional/national context only'
  }

  return { tier, local, nearest_comp, ranked, stale, summary }
}

// ─── Thin read wrapper — county centroid + fresh barns, then rank. Service-role (RLS-none). ─
// Degrades honestly: missing centroid or any read error → regional-only (never throws, never
// fakes a local barn). The Zestimate layers regional/national (the LRP national floor) context
// in every tier, and relies on it entirely when tier is 'regional-only'.
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
