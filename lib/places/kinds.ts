// ─── What kind of place this is ───────────────────────────────────────────────
//
// `kind` has been text-not-an-enum since 031 ("a new place kind must never
// require a migration", 031:46) and that stays true. This module is what the
// UI OFFERS, not what the column accepts — an unrecognised kind stores fine
// and simply renders as its own word, the same posture MACHINE_SUGGESTIONS
// takes in lib/jobs/annotations.ts.
//
// It exists because until slice 1 the kind was functionally dead: the only
// writer (LogIt.tsx) posted { name } alone, so app/api/places defaulted
// EVERYTHING to 'field'. On production that is why "Preston's house" is a
// field. The pasture-versus-field distinction is what the next block of work
// rests on, so something finally has to let a person say which.
//
// Ordered by how often a rancher names one, not alphabetically.

export interface PlaceKind {
  value: string
  label: string
  /** What it means in the operator's words, shown under the picker. */
  hint: string
}

export const PLACE_KINDS: readonly PlaceKind[] = [
  { value: 'pasture',   label: 'Pasture',   hint: 'Grazing ground' },
  { value: 'field',     label: 'Field',     hint: 'Hay or crop ground you cut' },
  { value: 'stackyard', label: 'Stackyard', hint: 'Where the hay sits' },
  // Block 8: a STACK is not a stackyard. The stackyard is the area; a stack is
  // the individual pile you feed off, and a ranch feeds off one stack at a
  // time inside a yard that holds several. Both stay — PK's ruling.
  { value: 'stack',     label: 'Stack',     hint: 'One pile you feed off' },
  { value: 'gate',      label: 'Gate',      hint: 'A gate worth naming' },
  { value: 'yard',      label: 'Yard',      hint: 'Corrals, the shop, the house' },
  { value: 'tank',      label: 'Tank',      hint: 'Water' },
] as const

export const DEFAULT_KIND = 'field'

export const MAX_NAME = 60
export const MAX_KIND = 30

/**
 * The column's rule, in one place: trimmed, lowercased so 'Field' and 'field'
 * are one kind, bounded, and defaulted. Anything outside PLACE_KINDS is kept
 * verbatim — the list is a suggestion, not a gate.
 */
export function normalizeKind(input: unknown): string {
  if (typeof input !== 'string') return DEFAULT_KIND
  return input.trim().toLowerCase().slice(0, MAX_KIND) || DEFAULT_KIND
}

/** Display: underscores back to spaces, matching the places pages' kindLabel. */
export function kindLabel(kind: string): string {
  const known = PLACE_KINDS.find(k => k.value === kind)
  return known ? known.label : kind.replace(/_/g, ' ')
}

// ─── Who may sit inside whom (Block 7A) ───────────────────────────────────────
//
// The hierarchy is pasture → field → stackyard → stack, and a parent is
// OPTIONAL at every level: a stack may sit straight in a pasture, a field may
// stand on its own. What is refused is nonsense — a pasture inside a stack.
// PK's ruling, 2026-09-14, verbatim:
//
//   pasture   → no parent
//   field     → pasture
//   stackyard → pasture | field
//   stack     → stackyard | field | pasture
//   gate, tank, yard → pasture | field
//
// A PRODUCT rule over a TEXT column, so it lives here and not in the schema —
// the same reason PLACE_KINDS is a list and not an enum. Migration 068 holds
// the two rules that are not product rules (same ranch, no loops). This table
// is enforced in POST and PATCH /api/places and drives which chips the
// capture and edit forms offer; a kind the table does not list (free text
// stored by an older writer, or a kind added later) is treated like a gate: it
// may sit inside a pasture or a field. That is the least surprising reading
// of "a named spot on the ground", and it never rejects a row the table has
// not heard of.
export const PARENT_KINDS: Readonly<Record<string, readonly string[]>> = {
  pasture:   [],
  field:     ['pasture'],
  stackyard: ['pasture', 'field'],
  stack:     ['stackyard', 'field', 'pasture'],
  gate:      ['pasture', 'field'],
  tank:      ['pasture', 'field'],
  yard:      ['pasture', 'field'],
}
const UNLISTED_PARENT_KINDS: readonly string[] = ['pasture', 'field']

/** The kinds a place of `kind` may sit inside. Empty = it is always top-level. */
export function allowedParentKinds(kind: string): readonly string[] {
  return PARENT_KINDS[kind] ?? UNLISTED_PARENT_KINDS
}

/** Whether a place of `parentKind` may contain a place of `childKind`. */
export function canContain(parentKind: string, childKind: string): boolean {
  return allowedParentKinds(childKind).includes(parentKind)
}

/** The rule for `kind`, as a sentence a refusal can quote. */
export function parentRule(kind: string): string {
  const allowed = allowedParentKinds(kind)
  const what = kindLabel(kind).toLowerCase()
  if (allowed.length === 0) return `A ${what} is never inside another place.`
  const names = allowed.map(k => `a ${kindLabel(k).toLowerCase()}`)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
  return `A ${what} sits inside ${list}, or on its own.`
}
