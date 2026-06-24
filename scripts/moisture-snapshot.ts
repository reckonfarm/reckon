// ─── Feeding-region moisture snapshot writer (USDM footprint D1+ aggregate) ─────────
//
// Fetches the U.S. Drought Monitor categorical area percentages for the §4 cattle-FEEDING
// footprint in ONE multi-state call and UPSERTS one weekly row into Supabase
// (public.feeding_region_moisture, migration 028) — the Moisture leg of the dashboard's
// Market Read (§4 Leg 1). PUBLIC reference data, so it writes with the SERVICE-ROLE client.
// Runs OFF the request path on a WEEKLY cron (USDM updates Thursdays); the dashboard only
// READS the latest row.
//
// Source — USDM StateStatistics (multi-state aoi in ONE request; live-verified):
//   GET usdmdataservices.unl.edu/api/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent
//       ?aoi=<16 footprint FIPS, comma-sep>&startdate=M/D/YYYY&enddate=M/D/YYYY&statisticsType=2
//   → one row per state per weekly map: { mapDate, stateAbbreviation, none, d0, d1, d2, d3,
//     d4 } as % of THAT STATE's area. A ~5-week window returns current + ~4-week-prior in the
//     same response, so the trend needs no second call.
//
// THE NUMBER: drought_pct = area-weighted (by static state LAND area) % of the footprint in
// D1+ (d1+d2+d3+d4). D0 is abnormally dry, NOT drought, and is excluded from the headline.
//
//   Run locally:  npx tsx scripts/moisture-snapshot.ts
//   (needs SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env)
//
// SAFETY: the headline week MUST have all 16 footprint states with finite percentages, or
// we REFUSE to write and exit non-zero — never a partial/garbage footprint. The prior week
// is best-effort: if it's incomplete, prior_drought_pct is null (direction just unavailable),
// never fabricated. SEPARATE from the per-county LFP USDM reads (different endpoint/scope).

// @next/env must load before anything reads process.env (mirrors corn-snapshot.ts).
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

// ─── Footprint (§4: Northern Plains + Corn Belt + CO + Southern Plains) ───────────────
// Each entry: USDM state FIPS (zero-padded, the aoi value), USPS abbreviation (matches the
// response's stateAbbreviation), and static Census LAND area in sq mi. Only the RELATIVE
// magnitudes matter for the area-weighted mean, so exact rounding is immaterial.
const FOOTPRINT: ReadonlyArray<{ fips: string; abbr: string; landSqMi: number }> = [
  { fips: '30', abbr: 'MT', landSqMi: 145546 },
  { fips: '38', abbr: 'ND', landSqMi: 69001 },
  { fips: '46', abbr: 'SD', landSqMi: 75811 },
  { fips: '31', abbr: 'NE', landSqMi: 76824 },
  { fips: '56', abbr: 'WY', landSqMi: 97093 },
  { fips: '19', abbr: 'IA', landSqMi: 55857 },
  { fips: '17', abbr: 'IL', landSqMi: 55519 },
  { fips: '18', abbr: 'IN', landSqMi: 35826 },
  { fips: '27', abbr: 'MN', landSqMi: 79627 },
  { fips: '29', abbr: 'MO', landSqMi: 68742 },
  { fips: '39', abbr: 'OH', landSqMi: 40861 },
  { fips: '20', abbr: 'KS', landSqMi: 81759 },
  { fips: '08', abbr: 'CO', landSqMi: 103642 },
  { fips: '40', abbr: 'OK', landSqMi: 68595 },
  { fips: '48', abbr: 'TX', landSqMi: 261232 },
  { fips: '35', abbr: 'NM', landSqMi: 121298 },
]
const EXPECTED_STATES = FOOTPRINT.length            // 16
const AREA_BY_ABBR = new Map(FOOTPRINT.map(s => [s.abbr, s.landSqMi]))

const USDM_URL = 'https://usdmdataservices.unl.edu/api/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent'
const REQ_TIMEOUT = 30_000
const PRIOR_TARGET_DAYS = 28                          // ~4 weeks prior for the trend
const WINDOW_DAYS = 35                                // fetch ~5 weeks so current + prior are both in range

// ─── Helpers ────────────────────────────────────────────────────────────────────────

