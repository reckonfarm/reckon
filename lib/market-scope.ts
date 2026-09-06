// ─── Market honesty rules (Block 2.5, Part A) ─────────────────────────────────
//
// Shared by every surface that shows a cattle price: the scope label that
// says WHERE a figure came from (never a county), the rule-based match label
// (no invented percentages), the head-count floor below which a personalized
// dollar figure is withheld, and the sensitivity line — exact arithmetic on a
// lot's head and weight, nothing to be wrong about.

/** Below this many reported head, a reference is thin: show the range and say so, never a precise dollar figure. */
export const THIN_HEAD_THRESHOLD = 20

export type MatchLabel = 'Close match' | 'Broader reference' | 'Limited evidence'

/**
 * Rule-based, inspectable:
 *   Close match      — same class, exact weight bracket, at or above the head floor
 *   Broader reference — same class, no exact bracket (class average), at or above the head floor
 *   Limited evidence — fewer reported head than the floor, whatever the bracket
 */
export function matchLabel(input: { exactBracket: boolean; headCount: number | null }): MatchLabel {
  const head = input.headCount ?? 0
  if (head < THIN_HEAD_THRESHOLD) return 'Limited evidence'
  return input.exactBracket ? 'Close match' : 'Broader reference'
}

export function isThin(headCount: number | null | undefined): boolean {
  return (headCount ?? 0) < THIN_HEAD_THRESHOLD
}

/** "Nearby auction reference — Billings" · "Regional comparison — Northern Plains" · "National benchmark" */
export type Scope =
  | { kind: 'nearby'; town: string }
  | { kind: 'pinned'; town: string }
  | { kind: 'regional'; region: string }
  | { kind: 'national' }

export function scopeLabel(s: Scope): string {
  switch (s.kind) {
    case 'nearby':   return `Nearby auction reference — ${s.town}`
    case 'pinned':   return `Where you sell — ${s.town}`
    case 'regional': return `Regional comparison — ${s.region}`
    case 'national': return 'National benchmark'
  }
}

/**
 * Every $1/cwt move is worth head × weight / 100 dollars on a lot priced per
 * cwt. Exact arithmetic. Null when head or weight is missing — never guessed.
 */
export function dollarsPerCwtMove(headCount: number | null | undefined, avgWeightLb: number | null | undefined): number | null {
  if (!headCount || !avgWeightLb || headCount <= 0 || avgWeightLb <= 0) return null
  return Math.round(headCount * avgWeightLb / 100)
}

export function sensitivityLine(headCount: number | null | undefined, avgWeightLb: number | null | undefined): string | null {
  const d = dollarsPerCwtMove(headCount, avgWeightLb)
  return d == null ? null : `Every $1/cwt move is $${d.toLocaleString('en-US')} on this lot.`
}

/** Cull-cow grades as MARS names them, kept distinct; anything else is 'Other'. */
export type CullGrade = 'Breaker' | 'Boner' | 'Lean' | 'Other'
export function cullGrade(qualityGrade: string | null | undefined): CullGrade {
  const q = (qualityGrade ?? '').toLowerCase()
  if (q.startsWith('break')) return 'Breaker'
  if (q.startsWith('bon')) return 'Boner'
  if (q.startsWith('lean')) return 'Lean'
  return 'Other'
}

/** Price shown for a thin reference: the reported range, no cents. */
export function fmtRange(lo: number | null, hi: number | null, avg: number): string {
  const l = lo ?? avg, h = hi ?? avg
  return l === h ? `~$${Math.round(l)}` : `$${Math.round(l)}–${Math.round(h)}`
}
