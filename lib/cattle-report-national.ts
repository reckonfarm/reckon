// ─── National Feeder & Stocker Cattle Summary parser (PURE — no Next deps) ────────
//
// USDA AMS "National Weekly Feeder & Stocker Cattle Summary" (lswnfss), St. Joseph
// MO. Parsed the SAME decoupled way as Montana: fetched OFF Vercel (GitHub Action)
// and stored as a Supabase snapshot under a distinct slug. CME stripped.
//
// IMPORTANT (as of 2026): USDA discontinued this PDF after Apr 13, 2026, replacing
// it with a key-gated mymarketnews "National Feeder & Stocker Cattle Dashboard".
// So this slug currently yields the final published PDF (week ending 04/04/26) —
// the read path's freshness/staleness handling labels it honestly with its real
// as-of date. When the dashboard/MARS feed is wired, swap this source out.
//
// Shape: REGIONAL weighted-average FEEDER STEER prices (North Central / South
// Central / Southeast) by weight class, with This-Week / Last-Week / Last-Year
// columns. We aggregate the regions into a single NATIONAL average per weight
// class. No heifer table and no cull cows in this report → those are empty/null.

import { pdfToLines, isoToLabel, cwtLabel, windowLabel, type CattleMarket, type FeederClass, type CattleReceipts } from './cattle-report-1778'

export const NATIONAL_SLUG = 'national-feeder-stocker' as const
export const NATIONAL_URL = 'https://www.ams.usda.gov/mnreports/lswnfss.pdf'
const SOURCE_LABEL = 'USDA AMS Market News — National Feeder & Stocker Cattle Summary'
const TIMEOUT_MS = 20000
const UA = 'Dryline/1.0 (+reckonfarm.com)'

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

// "April 6, 2026" → "2026-04-06"
function longDateToIso(month: string, day: string, year: string): string | null {
  const mm = MONTHS[month.toLowerCase()]
  if (!mm) return null
  return `${year}-${mm}-${day.padStart(2, '0')}`
}

