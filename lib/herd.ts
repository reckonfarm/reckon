// ─── Herd model — typed lot structure stored in operation_profiles.herd (jsonb) ─────────
//
// DECISION (CFO-locked): lots live as TYPED JSONB on operation_profiles.herd — NOT a
// separate table. Same jsonb pattern as crops; trivially extensible (a new facet is a new
// optional key, never a migration); shape enforced in TypeScript + API validation, not in
// hard SQL columns. See supabase/migrations/023_herd_typed.sql for why no DDL is needed.
//
// A herd is { lots: Lot[] }. Each lot is one homogeneous group the producer values and
// (later) prices against MARS. Lot fields split into REQUIRED (entry is invalid until they
// are present + well-typed) and DEFAULTED (editable, never block entry). Every lot carries
// created_at / updated_at so the operation's composition is timestamped over time — the
// data-moat requirement.
//
// Isomorphic on purpose (no 'server-only'): the entry UI imports these types + helpers too.

// ─── Class enum + MARS mapping ──────────────────────────────────────────────────────────
// Stored values are stable machine keys (snake_case) so labels can change without a data
// migration. The enum covers the vernacular set the producer named and maps each onto the
// MARS price vocabulary (commodity / class) so a lot joins cleanly to auction + LRP data.

export const LOT_CLASSES = ['steers', 'heifers', 'yearlings', 'cows', 'bulls', 'old_cows'] as const
export type LotClass = (typeof LOT_CLASSES)[number]

export const LOT_CLASS_LABELS: Record<LotClass, string> = {
  steers:    'Steers',
  heifers:   'Heifers',
  yearlings: 'Yearlings',
  cows:      'Cows',
  bulls:     'Bulls',
  old_cows:  'Old cows (cull)',
}

export type MarsCommodity = 'Feeder Cattle' | 'Slaughter Cattle'
export type MarsClass = 'Steers' | 'Heifers' | 'Cows' | 'Bulls'

export interface MarsClassMapping {
  commodity: MarsCommodity
  marsClass: MarsClass
  // Feeder Cattle LRP exists; slaughter cows/bulls + breeding stock have NO LRP floor. The
  // per-lot Outlook step reads this to stay quiet (no endorsement ladder) when it's false.
  lrpFeederEligible: boolean
  note?: string
}

// How each herd class resolves to the MARS commodity/class. `lrpFeederEligible: false` is
// the explicit flag for "no feeder-LRP equivalent" the Outlook step needs.
export const LOT_CLASS_TO_MARS: Record<LotClass, MarsClassMapping> = {
  steers:    { commodity: 'Feeder Cattle',    marsClass: 'Steers',  lrpFeederEligible: true },
  heifers:   { commodity: 'Feeder Cattle',    marsClass: 'Heifers', lrpFeederEligible: true },
  // KNOWN SHARPENING POINT (not built — speculative until a real user hits it): a yearling
  // lot that is actually heifers must be entered as class=heifers today. If that proves
  // common, revisit a dedicated `yearling_heifers` class rather than overloading steers.
  yearlings: {
    commodity: 'Feeder Cattle', marsClass: 'Steers', lrpFeederEligible: true,
    note: 'Yearlings price as heavy feeder steers (a higher weight band than calves). MARS has no sex-neutral feeder class — if a yearling lot is heifers, set class=heifers instead.',
  },
  cows: {
    commodity: 'Slaughter Cattle', marsClass: 'Cows', lrpFeederEligible: false,
    note: 'Breeding cows: NO feeder LRP. Value at the Slaughter Cows (cull) floor, or a replacement/bred-cow special when one is reported.',
  },
  bulls: {
    commodity: 'Slaughter Cattle', marsClass: 'Bulls', lrpFeederEligible: false,
    note: 'Breeding/cull bulls: NO feeder LRP. Value at the Slaughter Bulls price.',
  },
  old_cows: {
    commodity: 'Slaughter Cattle', marsClass: 'Cows', lrpFeederEligible: false,
    note: 'Cull cows → Slaughter Cattle / Cows. NO feeder LRP.',
  },
}

// ─── Lot facets ──────────────────────────────────────────────────────────────────────────

export type WeightUnit = 'lb' | 'cwt'

// MARS frame descriptors (base — no 1/2 muscle suffix). Default keeps entry one-tap.
export const LOT_FRAMES = ['Large', 'Medium and Large', 'Medium', 'Small'] as const
export type LotFrame = (typeof LOT_FRAMES)[number]

export const DEFAULT_FRAME: LotFrame = 'Medium and Large'
export const DEFAULT_WEANED = true

