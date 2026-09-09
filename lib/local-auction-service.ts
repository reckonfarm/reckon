import 'server-only'

import { createServiceClient } from './supabase'
import { resolveBarns, DISCOVERY_RADIUS_MI, type MarsPriceRow, type RankedBarn, type ResolveResult } from './barn-resolver'
import { cullGrade } from './market-scope'

// ─── Local auction read (Markets view) ───────────────────────────────────────────
//
// County-scoped read of the EXISTING mars_price_snapshots barns (zero new ingestion):
// nearest fresh barn to the selected county via resolveBarns, steer prices by weight
// band, receipts, and week-over-week deltas from mars_price_history. Pure Supabase
// reads at render — no external fetch, nothing to time out.
//
// HONEST RESULT (discriminated, never fabricate):
//   • { status: 'ok', ... }          → a fresh barn priced cattle; beyondHaul=true means
//                                      the nearest FRESH barn is outside DISCOVERY_RADIUS_MI
//                                      (a regional reference, never labeled nearby)
//                                      (shown with its real distance, labeled).
//   • { status: 'no_recent_sale' }   → barns exist but none has a fresh sale (Montana
//                                      summer schedules) — last sale date shown, never
//                                      a stale price passed off as current.
//   • { status: 'no_coverage' }      → genuine absence: no reporting barn near this
//                                      county (or none seeded yet). NOT an outage.
//   • { status: 'data_unavailable' } → a read failed — never a fabricated price.

export interface BandRead {
  band: string           // '400' | '500' | '600' | '700' (lbs, low edge)
  avgPrice: number       // head-weighted $/cwt
  priceLow: number | null
  priceHigh: number | null
  head: number
  wowPct: number | null  // vs the same band at this barn's PRIOR sale; null = no prior
}

// One class' weight-band read (feeder steers / heifers / feeder bulls) — head-weighted
// $/cwt inside a 100-lb band, with the evidence behind it.
export interface ClassBands {
  label: string          // 'Steers' | 'Heifers' | 'Feeder bulls'
  bands: BandRead[]
}
// One cull line — Slaughter Cattle rows kept DISTINCT by grade (cows) or yield grade
// (bulls), never blended into a "cow price". Weight basis and dressing travel with it.
export interface CullRead {
  grade: string          // 'Breaker' | 'Boner' | 'Lean' | 'Other' (cows) · yield grade or 'All' (bulls)
  dressing: string | null
  avgWeight: number | null
  avgPrice: number       // head-weighted $/cwt
  priceLow: number | null
  priceHigh: number | null
  head: number
  rows: number
  gradeKnown: boolean    // false when the captured rows predate the grade fields (before 2026-09-05)
}
export interface LocalAuctionRead {
  status: 'ok'
  slugId: string         // the MARS report id — the citable source
  barnName: string
  town: string
  miles: number
  beyondHaul: boolean
  pinned: boolean        // the person's "where I sell" barn, not the nearest
  saleDate: string       // ISO
  bands: BandRead[]      // feeder steers (the existing read)
  classes: ClassBands[]  // heifers, feeder bulls — same band logic, kept apart
  cullCows: CullRead[]
  slaughterBulls: CullRead[]
  receipts: number | null
  receiptsCommodity: string | null   // 6I: the report the receipts figure comes from (one commodity's receipts, not the sale's)
  receiptsWeekAgo: number | null
  receiptsYearAgo: number | null
}

export type LocalAuctionResult =
  | LocalAuctionRead
  | { status: 'no_recent_sale'; barnName: string; town: string; lastSale: string }
  | { status: 'no_coverage' }
  | { status: 'data_unavailable' }

// Head-weighted steer averages per weight band — the index-consistent spec (Feeder
// Cattle · Steers · Medium and Large frame · muscle grade 1 · Per Cwt, which also
// excludes per-head bred/pair lots). Same filter the national OKC parse uses.
const BANDS = ['400', '500', '600', '700'] as const

function bandOf(w: number | null): string | null {
  if (w == null) return null
  const h = Math.floor(w / 100) * 100
  return h >= 400 && h <= 700 ? String(h) : null
}

