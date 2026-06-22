// ─── Corn price snapshot writer (CBOT ZC=F daily settle) ──────────────────────────
//
// Fetches the front-month CBOT corn-futures settle from Yahoo Finance's v8 chart
// endpoint and UPSERTS one row into Supabase (public.corn_price_snapshots, migration
// 027). PUBLIC reference data, so it writes with the SERVICE-ROLE client — never the
// SSR/anon client. Runs OFF the Vercel request path (GitHub Actions cron, mirroring
// mars-snapshot.ts): the dashboard only READS the latest settle, it never fetches Yahoo.
//
// Source — Yahoo v8 chart (NO crumb/cookie needed, unlike /v7/quote):
//   GET https://query1.finance.yahoo.com/v8/finance/chart/ZC=F?interval=1d&range=5d
//   → chart.result[0].meta.{ regularMarketPrice, chartPreviousClose, regularMarketTime,
//     exchangeTimezoneName } (+ indicators.quote[0].close[] as a fallback for the settle).
//   Corn quotes in ¢/bushel (e.g. 432.25 = $4.3225/bu); we store that ¢/bushel figure.
//
//   Run locally:  npx tsx scripts/corn-snapshot.ts
//   (needs SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env)
//
// SAFETY: a non-finite settle, an empty/error Yahoo payload, or a price outside a sane
// ¢/bushel band → write NOTHING and exit non-zero (never a guessed or $0 row). The prior
// settle is nullable (direction simply can't be shown until it exists), never fabricated.

// @next/env must load before anything reads process.env (mirrors lrp-snapshot.ts).
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

// ─── Target ───────────────────────────────────────────────────────────────────────
const SYMBOL        = 'ZC=F'            // front-month continuous CBOT corn
const CONTRACT      = 'front-month'     // human label stored alongside
const CHART_URL     = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(SYMBOL)}?interval=1d&range=5d`
const UA            = 'Mozilla/5.0 (compatible; DrylineBot/1.0; +https://dryline.farm)'
const REQ_TIMEOUT   = 15_000

// Plausible corn ¢/bushel band — outside this means a wrong field/units (e.g. a $-denominated
// 4.32, a volume, a rate) → SKIP, never write. Corn has historically ranged ~150–850 ¢/bu;
// 100–2000 is generous headroom that still catches garbage.
const PRICE_MIN = 100
const PRICE_MAX = 2000

// ─── Helpers ────────────────────────────────────────────────────────────────────────

// Copied from lib/lrp-service.ts — the one defensive number gate used everywhere.
function finiteNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// epoch seconds → 'YYYY-MM-DD' in the exchange's own timezone (so the settle date is the CBOT
// business day, not a UTC/local off-by-one). 'en-CA' formats as YYYY-MM-DD.
function exchangeDate(epochSeconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(epochSeconds * 1000))
}

interface YahooMeta {
  regularMarketPrice?: unknown
  chartPreviousClose?: unknown
  previousClose?: unknown
  regularMarketTime?: unknown
  exchangeTimezoneName?: unknown
}

// ─── Main ─────────────────────────────────────────────────────────────────────────

async function main() {
  // Dynamic import so createClient evaluates after loadEnvConfig runs (mirrors lrp-snapshot).
  const { createClient } = await import('@supabase/supabase-js')

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing env vars — ensure SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are set')
    process.exit(1)
  }

  // supabase-js eagerly resolves a WebSocket constructor for realtime and throws on Node ≤20.
  // We only do a REST upsert (no channels), so a never-instantiated transport short-circuits
  // that. (Pattern from scripts/lrp-snapshot.ts / cattle-snapshot.ts.)
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in corn-snapshot') } }
  const db = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  console.log('\nDryline — Corn (ZC=F) Settle Snapshot\n')

  // 1) Fetch the Yahoo v8 chart. A hung host rejects on the timeout → honest non-zero exit.
  let json: unknown
  try {
    const res = await fetch(CHART_URL, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQ_TIMEOUT),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    json = await res.json()
  } catch (err) {
    console.error(`  fetch failed: ${err instanceof Error ? err.message : err} — writing nothing`)
    process.exit(1)
  }

  // 2) Defensive parse. Any missing piece → write nothing, exit non-zero (never a garbage row).
  const chart = (json as { chart?: { result?: unknown[]; error?: unknown } }).chart
  if (chart?.error) throw new Error(`Yahoo chart error: ${JSON.stringify(chart.error)}`)
  const result = chart?.result?.[0] as
    | { meta?: YahooMeta; timestamp?: unknown; indicators?: { quote?: Array<{ close?: unknown }> } }
    | undefined
  const meta = result?.meta
  if (!meta) throw new Error('Yahoo payload missing chart.result[0].meta')

  // Settle: regularMarketPrice, else the last finite daily close.
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close)
    ? (result!.indicators!.quote![0].close as unknown[])
    : []
  const lastFiniteClose = [...closes].reverse().map(finiteNum).find(n => n !== null) ?? null
  const settle = finiteNum(meta.regularMarketPrice) ?? lastFiniteClose
  if (settle === null) throw new Error('no finite settle price in Yahoo payload')
  if (settle < PRICE_MIN || settle > PRICE_MAX) {
    throw new Error(`settle ${settle}¢/bu outside ${PRICE_MIN}–${PRICE_MAX} band — refusing to write`)
  }

  // Prior settle: chartPreviousClose, else previousClose, else the 2nd-to-last finite close.
  const finiteCloses = closes.map(finiteNum).filter((n): n is number => n !== null)
  const priorSettle =
    finiteNum(meta.chartPreviousClose) ??
    finiteNum(meta.previousClose) ??
    (finiteCloses.length >= 2 ? finiteCloses[finiteCloses.length - 2] : null)

  // Settle date: from regularMarketTime in the exchange tz (fallback America/Chicago = CBOT).
  const tz = typeof meta.exchangeTimezoneName === 'string' ? meta.exchangeTimezoneName : 'America/Chicago'
  const mktTime = finiteNum(meta.regularMarketTime)
  if (mktTime === null) throw new Error('Yahoo payload missing regularMarketTime')
  const settleDate = exchangeDate(mktTime, tz)
  const todayIso = new Date().toISOString().slice(0, 10)

  // 3) Idempotent upsert on (symbol, settle_date).
  const { error } = await db.from('corn_price_snapshots').upsert(
    {
      symbol:       SYMBOL,
      contract:     CONTRACT,
      settle_date:  settleDate,
      settle_price: settle,
      prior_settle: priorSettle,
      source:       'Yahoo Finance',
      as_of:        todayIso,
    },
    { onConflict: 'symbol,settle_date' },
  )
  if (error) {
    console.error(`  upsert failed: ${error.message}`)
    process.exit(1)
  }

  const dir = priorSettle == null ? '—' : settle > priorSettle ? '▲' : settle < priorSettle ? '▼' : '•'
  console.log(
    `  wrote ${SYMBOL} (${CONTRACT}) ${settleDate} = ${settle.toFixed(2)}¢/bu ` +
    `${dir}${priorSettle != null ? ` (prior ${priorSettle.toFixed(2)})` : ''} ✓\n`,
  )
}

main().catch(err => {
  console.error('\n  error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
