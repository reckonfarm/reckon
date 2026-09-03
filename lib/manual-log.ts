// Manual event logging — the operator's own entries in the ranch ledger.
// Shared between POST /api/log (validation) and the /home UI (labels).
//
// A manual event is an ordinary `events` row: device_id null (no emitter),
// dedup_key null (two honest same-minute entries must both store), lat/lng
// null (no fix), type one of the five below. Everything type-specific lives in
// payload, which always carries source:'manual' so readers can find these
// rows without a schema change.

export const MANUAL_EVENT_TYPES = [
  'rain',
  'hay_fed',
  'bales_stacked',
  'cattle_moved',
  'cattle_worked',
  'hay_inventory',
] as const
export type ManualEventType = (typeof MANUAL_EVENT_TYPES)[number]

export function isManualEventType(v: unknown): v is ManualEventType {
  return typeof v === 'string' && (MANUAL_EVENT_TYPES as readonly string[]).includes(v)
}

export const MANUAL_EVENT_LABELS: Record<ManualEventType, string> = {
  rain: 'Rain',
  hay_fed: 'Hay fed',
  bales_stacked: 'Bales stacked',
  cattle_moved: 'Cattle moved',
  cattle_worked: 'Cattle worked',
  hay_inventory: 'Bales on hand',
}

export const MANUAL_SCHEMA_VERSION = 1

// Sane ceilings. A typo'd 34000 bounces with a message, not a silent ledger
// row that skews every total downstream. Mirrors the 039 actuals bounds.
export const LIMITS = {
  inches: { min: 0, max: 30 },      // 0 is honest ("checked the gauge, dry")
  bales:  { min: 1, max: 10000 },
  count:  { min: 1, max: 10000 },
  head:   { min: 1, max: 20000 },
  what:   { maxLen: 80 },
  onHand: { min: 0, max: 100000 }, // 0 is honest ("stack's empty")
} as const

export type ManualPayload = {
  source: 'manual'
  schema_version: number
  place_id: string | null
} & (
  | { inches: number }
  | { bales: number; herd_lot_id: string | null }
  | { count: number }
  | { head: number; from_place_id: string | null; to_place_id: string | null }
  | { head: number; what: string }
  | { bales: number; as_of: string }
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// uuid | null. Undefined and empty string read as null — a blank place is a
// valid answer everywhere; a log never blocks on choosing one.
function optionalUuid(v: unknown, name: string): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'string' && UUID_RE.test(v)) return v
  throw new ValidationError(`${name} must be a uuid or null`)
}

function boundedNumber(v: unknown, name: string, min: number, max: number, integer: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ValidationError(`${name} must be a number`)
  }
  if (integer && !Number.isInteger(v)) throw new ValidationError(`${name} must be a whole number`)
  if (v < min || v > max) throw new ValidationError(`${name} must be ${min}–${max}`)
  return v
}

export class ValidationError extends Error {}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// 'YYYY-MM-DD' ranch day. Not in the future (a count is of a stack that
// exists), not before 2000.
function ranchDay(v: unknown, name: string): string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) throw new ValidationError(`${name} must be a date (YYYY-MM-DD)`)
  const d = new Date(`${v}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${name} must be a real date`)
  if (d.getTime() > Date.now() + 36 * 3600 * 1000) throw new ValidationError(`${name} is in the future`)
  if (d.getUTCFullYear() < 2000) throw new ValidationError(`${name} is too far in the past`)
  return v
}

// Body → validated payload for one type. Throws ValidationError with a
// plain-language message the route returns as a 400.
export function buildManualPayload(type: ManualEventType, body: Record<string, unknown>): ManualPayload {
  const base = {
    source: 'manual' as const,
    schema_version: MANUAL_SCHEMA_VERSION,
    place_id: optionalUuid(body.place_id, 'place_id'),
  }
  switch (type) {
    case 'rain': {
      const inches = boundedNumber(body.inches, 'inches', LIMITS.inches.min, LIMITS.inches.max, false)
      return { ...base, inches: Math.round(inches * 100) / 100 }
    }
    case 'hay_fed':
      return {
        ...base,
        bales: boundedNumber(body.bales, 'bales', LIMITS.bales.min, LIMITS.bales.max, true),
        herd_lot_id: optionalUuid(body.herd_lot_id, 'herd_lot_id'),
      }
    case 'bales_stacked':
      return { ...base, count: boundedNumber(body.count, 'count', LIMITS.count.min, LIMITS.count.max, true) }
    case 'cattle_moved':
      return {
        ...base,
        head: boundedNumber(body.head, 'head', LIMITS.head.min, LIMITS.head.max, true),
        from_place_id: optionalUuid(body.from_place_id, 'from_place_id'),
        to_place_id: optionalUuid(body.to_place_id, 'to_place_id'),
      }
    case 'cattle_worked': {
      const what = typeof body.what === 'string' ? body.what.trim().slice(0, LIMITS.what.maxLen) : ''
      if (!what) throw new ValidationError('what is required (e.g. "pregged", "vaccinated")')
      return {
        ...base,
        head: boundedNumber(body.head, 'head', LIMITS.head.min, LIMITS.head.max, true),
        what,
      }
    }
    // A counted baseline: "N bales on hand as of D". The hay ledger
    // (lib/hay/queries) takes the most recent count as the starting point
    // for hay on hand — the only way that number is ever computed.
    case 'hay_inventory':
      return {
        ...base,
        bales: boundedNumber(body.bales, 'bales', LIMITS.onHand.min, LIMITS.onHand.max, true),
        as_of: ranchDay(body.as_of, 'as_of'),
      }
  }
}

// Request ts → ISO string. Missing means now. Rejects unparseable, more than
// a day in the future, or older than the year 2000 (a wrong-century phone).
export function parseEventTs(v: unknown): string {
  if (v == null || v === '') return new Date().toISOString()
  if (typeof v !== 'string') throw new ValidationError('ts must be an ISO timestamp')
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw new ValidationError('ts must be an ISO timestamp')
  if (d.getTime() > Date.now() + 24 * 3600 * 1000) throw new ValidationError('ts is in the future')
  if (d.getFullYear() < 2000) throw new ValidationError('ts is too far in the past')
  return d.toISOString()
}
