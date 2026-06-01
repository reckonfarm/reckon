import 'server-only'

import { unstable_cache } from 'next/cache'

// ─── Cattle market service (v1) ──────────────────────────────────────────────────
//
// Server-only cattle price layer for the north-central Montana markets a Winnett /
// Petroleum County rancher actually sells into. Mirrors the discipline of
// lib/precip-normal.ts: bounded fetch with an AbortController timeout, honest
// failure shape (availability failure vs genuinely-empty), and revalidate caching.
//
// DATA SOURCE — v1 LIVE PATH: the free, public weekly "Montana Weekly Livestock
// Auction Summary" (USDA AMS Market News report 1778) — a weighted-average report
// combining the state's auction yards (Billings, Miles City, Public Auction Yards,
// et al.). Published as a PDF at a stable URL; NO API key required. We deliberately
// do NOT depend on the MARS API (its key still 401s).
//
// We parse THREE groups out of the PDF:
//   (a) FEEDER cattle — Steers + Heifers, aggregated into weight classes.
//   (b) SLAUGHTER / CULL cattle — cull cows and slaughter bulls ($/cwt + range).
//       (Under-served, high-value: cull cows are 15–30% of cow-calf revenue.)
//   (c) Report meta — receipts (this week / last / last year), the "compared to last
//       week" cash trend text, supply composition, and the report dates.
//
// CME DISCIPLINE: the narrative quotes CME futures / cattle-on-feed positions. We
// STRIP all of it — never extract, store, or display any CME data. AMS cash auction
// prices only.
//
// LIVE vs MOCK: live is the default (the report is public). Set CATTLE_MARKET_MOCK=1
// to serve a small, CLOCK-RELATIVE synthetic sample for offline/dev — no frozen
// fixture dates.

const REPORT_ID = '1778' as const
const REPORT_URL = `https://www.ams.usda.gov/mnreports/ams_${REPORT_ID}.pdf`
const SOURCE_LABEL = 'USDA AMS Market News — Montana Weekly Livestock Auction Summary'
const REVALIDATE_SECONDS = 21600 // 6h
const TIMEOUT_MS = 12000
const UA = 'Dryline/1.0 (+reckonfarm.com)'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface FeederClass {
  weightClass: string   // e.g. "5-6" (hundredweight bucket)
  label: string         // e.g. "500–600 lb"
  midWeight: number     // bucket midpoint in lbs, for the price curve
  avgCwt: number        // head-weighted average $/cwt across all grades in the bucket
  priceLow: number      // lowest reported $/cwt in the bucket
  priceHigh: number     // highest reported $/cwt in the bucket
  head: number          // total head
  avgWeight: number     // head-weighted average actual weight (lbs)
}

export interface FeederBySex {
  steers: FeederClass[]
  heifers: FeederClass[]
}

export interface SlaughterGroup {
  avgCwt: number        // head-weighted average $/cwt
  priceLow: number
  priceHigh: number
  head: number
}

export interface CattleReceipts {
  current: number | null
  lastReported: number | null
  lastYear: number | null
}

export interface FeederComposition {
  steersPct: number | null
  heifersPct: number | null
  bullsPct: number | null
}

export interface CattleMarket {
  status: 'ok' | 'data_unavailable'   // availability failure vs a real read
  mode: 'live' | 'mock'
  reportId: typeof REPORT_ID
  source: string
  asOf: string | null                 // ISO date the report was published
  asOfLabel: string | null            // "May 26, 2026"
  reportWindowLabel: string | null    // "May 17–23, 2026" — the sale week covered
  receipts: CattleReceipts
  feeder: FeederBySex
  cullCows: SlaughterGroup | null      // null = none reported this week (genuinely empty)
  slaughterBulls: SlaughterGroup | null
  feederComposition: FeederComposition
  supplyOver600Pct: number | null
  trendText: string | null            // "compared to last week" cash trend, CME-stripped
}

// ─── Small parse helpers ────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

