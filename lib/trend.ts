import type { ResolveResult, MarsPriceRow } from './barn-geo'
import type { HerdEstimate } from './herd-estimate'
import { lotToMarsKey, type Lot } from './herd'

// ─── Trend bundle — "what's moved" ───────────────────────────────────────────────────────
// PURE: the page does the reads (herd_estimate_history via the user-scoped SSR client so the
// owner-SELECT RLS scopes to the caller; mars_price_history via service-role) and passes the
// rows in. Volume + spread are LIVE from the current snapshot (resolved/estimate). Herd-value
// Δ and per-class price Δ ACCRUE from history: each degrades HONESTLY until ≥2 points exist,
// then self-fills — no fake numbers, no $0 deltas, no second build. A read error → 'unavailable'.

// Rows the page reads in.
export interface HerdHistoryRow { snapshot_date: string; total_value: number; lots_priced: number }
export interface PriceHistoryRow { slug_id: string; report_date: string; rows: MarsPriceRow[] }

// Output (serializable → passed to the client panel).
export interface VolumeRow { commodity: string; receipts: number | null; weekAgo: number | null; yearAgo: number | null }
export interface SpreadRow { label: string; min: number; max: number; basis: 'cwt' | 'head' }
export type HerdDelta =
  | { status: 'ready'; abs: number; pct: number | null; sinceDate: string }
  | { status: 'accruing' }
  | { status: 'unavailable' }
export interface PriceDeltaRow { label: string; status: 'ready' | 'accruing' | 'unavailable'; cwt?: number; sinceDate?: string }
export interface TrendData {
  barnName: string | null
  reportDate: string | null
  volume: VolumeRow[]
  spread: SpreadRow[]
  herd: HerdDelta
  priceDeltas: PriceDeltaRow[]
}

const eqi = (a: string | null | undefined, b: string) => (a ?? '').toLowerCase().trim() === b.toLowerCase().trim()

function priceBasis(unit: string | null): 'cwt' | 'head' | null {
  const u = (unit ?? '').toLowerCase()
  if (u.includes('cwt')) return 'cwt'
  if (u.includes('unit') || u.includes('head')) return 'head'
  return null
}

// Representative price for a (commodity, class, weight) within a set of rows — the engine's
// match, simplified: bracket-containing-weight → else head-weighted class average. Same basis
// only (never mixes $/cwt with $/head).
function classPrice(rows: MarsPriceRow[], commodity: string, classes: string[], wLb: number): { price: number; basis: 'cwt' | 'head' } | null {
  const usable = rows.filter(r => eqi(r.commodity, commodity) && classes.some(c => eqi(r.class, c)) && r.avg_price != null && priceBasis(r.price_unit) != null)
  if (!usable.length) return null
  const inBracket = usable.filter(r => r.weight_break_low != null && r.weight_break_high != null && wLb >= r.weight_break_low && wLb <= r.weight_break_high)
  if (inBracket.length) {
    const best = inBracket.slice().sort((a, b) =>
      Math.abs((a.weight_break_low! + a.weight_break_high!) / 2 - wLb) - Math.abs((b.weight_break_low! + b.weight_break_high!) / 2 - wLb))[0]
    return { price: best.avg_price!, basis: priceBasis(best.price_unit)! }
  }
  const cwt = usable.filter(r => priceBasis(r.price_unit) === 'cwt')
  const head = usable.filter(r => priceBasis(r.price_unit) === 'head')
  const group = cwt.length >= head.length ? cwt : head
  const basis: 'cwt' | 'head' = cwt.length >= head.length ? 'cwt' : 'head'
  const totHead = group.reduce((s, r) => s + (r.head_count ?? 0), 0)
  const price = totHead > 0
    ? group.reduce((s, r) => s + r.avg_price! * (r.head_count ?? 0), 0) / totHead
    : group.reduce((s, r) => s + r.avg_price!, 0) / group.length
  return { price: Math.round(price * 100) / 100, basis }
}

export function buildTrend(input: {
  resolved: ResolveResult
  estimate: HerdEstimate
  lots: Lot[]
  herdHistory: HerdHistoryRow[] | null
  priceHistory: PriceHistoryRow[] | null
}): TrendData {
  const { resolved, estimate, lots, herdHistory, priceHistory } = input
  const primary = resolved.local[0] ?? null

  // VOLUME (live) — per commodity at the primary local barn (MARS gives the week/year deltas).
  const volume: VolumeRow[] = []
  if (primary) {
    const seen = new Set<string>()
    for (const r of primary.rows) {
      if (!r.commodity || seen.has(r.commodity)) continue
      seen.add(r.commodity)
      volume.push({ commodity: r.commodity, receipts: r.receipts, weekAgo: r.receipts_week_ago, yearAgo: r.receipts_year_ago })
    }
  }

  // SPREAD (live) — matched-bracket range per priced lot (exact lots carry min/max).
  const spread: SpreadRow[] = []
  for (const l of estimate.perLot) {
    const s = l.source
    if (s && s.avg_price_min != null && s.avg_price_max != null) {
      spread.push({ label: l.label, min: s.avg_price_min, max: s.avg_price_max, basis: s.price_basis })
    }
  }

  // HERD Δ (accruing) — owner-scoped history, newest first. null = read error.
  let herd: HerdDelta
  if (herdHistory == null) herd = { status: 'unavailable' }
  else if (herdHistory.length < 2) herd = { status: 'accruing' }
  else {
    const [cur, prior] = herdHistory
    const abs = cur.total_value - prior.total_value
    herd = { status: 'ready', abs, pct: prior.total_value > 0 ? (abs / prior.total_value) * 100 : null, sinceDate: prior.snapshot_date }
  }

  // PRICE Δ (accruing) — per priced lot, diff the matched class across the barn's 2 latest sale
  // dates. <2 dates → 'accruing'; read error → 'unavailable'; per-head/unmatchable → 'accruing'.
  const priceDeltas: PriceDeltaRow[] = []
  for (const l of estimate.perLot) {
    const s = l.source
    if (!s || !s.commodity || !s.mars_class) continue // unpriced lot
    if (priceHistory == null) { priceDeltas.push({ label: l.label, status: 'unavailable' }); continue }
    const lot = lots.find(x => x.id === l.lotId)
    const wLb = lot ? lotToMarsKey(lot).avgWeightLb : null
    const barnRows = priceHistory.filter(p => p.slug_id === s.slug_id)
    const dates = [...new Set(barnRows.map(p => p.report_date))].sort().reverse()
    if (wLb == null || dates.length < 2) { priceDeltas.push({ label: l.label, status: 'accruing' }); continue }
    const classes = s.mars_class.split('|')
    const latest = classPrice(barnRows.find(p => p.report_date === dates[0])!.rows, s.commodity, classes, wLb)
    const prior = classPrice(barnRows.find(p => p.report_date === dates[1])!.rows, s.commodity, classes, wLb)
    if (latest && prior && latest.basis === 'cwt' && prior.basis === 'cwt') {
      priceDeltas.push({ label: l.label, status: 'ready', cwt: Math.round((latest.price - prior.price) * 100) / 100, sinceDate: dates[1] })
    } else {
      priceDeltas.push({ label: l.label, status: 'accruing' })
    }
  }

  return { barnName: primary?.barn_name ?? null, reportDate: primary?.report_date ?? null, volume, spread, herd, priceDeltas }
}
