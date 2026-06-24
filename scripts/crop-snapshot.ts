// ─── Crop condition snapshot writer (NASS corn good+excellent) ──────────────────────
//
// Fetches US corn CONDITION (% good + % excellent) from USDA NASS Quick Stats in ONE call
// and UPSERTS one weekly row into Supabase (public.crop_condition_snapshots, migration 029) —
// the Crop leg of the dashboard's Market Read (§4 Leg 2). PUBLIC reference data, so it writes
// with the SERVICE-ROLE client. Runs OFF the request path on a WEEKLY cron (NASS Crop
// Progress releases Mondays ~4pm ET in season); the dashboard only READS the latest row.
//
// Source — NASS Quick Stats (requires a FREE API key, env NASS_QUICKSTATS_API_KEY):
//   GET https://quickstats.nass.usda.gov/api/api_GET/?key=<KEY>
//       &source_desc=SURVEY&commodity_desc=CORN&statisticcat_desc=CONDITION
//       &agg_level_desc=NATIONAL&year__GE=<lastYear>&format=JSON
//   → { data: [ { short_desc, unit_desc, Value, week_ending, reference_period_desc, … } ] }.
//   CONDITION arrives as SEPARATE category rows (unit_desc 'PCT GOOD', 'PCT EXCELLENT',
//   'PCT FAIR', 'PCT POOR', 'PCT VERY POOR'); G/E = PCT GOOD + PCT EXCELLENT per week.
//   year__GE=<lastYear> returns current + prior season in one call, so the ~4-week trend is
//   in the same response (and an OFF-SEASON run still captures last November's final week).
//
//   Run locally:  npx tsx scripts/crop-snapshot.ts
//   (needs SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
//    NASS_QUICKSTATS_API_KEY in env)
//
// SAFETY: no CONDITION rows, or a week missing either PCT GOOD or PCT EXCELLENT, or a G/E sum
// that isn't a finite 0–100 → that week is unusable; if NO usable week exists, write nothing
// and exit non-zero. Never a garbage/partial/0 number. The prior week is best-effort and only
// set when it is IN-SEASON relative to latest (≤45 days before) — so a season-boundary run
// never fabricates a cross-season "trend"; otherwise prior is null (direction just unavailable).
// SEASONALITY itself (off-season "resumes in spring") is decided in the READ path from the
// latest week_ending, not here — this writer just lands the freshest real week it can.

// @next/env must load before anything reads process.env (mirrors moisture-snapshot.ts).
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

// ─── Target ───────────────────────────────────────────────────────────────────────
const NASS_URL    = 'https://quickstats.nass.usda.gov/api/api_GET/'
const COMMODITY   = 'CORN'
const GEOGRAPHY   = 'US'                 // national for v1 (room for per-state later)
const REQ_TIMEOUT = 30_000
const PRIOR_TARGET_DAYS = 28             // ~4 weeks prior for the trend
const PRIOR_MAX_GAP_DAYS = 45            // reject a prior week farther back than this (cross-season guard)
const GE_MIN = 0
const GE_MAX = 100

// ─── Helpers ────────────────────────────────────────────────────────────────────────

// Copied from lib/corn-service.ts / lib/lrp-service.ts — the one defensive number gate.
function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// NASS Value strings may carry commas / withheld markers ('(D)', '(NA)'); parse to a finite
// number or null (never NaN). PCT values are plain ('72'), but strip defensively.
function parseValue(v: unknown): number | null {
  if (typeof v === 'number') return finiteNum(v)
  if (typeof v !== 'string') return null
  const n = parseFloat(v.replace(/[,\s]/g, ''))
  return finiteNum(n)
}

interface NassRow {
  unit_desc?: unknown
  short_desc?: unknown
  Value?: unknown
  week_ending?: unknown
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
  // REST-upsert, so a never-instantiated transport short-circuits that (corn/moisture pattern).
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in crop-snapshot') } }
  const db = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  console.log('\nDryline — Crop Condition Snapshot (NASS corn good+excellent)\n')