function intOf(s: string): number | null {
  const n = parseInt(s.replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

function rangeOf(s: string): [number, number] {
  const parts = s.split('-')
  const lo = parseFloat(parts[0])
  const hi = parts.length === 2 ? parseFloat(parts[1]) : lo
  return [lo, hi]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// "May 26, 2026" → "2026-05-26"
function monthNameToIso(month: string, day: string, year: string): string | null {
  const mm = MONTHS[month.slice(0, 3).toLowerCase()]
  if (!mm) return null
  return `${year}-${mm}-${day.padStart(2, '0')}`
}

// "5/17/2026" → "2026-05-17"
function mdyToIso(mdy: string): string | null {
  const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

function isoToLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

// "2026-05-17" + "2026-05-23" → "May 17–23, 2026"
function windowLabel(startIso: string, endIso: string): string {
  const s = new Date(`${startIso}T00:00:00Z`)
  const e = new Date(`${endIso}T00:00:00Z`)
  const month = s.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  const sameMonth = s.getUTCMonth() === e.getUTCMonth()
  if (sameMonth) {
    return `${month} ${s.getUTCDate()}–${e.getUTCDate()}, ${e.getUTCFullYear()}`
  }
  const eMonth = e.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  return `${month} ${s.getUTCDate()} – ${eMonth} ${e.getUTCDate()}, ${e.getUTCFullYear()}`
}

const cwtLabel = (h: number) => `${h}00–${h + 1}00 lb`

// ─── PDF → lines (Y-grouped, column-ordered) ─────────────────────────────────────
//
// pdfjs gives positioned text items; we group by rounded Y (a row) and sort by X
// (columns), reproducing the report's tabular layout so each data row is one line.

async function pdfToLines(buf: ArrayBuffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise

  const lines: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const rows = new Map<number, Array<{ x: number; s: string }>>()
    for (const it of tc.items as Array<{ str?: string; transform?: number[] }>) {
      if (!it.str || !it.transform) continue
      const y = Math.round(it.transform[5])
      const x = it.transform[4]
      const bucket = rows.get(y) ?? []
      bucket.push({ x, s: it.str })
      rows.set(y, bucket)
    }
    const pageLines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, cells]) =>
        cells.sort((a, b) => a.x - b.x).map(c => c.s).join(' ').replace(/\s+/g, ' ').trim(),
      )
      .filter(Boolean)
    lines.push(...pageLines)
  }
  return lines
}

// ─── Report parse ────────────────────────────────────────────────────────────────

const BOILER = /^(Source:|Page \d+ of|MT Dept of Ag|Billings, MT \||www\.ams|https:\/\/mymarket|AMS Livestock|Montana Weekly|Montana Dept of Ag Mrkt|Email us|Head Wt Range)/
// head | wtRange | avgWt | priceRange | avgPrice | [dressing/notes]
const DATA_ROW = /^(\d{1,4})\s+(\d{2,4}(?:-\d{2,4})?)\s+(\d{2,4})\s+(\d{1,4}(?:\.\d{2})?(?:-\d{1,4}(?:\.\d{2})?)?)\s+(\d{1,4}\.\d{2})(?:\s+.+)?$/

interface RawRow { head: number; wl: number; wh: number; avgWt: number; pl: number; ph: number; avg: number }

