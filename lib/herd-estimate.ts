import { lotToMarsKey, LOT_CLASS_LABELS, lotLabel as lotName, type Lot, type LotClass } from './herd'
import type { ResolveResult, RankedBarn, MarsPriceRow, ResolveTier } from './barn-resolver'
import { isThin } from './market-scope'

// ─── HerdEstimate engine ─────────────────────────────────────────────────────────────
// PURE: takes a Herd's lots + the resolver's tiered barns (each carrying its priced rows) and
// produces a per-lot + total herd value. No I/O — unit-testable on its own (type-only import
// of the resolver, so it doesn't pull the service-role client).
//
// Three mapping decisions (logged in the MARS recon) handled here:
//  (a) price_unit branching — Per Cwt: value = avg_price × (avg_weight_lb / 100) × head;
//      Per Unit (per head): value = avg_price × head. NEVER multiply a per-head price by cwt
//      (the bug the dry-run caught — a $2100 "per unit" heifer is per head, not $/cwt).
//  (b) Replacement Cattle — breeding 'cows' value off Replacement (Stock/Bred Cows) when
//      present, falling to the Slaughter Cows floor; 'old_cows' (cull) → Slaughter Cows;
//      'bulls' → Slaughter Bulls.
//  (c) Frame match — MARS uses combined frames ("Small and Medium", "Medium and Large"), so
//      match by contains (either direction), not exact; an N/A frame (slaughter/replacement)
//      matches anything. No exact frame+bracket match → fall back to the class-level average
//      for that commodity (over its dominant price basis), flagged honestly.
//
// HONEST DEGRADATION: a lot with no fresh local barn / no matching row is UNPRICED (value null
// + reason) — never 0, never faked. The total sums only priced lots, with an "X of Y priced"
// note. Lots price off LOCAL barns only; nearest-comp / regional-only tiers leave lots unpriced
// with the comp named — a confident value off a barn ~350mi away would misrepresent basis.
// (Flagged for review: we could instead surface a clearly-labeled "comparable" value.)
//
// NOTE: MARS lot_desc here is condition (Fleshy / Light Weight / Return to Feed), NOT a weaned
// flag, so weaning is not used in matching (a future refinement if a weaned signal appears).

// Ordered commodity/class preference per lot class (decision b). First commodity with any
// usable row wins; `classes` are the MARS `class` values acceptable under that commodity.
const MATCH_STRATEGY: Record<LotClass, Array<{ commodity: string; classes: string[] }>> = {
  steers:    [{ commodity: 'Feeder Cattle', classes: ['Steers'] }],
  heifers:   [{ commodity: 'Feeder Cattle', classes: ['Heifers'] }],
  yearlings: [{ commodity: 'Feeder Cattle', classes: ['Steers'] }],
  cows:      [{ commodity: 'Replacement Cattle', classes: ['Stock Cows', 'Bred Cows'] },
              { commodity: 'Slaughter Cattle',   classes: ['Cows'] }],
  old_cows:  [{ commodity: 'Slaughter Cattle',   classes: ['Cows'] }],
  bulls:     [{ commodity: 'Slaughter Cattle',   classes: ['Bulls'] }],
}

type PriceBasis = 'cwt' | 'head'

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const eqi = (a: string | null | undefined, b: string) => norm(a) === norm(b)

// Contains-match (decision c). N/A / empty MARS frame matches any lot frame.
function frameMatch(lotFrame: string, marsFrame: string | null): boolean {
  const mf = norm(marsFrame)
  if (mf === '' || mf === 'n/a') return true
  const lf = norm(lotFrame)
  return mf.includes(lf) || lf.includes(mf)
}

// 'Per Cwt' → cwt, 'Per Unit'/'Per Head' → head, anything else → null (unusable: never guess).
function priceBasis(unit: string | null): PriceBasis | null {
  const u = norm(unit)
  if (/cwt/.test(u)) return 'cwt'
  if (/unit|head/.test(u)) return 'head'
  return null
}

function valueOf(basis: PriceBasis, price: number, weightLb: number, headCount: number): number {
  return Math.round(basis === 'cwt' ? price * (weightLb / 100) * headCount : price * headCount)
}

export interface ValuationSource {
  slug_id: string
  barn_name: string
  town: string
  miles: number
  report_date: string
  commodity: string | null    // MARS commodity of the matched row (for Trend's price-Δ join)
  mars_class: string | null    // MARS class ('|' joined for the class-avg path)
  matched: string        // "Feeder Cattle / Steers / Medium and Large / 550-600 brk" or "… class avg"
  price_unit: string | null
  price_basis: PriceBasis
  avg_price: number      // matched $/cwt or $/head (class-avg rounded to cents)
  avg_price_min: number | null // matched-bracket range (Trend's price spread); null on the class-avg path
  avg_price_max: number | null
  exact_bracket: boolean
  // Block 2.5 A3/A5 — the evidence behind the figure, and whether it is a
  // CULL (slaughter) price. A rancher's bulls and cows priced off Slaughter
  // Cattle rows are salvage value, never breeding value; the label says so.
  head_count: number | null      // reported head behind the matched row (class-avg path: summed)
  cull: boolean
}