  // 1) ONE NASS call: national corn CONDITION, current + prior season (year__GE=lastYear).
  const lastYear = new Date().getUTCFullYear() - 1
  const params = new URLSearchParams({
    key: nassKey,
    source_desc: 'SURVEY',
    commodity_desc: COMMODITY,
    statisticcat_desc: 'CONDITION',
    agg_level_desc: 'NATIONAL',
    year__GE: String(lastYear),
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

  // 2) Per week_ending, collect PCT GOOD and PCT EXCELLENT. Both required for a usable week.
  const byWeek = new Map<string, { good: number | null; excellent: number | null }>()
  for (const r of rows) {
    const unit = typeof r.unit_desc === 'string' ? r.unit_desc.toUpperCase() : ''
    const wk = typeof r.week_ending === 'string' ? r.week_ending.slice(0, 10) : null
    if (!wk) continue
    const isGood = unit === 'PCT GOOD'
    const isExc  = unit === 'PCT EXCELLENT'
    if (!isGood && !isExc) continue
    const val = parseValue(r.Value)
    if (!byWeek.has(wk)) byWeek.set(wk, { good: null, excellent: null })
    const slot = byWeek.get(wk)!
    if (isGood) slot.good = val
    if (isExc) slot.excellent = val
  }

  // G/E per usable week (both categories finite, sum in 0–100).
  const geByWeek = new Map<string, number>()
  for (const [wk, { good, excellent }] of byWeek) {
    if (good === null || excellent === null) continue
    const ge = good + excellent
    if (ge < GE_MIN || ge > GE_MAX) continue
    geByWeek.set(wk, Math.round(ge * 10) / 10)   // 1 decimal
  }

  const weeksDesc = [...geByWeek.keys()].sort((a, b) => (a < b ? 1 : -1))   // newest first
  if (weeksDesc.length === 0) {
    throw new Error('no usable corn CONDITION week (missing PCT GOOD/EXCELLENT or out of 0–100) — NASS empty/off-season with no prior data; writing nothing')
  }

  const latestWeek = weeksDesc[0]
  const gePct = geByWeek.get(latestWeek)!

  // 3) Prior = usable week nearest latest−28d, but ONLY if within 45 days before latest
  //    (cross-season guard — never compare new-crop April to last-crop November).
  const latestMs = Date.parse(`${latestWeek}T00:00:00Z`)
  const targetMs = latestMs - PRIOR_TARGET_DAYS * 86_400_000
  const maxGapMs = PRIOR_MAX_GAP_DAYS * 86_400_000
  let priorWeek: string | null = null
  let priorPct: number | null = null
  let bestDelta = Infinity
  for (const wk of weeksDesc) {
    const ms = Date.parse(`${wk}T00:00:00Z`)
    if (!(ms < latestMs)) continue                 // strictly older than latest
    if (latestMs - ms > maxGapMs) continue          // too far back (cross-season) — skip
    const delta = Math.abs(ms - targetMs)
    if (delta < bestDelta) { bestDelta = delta; priorWeek = wk; priorPct = geByWeek.get(wk)! }
  }

  // 4) Idempotent upsert on (commodity, geography, week_ending). raw keeps the category rows.
  const todayIso = new Date().toISOString().slice(0, 10)
  const latestSlot = byWeek.get(latestWeek)!
  const { error } = await db.from('crop_condition_snapshots').upsert(
    {
      commodity:          COMMODITY,
      geography:          GEOGRAPHY,
      week_ending:        latestWeek,
      good_excellent_pct: gePct,
      prior_ge_pct:       priorPct,
      prior_week_ending:  priorWeek,
      raw:                { week: latestWeek, good: latestSlot.good, excellent: latestSlot.excellent },
      source:             'USDA NASS Quick Stats',
      as_of:              todayIso,
    },
    { onConflict: 'commodity,geography,week_ending' },
  )
  if (error) {
    console.error(`  upsert failed: ${error.message}`)
    process.exit(1)
  }

  const dir = priorPct == null ? '—' : gePct > priorPct ? 'better ▲' : gePct < priorPct ? 'worse ▼' : 'flat •'
  console.log(
    `  wrote ${COMMODITY} ${GEOGRAPHY} ${latestWeek}: ${gePct.toFixed(1)}% good+excellent ` +
    `${dir}${priorPct != null ? ` (prior ${priorPct.toFixed(1)}% on ${priorWeek})` : ' (no in-season prior — direction unavailable)'} ✓\n`,
  )
}

main().catch(err => {
  console.error('\n  error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
