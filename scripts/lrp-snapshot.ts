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
//   Local seed (latest complete date): npx tsx scripts/lrp-snapshot.ts  (skips swine-only partials)
//   Local seed (explicit date):        npx tsx scripts/lrp-snapshot.ts 06/12/2026
//   (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local)
//
// SAFETY (per type): each type's headline row is extracted by an EXACT filter (13-wk ·
// 100% · adj 1.00) and bounded to a plausible feeder $/cwt band. A type that fails (≠ 1
// headline row, or a price outside the band) is SKIPPED with a log — never a guessed or
// garbage row — while the OTHER types still write. The adj-factor=1.00 gate is what excludes
// the $1,346 "Unborn Calves" 3.79-factor row. The run throws only if ALL types fail (nothing
// written). The dashboard type (Steers Weight 2) being skipped warns loudly but isn't fatal —
// the card falls back to its prior effective_date and flags itself stale.

// @next/env must load before anything reads process.env (mirrors seed-rma-deadlines.ts).
import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())

// ─── Target (Montana feeder beef matrix: Steers/Heifers × Weight 1/2; multi-state is future) ──
const REPORT_URL  = 'https://public.rma.usda.gov/livestockreports/LRPReport'
const UA          = 'Mozilla/5.0 (compatible; DrylineBot/1.0; +https://dryline.farm)'
const REQ_TIMEOUT = 45_000   // the MT report is large (~13 MB); give it room

const STATE_SELECTION = '30|Montana'   // the StateSelection <option> value
const STATE_CODE      = 'MT'           // stored in the char(2) state column

// We seed the FULL 4-type beef feeder matrix — Steers/Heifers × Weight 1/Weight 2 — one row per
// type (the natural key (commodity, lrp_type, state, effective_date) already carries lrp_type,
// so 4 types = 4 rows, no schema change). `key` is the NORMALIZED lrp_type stored in the column
// (== lotToLrpType's `${lrp_class} ${weight_code}` join key); `re` matches the report's Type cell
// ('810 Steers Weight 2'). Brahman / Dairy / Unborn are deliberately out of scope (a beef
// operation). The run logs each type written/skipped, so a report whose labels drift surfaces
// immediately rather than silently mismatching.
const FEEDER_TYPES = [
  { key: 'Steers Weight 1',  re: /steers weight 1/i },
  { key: 'Steers Weight 2',  re: /steers weight 2/i },
  { key: 'Heifers Weight 1', re: /heifers weight 1/i },
  { key: 'Heifers Weight 2', re: /heifers weight 2/i },
] as const
const FEEDER_RE = /feeder cattle/i

// The dashboard Markets card reads ONLY this type (lib/lrp-service pins getLatestLrp to it). If
// it's skipped, the card falls back to its prior effective_date (and goes stale on its own) — we
// warn loudly but don't fail the run, since the other types still wrote.
const DASHBOARD_TYPE = 'Steers Weight 2'

const KEY_COMMODITY = 'Feeder Cattle'   // stored natural-key commodity (stable across runs)

// The headline row per type — the same EXACT filter as before (13-wk · 100% · adj 1.00). The
// adj-factor=1.00 gate is what excludes the $1,346 Unborn-Calves 3.79-factor row.
const HEADLINE = { lengthWeeks: 13, coverageLevel: 1.0, priceAdjFactor: 1.0 }

// Plausible feeder $/cwt band — outside this, SKIP that type (catches a wrong column). Widened
// to 800 (from 600) because lighter Weight-1 calves run higher $/cwt in a hot market (2025–26);
// a wrong column (rates < 1, head counts, the 4-digit Unborn row) is still well outside it.
const PRICE_MIN = 100
const PRICE_MAX = 800

// RMA posts swine first; the newest offered date is often a partial (swine-only) posting. The
// date-selection loop tries the newest MAX_LOOKBACK offered dates and takes the first complete
// cattle posting (recon: only the very newest staggers, so 5 is generous headroom — the loop
// stops at the first hit, ~2 fetches in practice). None within the bound → honest fail.
const MAX_LOOKBACK = 5

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