export interface LotValuation {
  lotId: string
  label: string          // "Steers · 300 head · 590 lb"
  value: number | null   // dollars; null = unpriced
  reason: string | null  // unpriced reason, or a note when priced via class-avg fallback; null when exact
  source: ValuationSource | null
  // Block 2.5 — the lot's own facts, for the sensitivity line (exact arithmetic).
  head_count: number
  avg_weight_lb: number
  thin: boolean          // priced off fewer reported head than THIN_HEAD_THRESHOLD → range, not a figure
  value_low: number | null   // thin lots: the reported price range applied to the lot
  value_high: number | null
}

export interface HerdEstimate {
  perLot: LotValuation[]
  total_priced: number       // sum over priced lots that are NOT thin
  lots_priced: number        // priced lots, thin or not
  lots_thin: number          // of those, priced off a thin reference (excluded from total_priced)
  thin_range: { low: number; high: number } | null   // the thin lots' combined range
  lots_total: number
  tier: ResolveTier
  as_of: string | null
  county_name: string | null
  note: string
}

// The lot's display line: its name (lib/herd lotLabel — the producer's name,
// else the class label) plus the head and weight that price it.
function lotLabel(lot: Lot): string {
  return `${lotName(lot)} · ${lot.head_count} head · ${lot.avg_weight} ${lot.weight_unit}`
}

interface Match { value: number; source: ValuationSource; exact: boolean }

// Best match for a lot across the pricing barns: exact (frame contains + weight bracket) first,
// else the class-level average over the commodity's dominant basis. null = no usable row.
function matchLot(lot: Lot, barns: RankedBarn[]): Match | null {
  const w = lotToMarsKey(lot).avgWeightLb // unit-normalized to lb (handles cwt entry)

  for (const step of MATCH_STRATEGY[lot.class]) {
    const usable: Array<{ row: MarsPriceRow; barn: RankedBarn; basis: PriceBasis }> = []
    for (const barn of barns) {
      for (const row of barn.rows) {
        if (!eqi(row.commodity, step.commodity)) continue
        if (!step.classes.some(c => eqi(row.class, c))) continue
        if (row.avg_price == null) continue
        const basis = priceBasis(row.price_unit)
        if (!basis) continue
        usable.push({ row, barn, basis })
      }
    }
    if (usable.length === 0) continue

    // EXACT — frame contains-match AND weight bracket contains w.
    const exact = usable.filter(u => {
      const lo = u.row.weight_break_low, hi = u.row.weight_break_high
      return frameMatch(lot.frame, u.row.frame) && lo != null && hi != null && w >= lo && w <= hi
    })
    if (exact.length) {
      exact.sort((a, b) => {
        const am = (a.row.weight_break_low! + a.row.weight_break_high!) / 2
        const bm = (b.row.weight_break_low! + b.row.weight_break_high!) / 2
        return Math.abs(am - w) - Math.abs(bm - w)
          || b.barn.report_date.localeCompare(a.barn.report_date)
          || (b.row.head_count ?? 0) - (a.row.head_count ?? 0)
      })
      const { row, barn, basis } = exact[0]
      return {
        value: valueOf(basis, row.avg_price!, w, lot.head_count),
        exact: true,
        source: {
          slug_id: barn.slug_id, barn_name: barn.barn_name, town: barn.town, miles: barn.miles,
          report_date: barn.report_date,
          commodity: row.commodity, mars_class: row.class,
          matched: `${row.commodity} / ${row.class} / ${row.frame ?? 'N/A'} / ${row.weight_break_low}-${row.weight_break_high} brk`,
          price_unit: row.price_unit, price_basis: basis, avg_price: row.avg_price!,
          avg_price_min: row.avg_price_min, avg_price_max: row.avg_price_max, exact_bracket: true,
          head_count: row.head_count, cull: eqi(row.commodity, 'Slaughter Cattle'),
        },
      }
    }

    // FALLBACK — class-level average over the dominant basis (never mix $/cwt with $/head).
    const cwt = usable.filter(u => u.basis === 'cwt')
    const head = usable.filter(u => u.basis === 'head')
    const group = cwt.length >= head.length ? cwt : head
    const basis: PriceBasis = cwt.length >= head.length ? 'cwt' : 'head'
    const totHead = group.reduce((s, u) => s + (u.row.head_count ?? 0), 0)
    const avgPrice = totHead > 0
      ? group.reduce((s, u) => s + u.row.avg_price! * (u.row.head_count ?? 0), 0) / totHead
      : group.reduce((s, u) => s + u.row.avg_price!, 0) / group.length
    const barn = group.slice().sort((a, b) => b.barn.report_date.localeCompare(a.barn.report_date))[0].barn
    const price = Math.round(avgPrice * 100) / 100
    return {
      value: valueOf(basis, price, w, lot.head_count),
      exact: false,
      source: {
        slug_id: barn.slug_id, barn_name: barn.barn_name, town: barn.town, miles: barn.miles,
        report_date: barn.report_date,
        commodity: step.commodity, mars_class: step.classes.join('|'),
        matched: `${step.commodity} / ${step.classes.join('|')} / class avg $/${basis} (${group.length} rows, no exact bracket)`,
        price_unit: basis === 'cwt' ? 'Per Cwt (class avg)' : 'Per Unit (class avg)',
        price_basis: basis, avg_price: price,
        avg_price_min: null, avg_price_max: null, exact_bracket: false,
        head_count: totHead > 0 ? totHead : null, cull: eqi(step.commodity, 'Slaughter Cattle'),
      },
    }
  }
  return null
}

