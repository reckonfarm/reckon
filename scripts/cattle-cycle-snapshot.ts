// ─── Cattle cycle snapshot writer (NASS heifers-on-feed YoY — the cycle master switch) ──
//
// Fetches US heifers-&-heifer-calves ON FEED from USDA NASS Quick Stats and UPSERTS one
// quarterly row into Supabase (public.cattle_cycle_snapshots, migration 030) — the cattle-
// cycle "master switch" (§2). PUBLIC reference data, so it writes with the SERVICE-ROLE
// client. Runs OFF the request path on a (effectively) quarterly cron; the dashboard only
// READS the latest row.
//
// Source — NASS Quick Stats (requires NASS_QUICKSTATS_API_KEY; live-verified series):
//   GET …/api/api_GET/?key=<KEY>
//       &commodity_desc=CATTLE&statisticcat_desc=INVENTORY
//       &short_desc=CATTLE, HEIFERS %26 HEIFER CALVES, ON FEED - INVENTORY
//       &agg_level_desc=NATIONAL&year__GE=<lastYear-1>&format=JSON
//   → { data: [ { year, reference_period_desc:'FIRST OF JAN|APR|JUL|OCT', Value:'4,435,000', … } ] }.
//   The heifer split is published ONLY at the Jan/Apr/Jul/Oct quarterly points (NOT monthly).
//   year__GE=<lastYear-1> returns the latest quarter AND its prior-year quarter in one call,
//   so the YoY needs no second request.
//
//   Run locally:  npx tsx scripts/cattle-cycle-snapshot.ts
//   (needs SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
//    NASS_QUICKSTATS_API_KEY in env)
//
// SAFETY: no usable quarter (non-finite / non-positive head count, or nothing parses) → write
// nothing, exit non-zero (copy finiteNum). Never a garbage/0 count. yoy_pct is best-effort:
// null when the prior-year quarter is absent or non-positive — direction just unavailable,
// never fabricated.

// @next/env must load before anything reads process.env (mirrors crop-snapshot.ts).
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

// ─── Target ───────────────────────────────────────────────────────────────────────
const NASS_URL    = 'https://quickstats.nass.usda.gov/api/api_GET/'
const SHORT_DESC  = 'CATTLE, HEIFERS & HEIFER CALVES, ON FEED - INVENTORY'   // live-verified
const REQ_TIMEOUT = 30_000
const COUNT_MIN   = 1                 // a real head count is positive (and large); guard against 0/garbage
const COUNT_MAX   = 100_000_000       // generous upper bound; a wrong field is well outside