// Fetch the full MT report for ONE effective date. A fresh wizard per date (proven across the
// recon's 6-date sweep): the antiforgery token chain is per-session, so each date gets its own
// GET → POST EffectiveDate → POST StateSelection → report HTML.
async function fetchReportForDate(effDate: string): Promise<string> {
  const wiz = new Wizard()
  const page1 = await wiz.get()
  const page2 = await wiz.post({
    CurrentQuestion: 'EffectiveDate',
    EffectiveDate: effDate,
    ReportType: 'HTML',
    buttonType: 'Next >>',
    __RequestVerificationToken: tokenOf(page1),
  })
  return wiz.post({
    CurrentQuestion: 'StateSelection',
    EffectiveDate: effDate,
    StateSelection: STATE_SELECTION,
    ReportType: 'HTML',
    buttonType: 'Create Report',
    __RequestVerificationToken: tokenOf(page2),
  })
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

  // 1) GET criteria page → available effective dates.
  const dates = effectiveDateOptions(await new Wizard().get())
  if (dates.length === 0) throw new Error('no EffectiveDate options on the criteria page')

  // 2) Pick the date to seed. RMA posts swine first and cattle fills in, so the NEWEST offered
  // date is often a partial (swine-only) posting with no feeder cattle (recon confirmed: only
  // the very newest staggers, one-back is reliably complete). An explicit CLI date is honored
  // as-is; otherwise we try the newest MAX_LOOKBACK offered dates and take the FIRST that
  // actually contains the feeder-cattle anchor (Steers Weight 2 — the type the dashboard pins
  // to). None within the bound → honest fail (write nothing, exit non-zero), never an older
  // date masquerading as current.
  const argDate = process.argv[2]
  const anchorRe = FEEDER_TYPES.find(t => t.key === DASHBOARD_TYPE)!.re
  const candidates = argDate ? [argDate] : dates.slice(0, MAX_LOOKBACK)

  let chosen: { effDate: string; dataRows: string[][]; cols: Cols } | null = null
  for (const cand of candidates) {
    if (!dates.includes(cand)) {
      throw new Error(`effective date ${cand} not offered (newest available: ${dates[0]})`)
    }
    const rows = parseRows(await fetchReportForDate(cand))
    const { cols: c, headerIdx } = locateColumns(rows)
    const drows = rows.slice(headerIdx + 1).filter(r => r.length > c.premium)
    const hasAnchor = drows.some(r => FEEDER_RE.test(r[c.commodity]) && anchorRe.test(r[c.type]))
    if (hasAnchor) { chosen = { effDate: cand, dataRows: drows, cols: c }; break }
    console.log(`  ${cand}: no feeder cattle (partial/swine-only posting) — trying prior date`)
  }
  if (!chosen) {
    throw new Error(
      `no feeder cattle in the ${candidates.length} newest offered date(s) ` +
      `(${candidates.join(', ')}) — RMA mid-post or down; writing nothing`,
    )
  }

  const { effDate, dataRows, cols } = chosen
  const effIso = toIso(effDate)
  console.log(`  effective date  ${effDate}  (newest offered: ${dates[0]})`)

  // Row → stored object (one type's full rowset goes in the jsonb; reused for every type).
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

  const todayIso = new Date().toISOString().slice(0, 10)
  const written: string[] = []
  const skipped: string[] = []

  // One row per beef type — each type's safety is INDEPENDENT: a type that fails its filter is
  // skipped (logged), never crashing the others. A type with no rows just isn't offered today.
  for (const t of FEEDER_TYPES) {
    const typeRows = dataRows.filter(c => FEEDER_RE.test(c[cols.commodity]) && t.re.test(c[cols.type]))
    if (typeRows.length === 0) {
      console.log(`  skip  ${t.key}: no rows in report`)
      skipped.push(t.key)
      continue
    }

    // Headline — EXACT match (13-wk · 100% · adj 1.00). Anything but exactly one row → skip this
    // type (refuse to guess); don't crash the run.
    const headlineRows = typeRows.filter(c =>
      parseInt(c[cols.endLen], 10) === HEADLINE.lengthWeeks &&
      approx(parseFloat(c[cols.coverageLevel]), HEADLINE.coverageLevel) &&
      approx(num(c[cols.priceAdj]), HEADLINE.priceAdjFactor),
    )
    if (headlineRows.length !== 1) {
      console.log(`  skip  ${t.key}: headline filter matched ${headlineRows.length} rows (expected 1)`)
      skipped.push(t.key)
      continue
    }

    const hc = headlineRows[0]
    const headline = {
      commodity:                hc[cols.commodity],   // raw, e.g. '0801 Feeder Cattle'
      type:                     hc[cols.type],        // raw, e.g. '810 Steers Weight 2' (display)
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

    // Sanity — a plausible feeder $/cwt; outside the band means a wrong column → skip the type.
    if (headline.coverage_price < PRICE_MIN || headline.coverage_price > PRICE_MAX) {
      console.log(`  skip  ${t.key}: coverage price $${headline.coverage_price}/cwt outside ${PRICE_MIN}–${PRICE_MAX} band`)
      skipped.push(t.key)
      continue
    }

    const snapshot = {
      headline,
      rows: typeRows.map(rowObj),    // this type's full set (all lengths/levels)
      state: STATE_CODE,
      source_url: REPORT_URL,
      parsed_at: new Date().toISOString(),
    }

    // Upsert ONE row for this type, idempotent on the natural key. lrp_type = the NORMALIZED key
    // (matches lotToLrpType's join key); commodity/state/effective_date complete the key.
    const { error } = await db.from('lrp_price_snapshots').upsert(
      {
        commodity:      KEY_COMMODITY,
        lrp_type:       t.key,
        state:          STATE_CODE,
        effective_date: effIso,
        snapshot,
        source:         'USDA RMA',
        as_of:          todayIso,
      },
      { onConflict: 'commodity,lrp_type,state,effective_date' },
    )
    if (error) {
      console.log(`  skip  ${t.key}: upsert failed — ${error.message}`)
      skipped.push(t.key)
      continue
    }

    console.log(
      `  wrote ${t.key.padEnd(16)} ${headline.endorsement_length_weeks}wk · 100% = ` +
      `$${headline.coverage_price.toFixed(2)}/cwt (exp. end $${headline.expected_ending_value.toFixed(2)}, ${typeRows.length} rows)`,
    )
    written.push(t.key)
  }

  // Nothing written at all = a genuine failure (bad fetch / wrong report) — exit non-zero.
  if (written.length === 0) {
    throw new Error('no LRP types written (all beef types skipped) — check the report')
  }

  // The dashboard type missing is not fatal (the card reads its prior effective_date), but it
  // warrants a loud line in the launchd log so a persistent miss gets noticed.
  if (!written.includes(DASHBOARD_TYPE)) {
    console.warn(`  WARNING: dashboard type "${DASHBOARD_TYPE}" not written this run — the Markets card will read its prior effective_date`)
  }

  console.log(`\n  done — ${written.length}/${FEEDER_TYPES.length} types upserted for ${STATE_CODE} ${effIso} ✓`)
  if (skipped.length) console.log(`  skipped: ${skipped.join(', ')}`)
  console.log('')
}

main().catch(err => {
  console.error('\n  error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
