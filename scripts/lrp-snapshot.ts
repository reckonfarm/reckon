// ─── LRP price snapshot writer (local seed) ───────────────────────────────────────
//
// Fetches + parses USDA RMA "Livestock Risk Protection (LRP) Coverage Prices, Rates,
// and Actual Ending Values" and UPSERTS one headline snapshot into Supabase
// (public.lrp_price_snapshots, migration 022). PUBLIC reference data, so it writes with
// the SERVICE-ROLE client — never the SSR/anon client. Run OFF the Vercel request path
// (locally, residential IP), exactly like scripts/cattle-snapshot.ts: the dashboard
// only READS the snapshot, it never fetches RMA.
//
// The RMA report is a 3-step ASP.NET-Core antiforgery POST wizard (proven in recon):
//   1) GET   the criteria page → capture __RequestVerificationToken (T1) + cookie.
//   2) POST  CurrentQuestion=EffectiveDate, EffectiveDate=<date>, ReportType=HTML,
//            buttonType="Next >>" (TWO angle brackets — exact), token=T1
//            → StateSelection page + a FRESH token T2 (carries EffectiveDate hidden).
//   3) POST  CurrentQuestion=StateSelection, EffectiveDate=<date> (carry it — dropping
//            it resets the wizard), StateSelection=30|Montana, buttonType="Create Report",
//            token=T2 → the HTML report table.
// The antiforgery token from the IMMEDIATELY-PRIOR response + the cookie are threaded on
// every POST.
//
//   Local seed (latest date):  npx tsx scripts/lrp-snapshot.ts
//   Local seed (explicit date): npx tsx scripts/lrp-snapshot.ts 06/12/2026
//   (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local)
//
// SAFETY: the headline row is extracted by an EXACT filter (Feeder Cattle · Steers
// Weight 2 · 13-wk · 100% · adj 1.00). If that filter matches anything other than
// EXACTLY ONE row, or the price isn't a plausible feeder $/cwt, the script THROWS and
// writes NOTHING — a wrong row is worse than no row (the $1,346 "Unborn Calves" row is
// the cautionary case the adj-factor=1.00 filter excludes).

// @next/env must load before anything reads process.env (mirrors seed-rma-deadlines.ts).
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

// ─── Target (Montana feeder steers — the recon target; multi-state is future work) ──
const REPORT_URL  = 'https://public.rma.usda.gov/livestockreports/LRPReport'
const UA          = 'Mozilla/5.0 (compatible; DrylineBot/1.0; +https://dryline.farm)'
const REQ_TIMEOUT = 45_000   // the MT report is large (~13 MB); give it room

const STATE_SELECTION = '30|Montana'   // the StateSelection <option> value
const STATE_CODE      = 'MT'           // stored in the char(2) state column

// The headline row we surface on the card — an EXACT, defensive filter.
const FILTER = {
  commodityRe: /feeder cattle/i,
  typeRe:      /steers weight 2/i,
  lengthWeeks: 13,
  coverageLevel: 1.0,      // 100%
  priceAdjFactor: 1.0,     // excludes the Unborn-Calves 3.79-factor row
}
// Stored natural-key values (must be STABLE across runs for idempotent upsert).
const KEY_COMMODITY = 'Feeder Cattle'
const KEY_TYPE      = 'Steers Weight 2'

// Plausible feeder $/cwt band — outside this, refuse to write (caught a wrong column).
const PRICE_MIN = 100
const PRICE_MAX = 600

// ─── Small helpers ──────────────────────────────────────────────────────────────────

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim()
}

function money(s: string): number {
  const n = parseFloat(String(s).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n)) throw new Error(`unparseable money value: "${s}"`)
  return n
}
function num(s: string): number {
  const n = parseFloat(String(s).replace(/[,\s]/g, ''))
  if (!Number.isFinite(n)) throw new Error(`unparseable number: "${s}"`)
  return n
}
const approx = (a: number, b: number, eps = 0.001) => Math.abs(a - b) <= eps

function tokenOf(html: string): string {
  const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)
  if (!m) throw new Error('antiforgery __RequestVerificationToken not found in response')
  return m[1]
}

// EffectiveDate <select> options, newest first (the page lists newest → oldest).
function effectiveDateOptions(html: string): string[] {
  const block = html.match(/<select[^>]*name="EffectiveDate"[\s\S]*?<\/select>/i)?.[0] ?? ''
  return [...block.matchAll(/value="([^"]+)"/g)].map(m => m[1]).filter(Boolean)
}

// '06/12/2026' (MM/DD/YYYY, zero-padded) → '2026-06-12' for the date column.
function toIso(mmddyyyy: string): string {
  const m = mmddyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) throw new Error(`effective date not MM/DD/YYYY: "${mmddyyyy}"`)
  return `${m[3]}-${m[1]}-${m[2]}`
}