function bandAverages(rows: MarsPriceRow[], cls: string = 'Steers'): Map<string, { avg: number; lo: number | null; hi: number | null; head: number }> {
  interface Acc { wsum: number; head: number; lo: number; hi: number }
  const acc = new Map<string, Acc>()
  for (const r of rows) {
    if (r.commodity !== 'Feeder Cattle' || r.class !== cls) continue
    if (r.price_unit !== 'Per Cwt') continue
    if (!/medium and large/i.test(r.frame ?? '')) continue
    const band = bandOf(r.avg_weight)
    if (!band || r.avg_price == null) continue
    const head = r.head_count ?? 0
    if (head <= 0) continue
    const a = acc.get(band) ?? { wsum: 0, head: 0, lo: Infinity, hi: -Infinity }
    a.wsum += r.avg_price * head; a.head += head
    a.lo = Math.min(a.lo, r.avg_price_min ?? r.avg_price)
    a.hi = Math.max(a.hi, r.avg_price_max ?? r.avg_price)
    acc.set(band, a)
  }
  const out = new Map<string, { avg: number; lo: number | null; hi: number | null; head: number }>()
  for (const [band, a] of acc) {
    out.set(band, {
      avg: Math.round((a.wsum / a.head) * 100) / 100,
      lo: a.lo === Infinity ? null : a.lo,
      hi: a.hi === -Infinity ? null : a.hi,
      head: a.head,
    })
  }
  return out
}

// `preResolved` (views2, commit 2): the Markets body resolves the county's
// barns once and hands the same result here and to the herd anchor when the
// county in view is the home county — one resolution per render, not two.
// Slaughter Cattle rows → one line per grade (cows) / yield grade (bulls), head-weighted.
function cullReads(rows: MarsPriceRow[], cls: 'Cows' | 'Bulls'): CullRead[] {
  interface Acc { wsum: number; head: number; rows: number; lo: number; hi: number; wt: number; wtHead: number; dressing: Set<string>; known: boolean }
  const acc = new Map<string, Acc>()
  for (const r of rows) {
    if (r.commodity !== 'Slaughter Cattle' || r.class !== cls) continue
    if (r.price_unit !== 'Per Cwt' || r.avg_price == null) continue
    const head = r.head_count ?? 0
    if (head <= 0) continue
    const known = cls === 'Cows' ? r.quality_grade !== undefined : r.yield_grade !== undefined
    const grade = cls === 'Cows' ? cullGrade(r.quality_grade) : (r.yield_grade ?? 'All')
    const a = acc.get(grade) ?? { wsum: 0, head: 0, rows: 0, lo: Infinity, hi: -Infinity, wt: 0, wtHead: 0, dressing: new Set<string>(), known }
    a.wsum += r.avg_price * head; a.head += head; a.rows++
    a.lo = Math.min(a.lo, r.avg_price_min ?? r.avg_price); a.hi = Math.max(a.hi, r.avg_price_max ?? r.avg_price)
    if (r.avg_weight != null) { a.wt += r.avg_weight * head; a.wtHead += head }
    if (r.dressing) a.dressing.add(r.dressing)
    acc.set(grade, a)
  }
  const order = ['Breaker', 'Boner', 'Lean', 'Other']
  return [...acc.entries()]
    .sort((x, y) => (order.indexOf(x[0]) === -1 ? 99 : order.indexOf(x[0])) - (order.indexOf(y[0]) === -1 ? 99 : order.indexOf(y[0])) || x[0].localeCompare(y[0]))
    .map(([grade, a]) => ({
      grade,
      dressing: a.dressing.size === 1 ? [...a.dressing][0] : a.dressing.size > 1 ? 'Mixed' : null,
      avgWeight: a.wtHead > 0 ? Math.round(a.wt / a.wtHead) : null,
      avgPrice: Math.round((a.wsum / a.head) * 100) / 100,
      priceLow: a.lo === Infinity ? null : a.lo,
      priceHigh: a.hi === -Infinity ? null : a.hi,
      head: a.head,
      rows: a.rows,
      gradeKnown: a.known,
    }))
}

function classBands(rows: MarsPriceRow[], cls: string, label: string): ClassBands | null {
  const m = bandAverages(rows, cls)
  const bands: BandRead[] = []
  for (const band of BANDS) {
    const c = m.get(band)
    if (c) bands.push({ band, avgPrice: c.avg, priceLow: c.lo, priceHigh: c.hi, head: c.head, wowPct: null })
  }
  return bands.length ? { label, bands } : null
}