// The heifer split posts at these quarterly points → the month of report_point.
const QUARTER_MONTH: Record<string, number> = {
  'FIRST OF JAN': 1,
  'FIRST OF APR': 4,
  'FIRST OF JUL': 7,
  'FIRST OF OCT': 10,
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────

// Copied from lib/crop-service.ts / lib/corn-service.ts — the one defensive number gate.
function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// NASS Value head counts are comma-formatted ('4,435,000'); withheld markers ('(D)','(NA)')
// → null (never NaN).
function parseValue(v: unknown): number | null {
  if (typeof v === 'number') return finiteNum(v)
  if (typeof v !== 'string') return null
  const n = parseFloat(v.replace(/[,\s]/g, ''))
  return finiteNum(n)
}

interface NassRow {
  year?: unknown
  reference_period_desc?: unknown
  Value?: unknown
}

// (year, reference_period) → 'YYYY-MM-01' report_point, or null if not a known quarter.
function reportPoint(year: number, refPeriod: string): string | null {
  const m = QUARTER_MONTH[refPeriod.toUpperCase()]
  if (!m) return null
  return `${year}-${String(m).padStart(2, '0')}-01`
}

// ─── Main ─────────────────────────────────────────────────────────────────────────

async function main() {
  const { createClient } = await import('@supabase/supabase-js')

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const nassKey = process.env.NASS_QUICKSTATS_API_KEY
  if (!url || !key) {
    console.error('Missing env vars — ensure SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are set')
    process.exit(1)
  }
  if (!nassKey) {
    console.error('Missing NASS_QUICKSTATS_API_KEY — get a free key at quickstats.nass.usda.gov/api')
    process.exit(1)
  }

  // supabase-js eagerly resolves a WebSocket for realtime and throws on Node ≤20; we only
  // REST-upsert, so a never-instantiated transport short-circuits that (crop/corn pattern).
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in cattle-cycle-snapshot') } }
  const db = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  console.log('\nDryline — Cattle Cycle Snapshot (NASS heifers-on-feed YoY)\n')

  // 1) ONE NASS call: national heifers-on-feed, current + prior year (year__GE=lastYear-1).
  const lastYearMinusOne = new Date().getUTCFullYear() - 1
  const params = new URLSearchParams({
    key: nassKey,
    commodity_desc: 'CATTLE',
    statisticcat_desc: 'INVENTORY',
    short_desc: SHORT_DESC,
    agg_level_desc: 'NATIONAL',
    year__GE: String(lastYearMinusOne),
    format: 'JSON',
  })

  let rows: NassRow[]
  try {
    const res = await fetch(`${NASS_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQ_TIMEOUT),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (json && Array.isArray(json.error) && json.error.length) {
      throw new Error(`NASS error: ${json.error.join('; ')}`)
    }
    if (!json || !Array.isArray(json.data)) throw new Error('NASS response missing data[]')
    rows = json.data as NassRow[]
  } catch (err) {
    console.error(`  fetch failed: ${err instanceof Error ? err.message : err} — writing nothing`)
    process.exit(1)
  }

  // 2) report_point → heifer head count (usable rows only: known quarter + finite positive).
  const byPoint = new Map<string, number>()
  for (const r of rows) {
    const yr = finiteNum(typeof r.year === 'string' ? parseInt(r.year, 10) : r.year)
    const ref = typeof r.reference_period_desc === 'string' ? r.reference_period_desc : null
    if (yr === null || !ref) continue
    const pt = reportPoint(yr, ref)
    if (!pt) continue
    const val = parseValue(r.Value)
    if (val === null || val < COUNT_MIN || val > COUNT_MAX) continue
    byPoint.set(pt, val)
  }

  const pointsDesc = [...byPoint.keys()].sort((a, b) => (a < b ? 1 : -1))   // newest first
  if (pointsDesc.length === 0) {
    throw new Error('no usable heifers-on-feed quarter (non-finite / out of band / unknown period) — NASS empty or shape changed; writing nothing')
  }

  const latestPoint = pointsDesc[0]
  const heifers = byPoint.get(latestPoint)!

  // 3) Prior-year quarter = same month, year - 1 (best-effort; null if absent/non-positive).
  const [yStr, mStr] = latestPoint.split('-')
  const priorPoint = `${Number(yStr) - 1}-${mStr}-01`
  const priorYearHeifers = byPoint.get(priorPoint) ?? null
  const yoyPct =
    priorYearHeifers !== null && priorYearHeifers > 0
      ? Math.round(((heifers - priorYearHeifers) / priorYearHeifers) * 1000) / 10   // 1 decimal
      : null

  // 4) Idempotent upsert on report_point. raw keeps the figures for later re-derivation.
  const todayIso = new Date().toISOString().slice(0, 10)
  const { error } = await db.from('cattle_cycle_snapshots').upsert(
    {
      report_point:       latestPoint,
      heifers_on_feed:    heifers,
      prior_year_heifers: priorYearHeifers,
      yoy_pct:            yoyPct,
      raw:                { report_point: latestPoint, heifers, prior_point: priorPoint, prior_year_heifers: priorYearHeifers },
      source:             'USDA NASS Quick Stats',
      as_of:              todayIso,
    },
    { onConflict: 'report_point' },
  )
  if (error) {
    console.error(`  upsert failed: ${error.message}`)
    process.exit(1)
  }

  const dir = yoyPct == null ? '—' : yoyPct > 0 ? 'more ▲' : yoyPct < 0 ? 'fewer ▼' : 'flat •'
  console.log(
    `  wrote ${latestPoint}: ${heifers.toLocaleString()} heifers on feed ` +
    `${dir}${yoyPct != null ? ` (${yoyPct > 0 ? '+' : ''}${yoyPct.toFixed(1)}% YoY vs ${priorYearHeifers!.toLocaleString()} on ${priorPoint})` : ' (no prior-year quarter — YoY unavailable)'} ✓\n`,
  )
}

main().catch(err => {
  console.error('\n  error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