// A target sale period for (part of) a lot. 'YYYY-MM' is the granularity the LRP endorsement
// ladder resolves to. head_count is optional: omit ⇒ the whole lot sells in this window;
// set it to split a lot across windows (the per-lot reconciliation the LRP single-select
// picker can't yet express). Multiple windows per lot are allowed; [] ⇒ Outlook stays quiet.
export interface SaleWindow {
  id: string
  month: string        // 'YYYY-MM'
  head_count?: number  // optional partial; omitted ⇒ whole lot
}

export interface Lot {
  id: string           // stable id (client- or server-generated)

  // REQUIRED — entry invalid until present + well-typed.
  class: LotClass
  head_count: number   // positive integer
  avg_weight: number   // > 0, expressed in `weight_unit`
  weight_unit: WeightUnit

  // DEFAULTED — editable, never block entry.
  frame: LotFrame
  weaned: boolean
  sale_windows: SaleWindow[]

  // Timestamped composition (data moat).
  created_at: string   // ISO-8601
  updated_at: string   // ISO-8601

  // EXTENSIBLE: future optional facets (breeding, target_weight, aums, …) add here as
  // optional keys — and in normalizeLot below — with NO DB migration (the column is jsonb).
}

export interface Herd {
  lots: Lot[]
}

// ─── herd → MARS join key ────────────────────────────────────────────────────────────────
// Resolves a lot onto the price vocabulary. avg_weight is normalized to LB (MARS reports
// avg_weight in lb) so weight-band matching is unit-consistent. lot_desc carries the
// weaned/unweaned signal that discounts unweaned feeders; null for slaughter classes where
// it doesn't apply.
export interface MarsLotKey {
  commodity: MarsCommodity
  marsClass: MarsClass
  frame: LotFrame
  avgWeightLb: number
  lotDesc: 'weaned' | 'unweaned' | null
  lrpFeederEligible: boolean
}

export function lotToMarsKey(lot: Lot): MarsLotKey {
  const m = LOT_CLASS_TO_MARS[lot.class]
  return {
    commodity: m.commodity,
    marsClass: m.marsClass,
    frame: lot.frame,
    avgWeightLb: lot.weight_unit === 'cwt' ? lot.avg_weight * 100 : lot.avg_weight,
    lotDesc: m.commodity === 'Feeder Cattle' ? (lot.weaned ? 'weaned' : 'unweaned') : null,
    lrpFeederEligible: m.lrpFeederEligible,
  }
}

// ─── herd → LRP (RMA) type map ───────────────────────────────────────────────────────────
// The per-lot Outlook prices each lot against the RMA LRP Feeder Cattle matrix — Steers/Heifers
// × Weight 1/Weight 2. This maps a lot onto that matrix, REUSING the lrpFeederEligible gate:
//   • breeding/cull classes (cows, bulls, old_cows) have NO feeder-LRP product → lrp_class null.
//   • a feeder lot above the LRP feeder ceiling (> 1000 lb)          → weight_code null.
// Both null cases carry an honest `reason` so Outlook says "not LRP-eligible …", never a fake
// floor. The join key Build 2 uses is `${lrp_class} ${weight_code}` ('Steers Weight 2') — exactly
// the normalized lrp_type the snapshot writer stores.
//
// Weight bands are the RMA LRP Feeder Cattle categories (Weight 1 < 600 lb, Weight 2 600–1000
// lb). The bands ROUTE the lot here; the snapshot writer confirms the actual type strings from
// the report at seed time (it captures whatever Steers/Heifers Weight 1/2 rows the report has).
export interface LrpTypeMatch {
  lrp_class:   'Steers' | 'Heifers' | null
  weight_code: 'Weight 1' | 'Weight 2' | null
  reason?:     string   // present only when not eligible (lrp_class or weight_code is null)
}

export function lotToLrpType(lot: Lot): LrpTypeMatch {
  const m = LOT_CLASS_TO_MARS[lot.class]
  if (!m.lrpFeederEligible) {
    return { lrp_class: null, weight_code: null, reason: 'breeding/cull stock — no LRP feeder product' }
  }
  // Eligible classes are steers/heifers/yearlings; their marsClass is Steers or Heifers.
  const lrp_class: 'Steers' | 'Heifers' = m.marsClass === 'Heifers' ? 'Heifers' : 'Steers'
  const wLb = lotToMarsKey(lot).avgWeightLb
  if (wLb < 600)   return { lrp_class, weight_code: 'Weight 1' }
  if (wLb <= 1000) return { lrp_class, weight_code: 'Weight 2' }
  return { lrp_class, weight_code: null, reason: 'above LRP feeder weight range (> 1000 lb)' }
}