export async function getLocalAuctionRead(countyFips: string, preResolved?: ResolveResult): Promise<LocalAuctionResult> {
  try {
    const resolved = preResolved ?? await resolveBarns(countyFips)

    // The resolver never throws — it degrades to regional-only with a summary string.
    // Distinguish its two known failure summaries (outage) from genuine absence so an
    // outage never masquerades as "no coverage". (String match is deliberate: extending
    // the resolver's type would touch the HerdEstimate's blast radius for a cosmetic
    // distinction between two calm one-line states.)
    if (resolved.tier === 'regional-only' && /read failed/i.test(resolved.summary)) {
      return { status: 'data_unavailable' }
    }

    // Block 2.6A: a fresh barn beyond the discovery radius is offered as a REGIONAL
    // REFERENCE at any distance (beyondHaul=true → the card says no auction is within
    // the radius and labels the reference with its state and ~miles, never "Nearby").
    // The old 300-mile cap let the card say "no coverage" while the history chart,
    // fed by the same resolver, labeled the same far barn "Nearby" on the same page.
    const barn: RankedBarn | null = resolved.local[0] ?? resolved.nearest_comp
    if (!barn) {
      // No FRESH barn anywhere. If a stale barn exists WITHIN the discovery radius this
      // is the honest summer-gap state (last sale shown); a far-away stale barn is still
      // no_coverage — "no recent sale at Miles City" is nonsense for a Georgia county.
      const staleBarn = resolved.stale.find(b => b.miles <= DISCOVERY_RADIUS_MI) ?? null
      if (staleBarn) {
        return { status: 'no_recent_sale', barnName: staleBarn.barn_name, town: staleBarn.town, lastSale: staleBarn.report_date }
      }
      return { status: 'no_coverage' }
    }

    // Week-over-week: the same barn's PRIOR sale from mars_price_history.
    let priorBands: ReturnType<typeof bandAverages> | null = null
    try {
      const db = createServiceClient()
      const { data } = await db
        .from('mars_price_history')
        .select('report_date, rows')
        .eq('slug_id', barn.slug_id)
        .lt('report_date', barn.report_date)
        .order('report_date', { ascending: false })
        .limit(1)
      const prior = (data ?? [])[0] as { report_date: string; rows: MarsPriceRow[] } | undefined
      if (prior?.rows) priorBands = bandAverages(prior.rows)
    } catch {
      priorBands = null // deltas degrade to null; current prices still render
    }

    const current = bandAverages(barn.rows)
    const bands: BandRead[] = []
    for (const band of BANDS) {
      const c = current.get(band)
      if (!c) continue
      const p = priorBands?.get(band) ?? null
      bands.push({
        band,
        avgPrice: c.avg,
        priceLow: c.lo,
        priceHigh: c.hi,
        head: c.head,
        wowPct: p ? Math.round(((c.avg - p.avg) / p.avg) * 1000) / 10 : null,
      })
    }
    if (bands.length === 0) {
      // A fresh report with no index-spec steer rows (e.g. a bred-stock special) —
      // honest absence of comparable prices, not an outage.
      return { status: 'no_recent_sale', barnName: barn.barn_name, town: barn.town, lastSale: barn.report_date }
    }

    // Receipts come row-level on the snapshot (same value across rows) — first hit wins.
    const withReceipts = barn.rows.find(r => r.receipts != null)
    const classes = [classBands(barn.rows, 'Heifers', 'Heifers'), classBands(barn.rows, 'Bulls', 'Feeder bulls')]
      .filter((c): c is ClassBands => c !== null)
    return {
      status: 'ok',
      slugId: barn.slug_id,
      barnName: barn.barn_name,
      town: barn.town,
      miles: barn.miles,
      beyondHaul: resolved.local.length === 0,
      pinned: !!resolved.pinned && resolved.pinned === barn.slug_id,
      saleDate: barn.report_date,
      bands,
      classes,
      cullCows: cullReads(barn.rows, 'Cows'),
      slaughterBulls: cullReads(barn.rows, 'Bulls'),
      receipts: withReceipts?.receipts ?? null,
      receiptsCommodity: withReceipts?.commodity ?? null,
      receiptsWeekAgo: withReceipts?.receipts_week_ago ?? null,
      receiptsYearAgo: withReceipts?.receipts_year_ago ?? null,
    }
  } catch (err) {
    console.error('[local-auction] read threw:', err)
    return { status: 'data_unavailable' }
  }
}