// Parse every <tr> into an array of decoded <td> cell strings.
function parseRows(html: string): string[][] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(rw =>
    [...rw[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => decode(c[1])),
  )
}

// ─── Cookie-threading fetch (manual; node fetch doesn't persist cookies) ─────────────

class Wizard {
  private cookie = ''
  private absorb(res: Response) {
    const sc = (res as Response & { headers: Headers }).headers.getSetCookie?.() ?? []
    if (sc.length) this.cookie = sc.map(c => c.split(';')[0]).join('; ')
  }
  async get(): Promise<string> {
    const res = await fetch(REPORT_URL, {
      headers: { 'User-Agent': UA, ...(this.cookie ? { Cookie: this.cookie } : {}) },
      signal: AbortSignal.timeout(REQ_TIMEOUT),
    })
    if (!res.ok) throw new Error(`GET criteria page failed: HTTP ${res.status}`)
    this.absorb(res)
    return res.text()
  }
  async post(fields: Record<string, string>): Promise<string> {
    const res = await fetch(REPORT_URL, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(REQ_TIMEOUT),
    })
    if (!res.ok) throw new Error(`POST failed: HTTP ${res.status}`)
    this.absorb(res)
    return res.text()
  }
}

// ─── Column index map (header is the first populated <td> row — no <th>) ─────────────

interface Cols {
  endLen: number; commodity: number; type: number; practice: number; priceAdj: number
  expEnd: number; coveragePrice: number; coverageLevel: number; rate: number
  cost: number; premium: number; endDate: number
}