function parseReport(lines: string[]): Omit<CattleMarket, 'status' | 'mode' | 'reportId' | 'source'> {
  let section: 'FEEDER' | 'SLAUGHTER' | 'REPLACEMENT' | null = null
  let sub: string | null = null

  const steerRows: RawRow[] = []
  const heiferRows: RawRow[] = []
  const cowRows: RawRow[] = []
  const slaughterBullRows: RawRow[] = []

  for (const l of lines) {
    if (BOILER.test(l)) continue
    if (l === 'FEEDER CATTLE') { section = 'FEEDER'; sub = null; continue }
    if (l === 'SLAUGHTER CATTLE') { section = 'SLAUGHTER'; sub = null; continue }
    if (l === 'REPLACEMENT CATTLE') { section = 'REPLACEMENT'; sub = null; continue }

    const sm = l.match(/^(DAIRY COWS|STEERS|HEIFERS|BULLS|COWS) - /)
    if (sm) { sub = sm[1]; continue }

    const m = l.match(DATA_ROW)
    if (!m || !section) continue
    const [wl, wh] = rangeOf(m[2])
    const [pl, ph] = rangeOf(m[4])
    const row: RawRow = { head: +m[1], wl, wh, avgWt: +m[3], pl, ph, avg: +m[5] }

    if (section === 'FEEDER' && sub === 'STEERS') steerRows.push(row)
    else if (section === 'FEEDER' && sub === 'HEIFERS') heiferRows.push(row)
    else if (section === 'SLAUGHTER' && sub === 'COWS') cowRows.push(row)       // beef cull cows
    else if (section === 'SLAUGHTER' && sub === 'BULLS') slaughterBullRows.push(row)
    // DAIRY COWS, feeder BULLS, REPLACEMENT, sheep/goats → intentionally ignored
  }

  const aggFeeder = (rows: RawRow[]): FeederClass[] => {
    const by = new Map<number, { head: number; pw: number; lo: number; hi: number; wtw: number }>()
    for (const r of rows) {
      const h = Math.floor(r.avgWt / 100)
      const b = by.get(h) ?? { head: 0, pw: 0, lo: Infinity, hi: -Infinity, wtw: 0 }
      b.head += r.head
      b.pw += r.avg * r.head
      b.lo = Math.min(b.lo, r.pl)
      b.hi = Math.max(b.hi, r.ph)
      b.wtw += r.avgWt * r.head
      by.set(h, b)
    }
    return [...by.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, b]) => b.head > 0)
      .map(([h, b]) => ({
        weightClass: `${h}-${h + 1}`,
        label: cwtLabel(h),
        midWeight: h * 100 + 50,
        avgCwt: round2(b.pw / b.head),
        priceLow: b.lo,
        priceHigh: b.hi,
        head: b.head,
        avgWeight: Math.round(b.wtw / b.head),
      }))
  }

  const aggSlaughter = (rows: RawRow[]): SlaughterGroup | null => {
    const head = rows.reduce((s, r) => s + r.head, 0)
    if (head === 0) return null
    const pw = rows.reduce((s, r) => s + r.avg * r.head, 0)
    return {
      head,
      avgCwt: round2(pw / head),
      priceLow: Math.min(...rows.map(r => r.pl)),
      priceHigh: Math.max(...rows.map(r => r.ph)),
    }
  }

  // ── Meta ──────────────────────────────────────────────────────────────────────
  let asOf: string | null = null
  for (const l of lines) {
    const m = l.match(/([A-Z][a-z]{2,8}) (\d{1,2}), (\d{4})/)
    if (m) { asOf = monthNameToIso(m[1], m[2], m[3]); if (asOf) break }
  }

  let reportWindowLabel: string | null = null
  const win = lines.find(l => /Weighted Average Report for/.test(l))
  if (win) {
    const m = win.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/)
    if (m) {
      const s = mdyToIso(m[1])
      const e = mdyToIso(m[2])
      if (s && e) reportWindowLabel = windowLabel(s, e)
    }
  }

  const receipts: CattleReceipts = { current: null, lastReported: null, lastYear: null }
  const rl = lines.find(l => /^Total Receipts:/.test(l))
  if (rl) {
    const nums = rl.match(/[\d,]+/g) ?? []
    receipts.current = nums[0] != null ? intOf(nums[0]) : null
    receipts.lastReported = nums[1] != null ? intOf(nums[1]) : null
    receipts.lastYear = nums[2] != null ? intOf(nums[2]) : null
  }

  const over600 = lines.find(l => /Feeder cattle supply over 600 lbs was/.test(l))
  const supplyOver600Pct = over600
    ? (over600.match(/over 600 lbs was (\d+)%/)?.[1] != null ? +over600.match(/over 600 lbs was (\d+)%/)![1] : null)
    : null

  const feederComposition: FeederComposition = { steersPct: null, heifersPct: null, bullsPct: null }
  const comp = lines.find(l => /% Feeder Cattle \(/.test(l))
  if (comp) {
    const m = comp.match(/% Feeder Cattle \((\d+)% Steers, (\d+)% Heifers, (\d+)% Bulls\)/)
    if (m) {
      feederComposition.steersPct = +m[1]
      feederComposition.heifersPct = +m[2]
      feederComposition.bullsPct = +m[3]
    }
  }

  return {
    asOf,
    asOfLabel: asOf ? isoToLabel(asOf) : null,
    reportWindowLabel,
    receipts,
    feeder: { steers: aggFeeder(steerRows), heifers: aggFeeder(heiferRows) },
    cullCows: aggSlaughter(cowRows),
    slaughterBulls: aggSlaughter(slaughterBullRows),
    feederComposition,
    supplyOver600Pct,
    trendText: extractTrend(lines),
  }
}

// "Compared to last week" cash-trend text, with all CME / futures / cattle-on-feed
// sentences removed. We keep cash auction commentary only.
const CME_SENTENCE = /\bCME\b|cattle on feed|on feed report|\bcontract\b|settled (?:friday|at)|closed (?:friday|at)|placements|marketing'?s|futures|friday at \d|friday'?s close/i