// "04/04/26" → "2026-04-04"
function shortDateToIso(mdy: string): string | null {
  const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (!m) return null
  return `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Feeder/stocker national report quotes CME, fed-cattle, boxed beef, slaughter —
// strip all of it; keep auction feeder commentary only.
const CME_SENTENCE = /\bCME\b|futures|boxed beef|cattle slaughter|fed cattle|dressed|negotiated|choice|select closed|complex|index|slaughter under federal/i

type Parsed = Omit<CattleMarket, 'status' | 'mode' | 'stale' | 'reportId' | 'source'>

function parseNational(lines: string[]): Parsed {
  // ── Steer prices by weight band, aggregated across regions ──────────────────
  const ROW = /(\d{3})-(\d{3}) lbs\s+\$([\d.]+)/  // first $ = This Week
  const by = new Map<number, { sum: number; n: number; lo: number; hi: number }>()
  for (const l of lines) {
    const m = l.match(ROW)
    if (!m) continue
    const lo = +m[1], price = parseFloat(m[3])
    if (!Number.isFinite(price)) continue
    const h = Math.floor(lo / 100) // 400-500 → 4
    const b = by.get(h) ?? { sum: 0, n: 0, lo: Infinity, hi: -Infinity }
    b.sum += price; b.n += 1; b.lo = Math.min(b.lo, price); b.hi = Math.max(b.hi, price)
    by.set(h, b)
  }
  const steers: FeederClass[] = [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, b]) => ({
      weightClass: `${h}-${h + 1}`,
      label: cwtLabel(h),
      midWeight: h * 100 + 50,
      avgCwt: round2(b.sum / b.n),
      priceLow: round2(b.lo),
      priceHigh: round2(b.hi),
      head: 0,            // national report carries no per-class head count
      avgWeight: h * 100 + 50,
    }))

  // ── Meta ────────────────────────────────────────────────────────────────────
  let asOf: string | null = null
  let reportWeekStart: string | null = null
  let reportWeekEnd: string | null = null
  for (const l of lines) {
    if (!asOf) {
      const d = l.match(/\b([A-Z][a-z]+) (\d{1,2}), (\d{4})\b/)
      if (d) asOf = longDateToIso(d[1], d[2], d[3])
    }
    if (!reportWeekEnd) {
      const w = l.match(/w\/e\s+\w+,?\s+(\d{1,2}\/\d{1,2}\/\d{2})/)
      if (w) {
        reportWeekEnd = shortDateToIso(w[1])
        if (reportWeekEnd) reportWeekStart = addDaysIso(reportWeekEnd, -6)
      }
    }
  }
  const reportWindowLabel = reportWeekStart && reportWeekEnd ? windowLabel(reportWeekStart, reportWeekEnd) : null

  // Receipts: first line carrying three comma-grouped numbers (This/Last/YearAgo).
  const receipts: CattleReceipts = { current: null, lastReported: null, lastYear: null }
  for (const l of lines) {
    const nums = l.match(/\b\d{1,3}(?:,\d{3})+\b/g)
    if (nums && nums.length >= 3 && /receipt|LS\d|SJ_/i.test(l + ' ' + (lines[lines.indexOf(l) - 1] ?? ''))) {
      const toInt = (s: string) => parseInt(s.replace(/,/g, ''), 10)
      receipts.current = toInt(nums[0]); receipts.lastReported = toInt(nums[1]); receipts.lastYear = toInt(nums[2])
      break
    }
  }
  // Fallback: the SJ_LS850 receipts line specifically.
  if (receipts.current == null) {
    const rl = lines.find(l => /SJ_LS\d+/.test(l))
    const nums = rl?.match(/\b\d{1,3}(?:,\d{3})+\b/g)
    if (nums && nums.length >= 3) {
      const toInt = (s: string) => parseInt(s.replace(/,/g, ''), 10)
      receipts.current = toInt(nums[0]); receipts.lastReported = toInt(nums[1]); receipts.lastYear = toInt(nums[2])
    }
  }

  const over = lines.find(l => /percent weighing over 600/.test(l))
  const supplyOver600Pct = over?.match(/(\d+) percent weighing over 600/)?.[1] != null
    ? +over.match(/(\d+) percent weighing over 600/)![1] : null
  const heiferPct = over?.match(/and (\d+) percent heifers/)?.[1] != null
    ? +over.match(/and (\d+) percent heifers/)![1] : null

  // Trend ("Compared to last week …"), CME/fed-cattle sentences removed. The PDF
  // interleaves the CME-index chart's Y-axis labels ($360 $340 …) into the
  // narrative lines, so strip standalone whole-dollar chart tokens first (prose
  // prices are written without a $ sign, e.g. "2.00 to 8.00 higher").
  let trendText: string | null = null
  const cmpIdx = lines.findIndex(l => /Compared to last week/.test(l))
  if (cmpIdx >= 0) {
    const para = lines.slice(cmpIdx, cmpIdx + 20).join(' ')
      .replace(/\$\d{2,3}(?:\.\d+)?\b/g, ' ')      // chart-axis $ labels
      .replace(/\b(?:[A-Z] ){3,}[A-Z]\b/g, ' ')    // chart month-axis (J F M A M …)
      .replace(/\s+/g, ' ')
    const cut = para.slice(0, para.search(/REGIONAL WEIGHTED|More\.{2,}|NATIONWIDE|$/))
    const sentences = cut.split(/(?<=\.)\s+/).map(s => s.trim()).filter(Boolean)
    const cash = sentences.filter(s => s.length > 8 && !CME_SENTENCE.test(s))
    // The lead sentence is the clean, valuable trend headline; later narrative in
    // this chart-heavy PDF is unreliable to extract, so keep just the lead.
    trendText = cash[0] ?? null
  }

  return {
    asOf,
    asOfLabel: asOf ? isoToLabel(asOf) : null,
    reportWindowLabel,
    reportWeekStart,
    reportWeekEnd,
    receipts,
    feeder: { steers, heifers: [] }, // report has no heifer price table
    cullCows: null,
    slaughterBulls: null,
    feederComposition: { steersPct: heiferPct != null ? 100 - heiferPct : null, heifersPct: heiferPct, bullsPct: null },
    supplyOver600Pct,
    trendText,
  }
}

export async function fetchAndParseNational(): Promise<CattleMarket> {
  const base = { mode: 'live' as const, stale: false, reportId: '1778' as const, source: SOURCE_LABEL }
  const unavailable: CattleMarket = {
    ...base, status: 'data_unavailable',
    asOf: null, asOfLabel: null, reportWindowLabel: null, reportWeekStart: null, reportWeekEnd: null,
    receipts: { current: null, lastReported: null, lastYear: null },
    feeder: { steers: [], heifers: [] }, cullCows: null, slaughterBulls: null,
    feederComposition: { steersPct: null, heifersPct: null, bullsPct: null },
    supplyOver600Pct: null, trendText: null,
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(NATIONAL_URL, { signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'application/pdf' } })
    if (!res.ok) throw new Error(`national ${res.status}`)
    const buf = await res.arrayBuffer()
    const lines = await pdfToLines(buf)
    const parsed = parseNational(lines)
    if (parsed.asOf == null || parsed.feeder.steers.length === 0) throw new Error('national parsed empty')
    return { ...base, status: 'ok', ...parsed }
  } catch (err) {
    console.error('[cattle-national] fetch/parse failed:', err)
    return unavailable
  } finally {
    clearTimeout(timeout)
  }
}