// Copied from lib/lrp-service.ts — the one defensive number gate.
function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Date → USDM 'M/D/YYYY' (non-padded, matches the live-verified query shape).
function usdmDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`
}

interface UsdmRow {
  mapDate?: unknown
  stateAbbreviation?: unknown
  d1?: unknown; d2?: unknown; d3?: unknown; d4?: unknown
  none?: unknown; d0?: unknown
}

// Area-weighted D1+ across the footprint for one week's rows (keyed by abbr). Returns null
// unless ALL 16 states are present with finite d1..d4 — never a partial footprint.
function footprintD1Plus(weekRows: Map<string, UsdmRow>): number | null {
  if (weekRows.size < EXPECTED_STATES) return null
  let weightedSum = 0
  let totalArea = 0
  for (const { abbr, landSqMi } of FOOTPRINT) {
    const r = weekRows.get(abbr)
    if (!r) return null
    const d1 = finiteNum(r.d1), d2 = finiteNum(r.d2), d3 = finiteNum(r.d3), d4 = finiteNum(r.d4)
    if (d1 === null || d2 === null || d3 === null || d4 === null) return null
    weightedSum += landSqMi * (d1 + d2 + d3 + d4)
    totalArea += landSqMi
  }
  if (totalArea <= 0) return null
  return Math.round((weightedSum / totalArea) * 100) / 100   // 2 decimals
}

// The per-state six-category breakdown for one week, stored raw for later re-derivation.
function weekBreakdown(weekRows: Map<string, UsdmRow>) {
  return FOOTPRINT.map(({ abbr }) => {
    const r = weekRows.get(abbr)!
    return {
      state: abbr,
      none: finiteNum(r.none), d0: finiteNum(r.d0),
      d1: finiteNum(r.d1), d2: finiteNum(r.d2), d3: finiteNum(r.d3), d4: finiteNum(r.d4),
    }
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────────

async function main() {
  const { createClient } = await import('@supabase/supabase-js')

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing env vars — ensure SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are set')
    process.exit(1)
  }

  // supabase-js eagerly resolves a WebSocket for realtime and throws on Node ≤20; we only
  // REST-upsert, so a never-instantiated transport short-circuits that (corn/lrp pattern).
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in moisture-snapshot') } }
  const db = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  console.log('\nDryline — Feeding-region Moisture Snapshot (USDM footprint D1+)\n')

  // 1) ONE multi-state USDM call over a ~5-week window (current + ~4-week-prior in one shot).
  const now = new Date()
  const start = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
  const aoi = FOOTPRINT.map(s => s.fips).join(',')
  const fetchUrl = `${USDM_URL}?aoi=${aoi}&startdate=${usdmDate(start)}&enddate=${usdmDate(now)}&statisticsType=2`

  let rows: UsdmRow[]
  try {
    const res = await fetch(fetchUrl, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQ_TIMEOUT),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (!Array.isArray(json)) throw new Error('USDM response was not an array')
    rows = json as UsdmRow[]
  } catch (err) {
    console.error(`  fetch failed: ${err instanceof Error ? err.message : err} — writing nothing`)
    process.exit(1)
  }

  // 2) Group rows by map week (mapDate → abbr → row).
  const byWeek = new Map<string, Map<string, UsdmRow>>()
  for (const r of rows) {
    const md = typeof r.mapDate === 'string' ? r.mapDate.slice(0, 10) : null
    const abbr = typeof r.stateAbbreviation === 'string' ? r.stateAbbreviation : null
    if (!md || !abbr || !AREA_BY_ABBR.has(abbr)) continue
    if (!byWeek.has(md)) byWeek.set(md, new Map())
    byWeek.get(md)!.set(abbr, r)
  }
  const weeksDesc = [...byWeek.keys()].sort((a, b) => (a < b ? 1 : -1))   // newest first

  // 3) Headline = the NEWEST week with all 16 states (skip a partial latest, like lrp does).
  let headlineWeek: string | null = null
  let droughtPct: number | null = null
  for (const wk of weeksDesc) {
    const v = footprintD1Plus(byWeek.get(wk)!)
    if (v !== null) { headlineWeek = wk; droughtPct = v; break }
    console.log(`  ${wk}: incomplete footprint (<${EXPECTED_STATES} states / non-finite) — trying prior week`)
  }
  if (headlineWeek === null || droughtPct === null) {
    throw new Error(`no complete ${EXPECTED_STATES}-state footprint week in the ${weeksDesc.length} returned — USDM mid-update or down; writing nothing`)
  }

  // 4) Prior = complete week closest to headline − 28 days (best-effort; null if none).
  const headlineMs = Date.parse(`${headlineWeek}T00:00:00Z`)
  const targetMs = headlineMs - PRIOR_TARGET_DAYS * 86_400_000
  let priorWeek: string | null = null
  let priorPct: number | null = null
  let bestDelta = Infinity
  for (const wk of weeksDesc) {
    const ms = Date.parse(`${wk}T00:00:00Z`)
    if (!(ms < headlineMs)) continue                 // strictly older than headline
    const v = footprintD1Plus(byWeek.get(wk)!)
    if (v === null) continue
    const delta = Math.abs(ms - targetMs)
    if (delta < bestDelta) { bestDelta = delta; priorWeek = wk; priorPct = v }
  }

  // 5) Idempotent upsert on map_date.
  const todayIso = now.toISOString().slice(0, 10)
  const { error } = await db.from('feeding_region_moisture').upsert(
    {
      map_date:          headlineWeek,
      drought_pct:       droughtPct,
      prior_drought_pct: priorPct,
      prior_map_date:    priorWeek,
      raw:               { week: headlineWeek, states: weekBreakdown(byWeek.get(headlineWeek)!) },
      source:            'USDM (NDMC)',
      as_of:             todayIso,
    },
    { onConflict: 'map_date' },
  )
  if (error) {
    console.error(`  upsert failed: ${error.message}`)
    process.exit(1)
  }

  const dir = priorPct == null ? '—' : droughtPct > priorPct ? 'drier ▲' : droughtPct < priorPct ? 'wetter ▼' : 'flat •'
  console.log(
    `  wrote ${headlineWeek}: footprint ${droughtPct.toFixed(2)}% in drought (D1+) ` +
    `${dir}${priorPct != null ? ` (prior ${priorPct.toFixed(2)}% on ${priorWeek})` : ''} ✓\n`,
  )
}

main().catch(err => {
  console.error('\n  error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