function extractTrend(lines: string[]): string | null {
  const start = lines.findIndex(l => /^Compared to last week:/.test(l))
  if (start === -1) return null
  const end = lines.findIndex((l, i) => i > start && /Supply included:/.test(l))
  const slice = lines.slice(start, end === -1 ? start + 30 : end)
  let para = slice.join(' ').replace(/^Compared to last week:\s*/, '').replace(/\s+/g, ' ').trim()
  // Cut any trailing "Supply included:" that bled into the joined slice.
  para = para.replace(/Supply included:.*$/, '').trim()
  const sentences = para.split(/(?<=\.)\s+/).map(s => s.trim()).filter(Boolean)
  const cash = sentences.filter(s => !CME_SENTENCE.test(s))
  const text = cash.join(' ').trim()
  return text.length ? text : null
}

// ─── Live fetch ────────────────────────────────────────────────────────────────

async function fetchAndParse(): Promise<CattleMarket> {
  const base = {
    mode: 'live' as const,
    reportId: REPORT_ID,
    source: `${SOURCE_LABEL} (Report ${REPORT_ID})`,
  }
  const unavailable: CattleMarket = {
    ...base,
    status: 'data_unavailable',
    asOf: null, asOfLabel: null, reportWindowLabel: null,
    receipts: { current: null, lastReported: null, lastYear: null },
    feeder: { steers: [], heifers: [] },
    cullCows: null, slaughterBulls: null,
    feederComposition: { steersPct: null, heifersPct: null, bullsPct: null },
    supplyOver600Pct: null, trendText: null,
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(REPORT_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/pdf' },
      cache: 'no-store', // unstable_cache wraps this; the bytes don't need double-caching
    })
    if (!res.ok) throw new Error(`AMS ${REPORT_ID} → ${res.status}`)
    const buf = await res.arrayBuffer()
    const lines = await pdfToLines(buf)
    const parsed = parseReport(lines)

    // ok only if we actually read something real; otherwise it's an availability/parse failure.
    const gotSomething =
      parsed.asOf != null &&
      (parsed.receipts.current != null ||
        parsed.cullCows != null ||
        parsed.feeder.steers.length > 0 ||
        parsed.feeder.heifers.length > 0)
    if (!gotSomething) throw new Error(`AMS ${REPORT_ID} parsed empty`)

    return { ...base, status: 'ok', ...parsed }
  } catch (err) {
    console.error('[cattle-market] fetch/parse failed:', err)
    return unavailable
  } finally {
    clearTimeout(timeout)
  }
}

// ─── Mock (clock-relative, no frozen dates) ──────────────────────────────────────

function mockMarket(): CattleMarket {
  // Most recent Monday-ending sale week, derived from the clock — never frozen.
  const now = new Date()
  const end = new Date(now); end.setUTCDate(end.getUTCDate() - ((now.getUTCDay() + 1) % 7) - 1)
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 6)
  const pub = new Date(end); pub.setUTCDate(pub.getUTCDate() + 3)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const fc = (h: number, avgCwt: number, head: number): FeederClass => ({
    weightClass: `${h}-${h + 1}`, label: cwtLabel(h), midWeight: h * 100 + 50,
    avgCwt, priceLow: avgCwt - 12, priceHigh: avgCwt + 10, head, avgWeight: h * 100 + 50,
  })
  return {
    status: 'ok', mode: 'mock', reportId: REPORT_ID, source: `${SOURCE_LABEL} (Report ${REPORT_ID}) — SAMPLE`,
    asOf: iso(pub), asOfLabel: isoToLabel(iso(pub)), reportWindowLabel: windowLabel(iso(start), iso(end)),
    receipts: { current: 7600, lastReported: 4000, lastYear: 6500 },
    feeder: {
      steers: [fc(5, 410, 60), fc(6, 380, 80), fc(7, 365, 50), fc(8, 350, 30)],
      heifers: [fc(4, 465, 20), fc(5, 415, 70), fc(6, 370, 90), fc(7, 345, 40)],
    },
    cullCows: { avgCwt: 186, priceLow: 122, priceHigh: 208, head: 840 },
    slaughterBulls: { avgCwt: 221, priceLow: 182, priceHigh: 254, head: 150 },
    feederComposition: { steersPct: 23, heifersPct: 62, bullsPct: 15 },
    supplyOver600Pct: 75,
    trendText: 'Sample data — feeder cattle demand good; weigh-up cows sold on very good demand.',
  }
}

// ─── Public entrypoint (cached) ──────────────────────────────────────────────────

const cachedLive = unstable_cache(fetchAndParse, ['cattle-market-1778'], {
  revalidate: REVALIDATE_SECONDS,
  tags: ['cattle-market'],
})

export async function getCattleMarket(): Promise<CattleMarket> {
  if (process.env.CATTLE_MARKET_MOCK === '1') return mockMarket()
  return cachedLive()
}