// ─── Validation / normalization (used by the operation-profile PATCH route) ──────────────
// Contract: REJECT malformed lots (bad/missing required fields); ACCEPT sparse lots (required
// fields only) and fill the DEFAULTED fields + timestamps + id. The normalized herd is what
// gets stored, so defaults/timestamps persist instead of being re-derived on every read.
// Unknown keys are dropped (server is authoritative on shape). Never throws.

export type HerdValidationResult =
  | { ok: true; herd: Herd }
  | { ok: false; error: string }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
const isPosNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const nowIso = () => new Date().toISOString()
const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `lot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function normalizeSaleWindows(
  raw: unknown,
  label: string,
): { ok: true; windows: SaleWindow[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, windows: [] }
  if (!Array.isArray(raw)) return { ok: false, error: `${label}: sale_windows must be an array` }

  const windows: SaleWindow[] = []
  for (const w of raw) {
    if (!isObject(w)) return { ok: false, error: `${label}: each sale window must be an object` }
    if (typeof w.month !== 'string' || !MONTH_RE.test(w.month)) {
      return { ok: false, error: `${label}: sale window month must be 'YYYY-MM'` }
    }
    const win: SaleWindow = { id: typeof w.id === 'string' && w.id ? w.id : newId(), month: w.month }
    if (w.head_count !== undefined) {
      if (!isPosInt(w.head_count)) {
        return { ok: false, error: `${label}: sale window head_count must be a positive integer` }
      }
      win.head_count = w.head_count
    }
    windows.push(win)
  }
  return { ok: true, windows }
}

export function normalizeLot(
  raw: unknown,
  index = 0,
): { ok: true; lot: Lot } | { ok: false; error: string } {
  const label = `lot ${index + 1}`
  if (!isObject(raw)) return { ok: false, error: `${label} must be an object` }

  // REQUIRED (locals so the type guards narrow for the returned object).
  const klass = raw.class
  if (typeof klass !== 'string' || !(LOT_CLASSES as readonly string[]).includes(klass)) {
    return { ok: false, error: `${label}: class must be one of ${LOT_CLASSES.join(', ')}` }
  }
  const head_count = raw.head_count
  if (!isPosInt(head_count)) return { ok: false, error: `${label}: head_count must be a positive integer` }
  const avg_weight = raw.avg_weight
  if (!isPosNum(avg_weight)) return { ok: false, error: `${label}: avg_weight must be a positive number` }
  const weight_unit = raw.weight_unit
  if (weight_unit !== 'lb' && weight_unit !== 'cwt') {
    return { ok: false, error: `${label}: weight_unit must be 'lb' or 'cwt'` }
  }

  // DEFAULTED (never block entry).
  const frame: LotFrame = (LOT_FRAMES as readonly string[]).includes(raw.frame as string)
    ? (raw.frame as LotFrame)
    : DEFAULT_FRAME
  const weaned = typeof raw.weaned === 'boolean' ? raw.weaned : DEFAULT_WEANED
  const sw = normalizeSaleWindows(raw.sale_windows, label)
  if (!sw.ok) return sw

  return {
    ok: true,
    lot: {
      id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
      class: klass as LotClass,
      head_count,
      avg_weight,
      weight_unit,
      frame,
      weaned,
      sale_windows: sw.windows,
      // Lot edit timestamps are client-supplied (preserved if valid, else now()) — fine for
      // a producer editing their own private lots. NOTE: future AI-moat logging of decisions/
      // outcomes (what we showed, what the producer did) must use SERVER-authoritative
      // timestamps, never client-supplied — a separate, later concern.
      created_at: isIso(raw.created_at) ? raw.created_at : nowIso(),
      updated_at: isIso(raw.updated_at) ? raw.updated_at : nowIso(),
    },
  }
}

export function normalizeHerd(raw: unknown): HerdValidationResult {
  if (!isObject(raw)) return { ok: false, error: 'herd must be an object shaped { lots: [...] }' }
  if (!Array.isArray(raw.lots)) return { ok: false, error: 'herd.lots must be an array' }

  const lots: Lot[] = []
  for (let i = 0; i < raw.lots.length; i++) {
    const r = normalizeLot(raw.lots[i], i)
    if (!r.ok) return { ok: false, error: r.error }
    lots.push(r.lot)
  }
  return { ok: true, herd: { lots } }
}