function locateColumns(rows: string[][]): { cols: Cols; headerIdx: number } {
  const headerIdx = rows.findIndex(c => c.some(x => x === 'Coverage Price'))
  if (headerIdx < 0) throw new Error('report header row (with "Coverage Price") not found')
  const header = rows[headerIdx]
  const find = (needle: string) => {
    const i = header.findIndex(h => h.toLowerCase().includes(needle.toLowerCase()))
    if (i < 0) throw new Error(`report column not found: "${needle}"`)
    return i
  }
  const premium = find('Producer Premium')
  return {
    headerIdx,
    cols: {
      endLen:        find('Endorsement Length'),
      commodity:     find('Commodity'),
      type:          find('Type'),
      practice:      find('Practice'),
      priceAdj:      find('Price Adj'),
      expEnd:        find('Exp. End'),
      coveragePrice: find('Coverage Price'),
      coverageLevel: find('Coverage Level'),
      rate:          find('Rate'),
      cost:          find('Cost'),
      premium,
      endDate:       premium + 1,   // the end-date column has no header label (positional)
    },
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────────

async function main() {
  // Dynamic import so createClient evaluates after loadEnvConfig runs.
  const { createClient } = await import('@supabase/supabase-js')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing env vars — ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in .env.local')
    process.exit(1)
  }

  // supabase-js eagerly resolves a WebSocket constructor for realtime and throws on
  // Node ≤20. We only do a REST upsert (no channels), so a never-instantiated transport
  // short-circuits that. (No 'ws' dependency.) — pattern from scripts/cattle-snapshot.ts.
  type RealtimeOpts = NonNullable<NonNullable<Parameters<typeof createClient>[2]>['realtime']>
  class NoopWebSocket { constructor() { throw new Error('realtime is disabled in lrp-snapshot') } }
  const db = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopWebSocket as unknown as RealtimeOpts['transport'] },
  })

  console.log('\nDryline — RMA LRP Snapshot\n')

  // 1) GET criteria page → token + cookie + available effective dates.
  const wiz = new Wizard()
  const page1 = await wiz.get()
  const dates = effectiveDateOptions(page1)
  if (dates.length === 0) throw new Error('no EffectiveDate options on the criteria page')

  // Target date: CLI arg if given (must be one the report offers), else the newest.
  const argDate = process.argv[2]
  const effDate = argDate ?? dates[0]
  if (!dates.includes(effDate)) {
    throw new Error(`effective date ${effDate} not offered (newest available: ${dates[0]})`)
  }
  const effIso = toIso(effDate)
  console.log(`  effective date  ${effDate}  (newest offered: ${dates[0]})`)

  // 2) POST EffectiveDate → StateSelection page (fresh token).
  const page2 = await wiz.post({
    CurrentQuestion: 'EffectiveDate',
    EffectiveDate: effDate,
    ReportType: 'HTML',
    buttonType: 'Next >>',
    __RequestVerificationToken: tokenOf(page1),
  })

  // 3) POST StateSelection (+ carry EffectiveDate) with Create Report → the report.
  const report = await wiz.post({
    CurrentQuestion: 'StateSelection',
    EffectiveDate: effDate,
    StateSelection: STATE_SELECTION,
    ReportType: 'HTML',
    buttonType: 'Create Report',
    __RequestVerificationToken: tokenOf(page2),
  })

  // Parse the table + locate columns defensively.
  const rows = parseRows(report)
  const { cols, headerIdx } = locateColumns(rows)
  const dataRows = rows.slice(headerIdx + 1).filter(c => c.length > cols.premium)

  // Keep the FULL set of Feeder Cattle / Steers Weight 2 rows (all lengths + levels) for
  // the jsonb, and pull the single headline row out of it by the exact filter.
  const steersW2 = dataRows.filter(c =>
    FILTER.commodityRe.test(c[cols.commodity]) && FILTER.typeRe.test(c[cols.type]),
  )
  if (steersW2.length === 0) {
    throw new Error('no Feeder Cattle / Steers Weight 2 rows in report — writing nothing')
  }

  const rowObj = (c: string[]) => ({
    endorsement_length_weeks: parseInt(c[cols.endLen], 10),
    practice:                 c[cols.practice] || null,
    price_adj_factor:         num(c[cols.priceAdj]),
    coverage_level:           parseFloat(c[cols.coverageLevel]),
    expected_ending_value:    num(c[cols.expEnd]),
    coverage_price:           money(c[cols.coveragePrice]),
    rate:                     parseFloat(c[cols.rate]),
    cost_per_cwt:             num(c[cols.cost]),
    producer_premium_per_cwt: num(c[cols.premium]),
    endorsement_end_date:     c[cols.endDate] || null,
  })

  // Headline — EXACT match. Anything but exactly one row is a refuse-to-write condition.
  const headlineRows = steersW2.filter(c =>
    parseInt(c[cols.endLen], 10) === FILTER.lengthWeeks &&
    approx(parseFloat(c[cols.coverageLevel]), FILTER.coverageLevel) &&
    approx(num(c[cols.priceAdj]), FILTER.priceAdjFactor),
  )
  if (headlineRows.length !== 1) {
    throw new Error(
      `headline filter matched ${headlineRows.length} rows (expected exactly 1) — ` +
      'refusing to guess, writing nothing',
    )
  }

  const hc = headlineRows[0]
  const headline = {
    commodity:                hc[cols.commodity],   // e.g. '0801 Feeder Cattle'
    type:                     hc[cols.type],        // e.g. '810 Steers Weight 2'
    coverage_price:           money(hc[cols.coveragePrice]),
    expected_ending_value:    num(hc[cols.expEnd]),
    coverage_level:           parseFloat(hc[cols.coverageLevel]),
    endorsement_length_weeks: parseInt(hc[cols.endLen], 10),
    rate:                     parseFloat(hc[cols.rate]),
    cost_per_cwt:             num(hc[cols.cost]),
    producer_premium_per_cwt: num(hc[cols.premium]),
    endorsement_end_date:     hc[cols.endDate] || null,
    effective_date:           effIso,
  }

  // Sanity — a plausible feeder $/cwt; outside the band means we grabbed the wrong column.
  if (headline.coverage_price < PRICE_MIN || headline.coverage_price > PRICE_MAX) {
    throw new Error(
      `headline coverage price $${headline.coverage_price}/cwt outside plausible ` +
      `${PRICE_MIN}–${PRICE_MAX} band — refusing to write`,
    )
  }

  const todayIso = new Date().toISOString().slice(0, 10)
  const snapshot = {
    headline,
    rows: steersW2.map(rowObj),     // full Steers Weight 2 set (all lengths/levels)
    state: STATE_CODE,
    source_url: REPORT_URL,
    parsed_at: new Date().toISOString(),
  }

  // 4) Upsert ONE row, idempotent on the natural key.
  const { error } = await db.from('lrp_price_snapshots').upsert(
    {
      commodity:      KEY_COMMODITY,
      lrp_type:       KEY_TYPE,
      state:          STATE_CODE,
      effective_date: effIso,
      snapshot,
      source:         'USDA RMA',
      as_of:          todayIso,
    },
    { onConflict: 'commodity,lrp_type,state,effective_date' },
  )
  if (error) {
    throw new Error(`upsert failed (nothing written): ${error.message}`)
  }

  console.log(
    `  headline        ${KEY_COMMODITY} · ${KEY_TYPE} · ${headline.endorsement_length_weeks}wk · ` +
    `100% = $${headline.coverage_price.toFixed(2)}/cwt (exp. end $${headline.expected_ending_value.toFixed(2)})`,
  )
  console.log(`  rows kept       ${steersW2.length} (Steers Weight 2, all lengths/levels)`)
  console.log(`  done — upserted 1 LRP snapshot for ${STATE_CODE} ${effIso} ✓\n`)
}

main().catch(err => {
  console.error('\n  error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