export function estimateHerd(herd: { lots: Lot[] }, resolved: ResolveResult): HerdEstimate {
  const lots = herd.lots ?? []
  const pricingBarns = resolved.local // LOCAL barns only (honest basis)
  const perLot: LotValuation[] = []

  for (const lot of lots) {
    const label = lotLabel(lot)
    const wLb = lotToMarsKey(lot).avgWeightLb
    if (pricingBarns.length === 0) {
      const reason = resolved.tier === 'nearest-comp' && resolved.nearest_comp
        ? `No fresh auction in haul range — nearest comparable ${resolved.nearest_comp.town} ~${resolved.nearest_comp.miles}mi`
        : 'No fresh nearby auction'
      perLot.push({ lotId: lot.id, label, value: null, reason, source: null, head_count: lot.head_count, avg_weight_lb: wLb, thin: false, value_low: null, value_high: null })
      continue
    }
    const m = matchLot(lot, pricingBarns)
    if (!m) {
      perLot.push({
        lotId: lot.id, label, value: null,
        reason: `No ${LOT_CLASS_LABELS[lot.class]} price row at ${pricingBarns[0].town} this week`,
        source: null, head_count: lot.head_count, avg_weight_lb: wLb, thin: false, value_low: null, value_high: null,
      })
      continue
    }
    // Thin reference (Block 2.5 A3): the figure is withheld; the reported range is applied to the lot instead.
    const thin = isThin(m.source.head_count)
    const lo = m.source.avg_price_min ?? m.source.avg_price
    const hi = m.source.avg_price_max ?? m.source.avg_price
    perLot.push({
      lotId: lot.id, label, value: m.value,
      reason: m.exact ? null : 'class average — no exact frame/weight bracket this week',
      source: m.source, head_count: lot.head_count, avg_weight_lb: wLb, thin,
      value_low: thin ? valueOf(m.source.price_basis, lo, wLb, lot.head_count) : null,
      value_high: thin ? valueOf(m.source.price_basis, hi, wLb, lot.head_count) : null,
    })
  }

  const priced = perLot.filter(l => l.value != null)
  const firm = priced.filter(l => !l.thin)
  const thinLots = priced.filter(l => l.thin)
  const total_priced = firm.reduce((s, l) => s + (l.value ?? 0), 0)
  const thin_range = thinLots.length
    ? { low: thinLots.reduce((s, l) => s + (l.value_low ?? 0), 0), high: thinLots.reduce((s, l) => s + (l.value_high ?? 0), 0) }
    : null
  const as_of = priced.map(l => l.source!.report_date).filter(Boolean).sort().at(-1) ?? null
  const lots_priced = priced.length
  const lots_total = lots.length

  let note: string
  if (lots_total === 0) {
    note = 'No lots entered yet.'
  } else if (lots_priced === 0) {
    note = `0 of ${lots_total} lot${lots_total > 1 ? 's' : ''} priced — ${perLot[0]?.reason ?? 'no fresh nearby auction'}.`
  } else {
    const towns = [...new Set(priced.map(l => l.source!.town))].join(', ')
    note = `${lots_priced} of ${lots_total} lot${lots_total > 1 ? 's' : ''} priced off ${towns}${as_of ? ` (as of ${as_of})` : ''}.`
  }

  return { perLot, total_priced, lots_priced, lots_thin: thinLots.length, thin_range, lots_total, tier: resolved.tier, as_of, county_name: resolved.county_name, note }
}
