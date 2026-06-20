import { lotToLrpType, LOT_CLASS_LABELS, type Lot } from './herd'
import type { LrpMatrixResult, LrpLadderRung } from './lrp-service'

// ─── Outlook bundle — "the forward floor per lot" ─────────────────────────────────────────
// PURE: the page reads the LRP matrix (getLrpMatrix, service-role) and passes it in; this maps
// each lot → its LRP type (lotToLrpType) → the matrix floor, auto-picking the endorsement length
// nearest the lot's persisted sale window. DISPLAY-ONLY (Build 2): no writes, no persistence —
// the capture table + an interactive (saved) picker are Build 3. Type-only LRP import so this
// stays isomorphic (no 'server-only' at runtime) and unit-testable.
//
// HONEST DEGRADATION mirrors Now/Trend: breeding/cull + out-of-range lots are 'not_eligible'
// with the real reason (never a fake floor); a stale type shows "last priced {date}", never a
// stale price as current; the whole matrix down → status:'unavailable' (the panel shows one
// honest line). The shown floor is the 100%-coverage REFERENCE floor (CME national index) — the
// caveat lives in the panel, not the data.

export interface OutlookFloor {
  coverage_price:           number   // $/cwt — the 100%-coverage reference floor
  endorsement_length_weeks: number
  endorsement_end_date:     string   // raw 'MM/DD/YYYY' (panel formats)
  producer_premium_per_cwt: number
  matchedWindow:            string | null   // 'YYYY-MM' the floor matched, or null = default (no sale window)
}

export interface OutlookLot {
  lotId:          string
  label:          string   // "Steers · 300 head · 590 lb"
  state:          'priced' | 'stale' | 'unavailable' | 'not_eligible'
  lrpType?:       string   // "Steers Weight 2" (when eligible)
  reason?:        string   // not-eligible reason (verbatim from lotToLrpType)
  floor?:         OutlookFloor          // when state === 'priced'
  effective_date?: string  // 'priced' (as-of) and 'stale' (last priced)
}

export interface OutlookData {
  status: 'ok' | 'unavailable'   // 'unavailable' = whole matrix down
  lots:   OutlookLot[]
  as_of:  string | null          // newest effective_date across priced lots
  source: string                 // 'USDA RMA'
}

const SOURCE = 'USDA RMA'

function lotLabel(lot: Lot): string {
  return `${LOT_CLASS_LABELS[lot.class]} · ${lot.head_count} head · ${lot.avg_weight} ${lot.weight_unit}`
}

// raw 'MM/DD/YYYY' → epoch ms (null if unparseable → that rung is ignored, never NaN-sorted).
function usDateMs(v: string): number | null {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const ms = Date.parse(`${m[3]}-${m[1]}-${m[2]}T00:00:00Z`)
  return Number.isFinite(ms) ? ms : null
}

// 'YYYY-MM' → first-of-month epoch ms (null if unparseable).
function monthStartMs(month: string): number | null {
  const m = month.match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const ms = Date.parse(`${m[1]}-${m[2]}-01T00:00:00Z`)
  return Number.isFinite(ms) ? ms : null
}

// The soonest (earliest) sale window month on a lot, or null if none set.
function soonestWindow(lot: Lot): string | null {
  const months = (lot.sale_windows ?? []).map(w => w.month).filter(Boolean).sort()
  return months[0] ?? null
}

// Auto-pick the endorsement rung. With a sale window → the rung whose end date is NEAREST that
// month (covers through the sell date; "nearest" naturally clamps to the ladder ends). No window
// → the shortest endorsement (the soonest standard floor) + matchedWindow null (the panel nudges
// "set a sale window"). Returns null only if the ladder has no rung with a parseable end date.
function pickRung(
  ladder: LrpLadderRung[],
  windowMonth: string | null,
): { rung: LrpLadderRung; matchedWindow: string | null } | null {
  const valid = ladder.filter(r => usDateMs(r.endorsement_end_date) != null)
  if (valid.length === 0) return null

  const target = windowMonth ? monthStartMs(windowMonth) : null
  if (target == null) {
    const shortest = valid.slice().sort((a, b) => a.endorsement_length_weeks - b.endorsement_length_weeks)[0]
    return { rung: shortest, matchedWindow: null }
  }
  const nearest = valid.slice().sort((a, b) =>
    Math.abs(usDateMs(a.endorsement_end_date)! - target) - Math.abs(usDateMs(b.endorsement_end_date)! - target),
  )[0]
  return { rung: nearest, matchedWindow: windowMonth }
}

export function buildOutlook(input: { lots: Lot[]; matrix: LrpMatrixResult }): OutlookData {
  const { lots, matrix } = input

  // Whole matrix down (read error / nothing seeded) → one honest unavailable state.
  if (matrix.status !== 'ok') {
    return { status: 'unavailable', lots: [], as_of: null, source: SOURCE }
  }

  const byType = new Map(matrix.floors.map(f => [f.lrp.lrp_type, f]))
  const out: OutlookLot[] = []

  for (const lot of lots) {
    const label = lotLabel(lot)
    const m = lotToLrpType(lot)

    // Not eligible — breeding/cull (lrp_class null) or out of feeder weight range (weight_code
    // null). Carries the honest reason; never a fake floor.
    if (!m.lrp_class || !m.weight_code) {
      out.push({ lotId: lot.id, label, state: 'not_eligible', reason: m.reason ?? 'Not LRP-eligible' })
      continue
    }

    const lrpType = `${m.lrp_class} ${m.weight_code}`
    const floor = byType.get(lrpType)

    if (!floor) {                              // this type didn't post in the matrix
      out.push({ lotId: lot.id, label, state: 'unavailable', lrpType })
      continue
    }
    if (floor.lrp.stale) {                     // type present but stale — never show as current
      out.push({ lotId: lot.id, label, state: 'stale', lrpType, effective_date: floor.lrp.effective_date })
      continue
    }

    const picked = pickRung(floor.ladder, soonestWindow(lot))
    if (!picked) {                             // defensive: no usable ladder → fall to the headline
      const h = floor.lrp
      out.push({
        lotId: lot.id, label, state: 'priced', lrpType, effective_date: h.effective_date,
        floor: {
          coverage_price: h.coverage_price,
          endorsement_length_weeks: h.endorsement_length_weeks,
          endorsement_end_date: h.endorsement_end_date ?? '',
          producer_premium_per_cwt: h.producer_premium_per_cwt,
          matchedWindow: null,
        },
      })
      continue
    }

    out.push({
      lotId: lot.id, label, state: 'priced', lrpType, effective_date: floor.lrp.effective_date,
      floor: {
        coverage_price: picked.rung.coverage_price,
        endorsement_length_weeks: picked.rung.endorsement_length_weeks,
        endorsement_end_date: picked.rung.endorsement_end_date,
        producer_premium_per_cwt: picked.rung.producer_premium_per_cwt,
        matchedWindow: picked.matchedWindow,
      },
    })
  }

  const as_of = out
    .filter(l => l.state === 'priced' && l.effective_date)
    .map(l => l.effective_date!)
    .sort()
    .at(-1) ?? null

  return { status: 'ok', lots: out, as_of, source: SOURCE }
}
