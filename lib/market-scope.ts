// ─── Market honesty rules (Block 2.5, Part A) ─────────────────────────────────
//
// Shared by every surface that shows a cattle price: the scope label that
// says WHERE a figure came from (never a county), the rule-based match label
// (no invented percentages), the head-count floor below which a personalized
// dollar figure is withheld, and the sensitivity line — exact arithmetic on a
// lot's head and weight, nothing to be wrong about.

import { FRESH_DAYS, ageDays } from './barn-geo'

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
  | { kind: 'reference'; town: string; miles: number }   // beyond the discovery radius: town WITH state + straight-line miles
  | { kind: 'regional'; region: string }
  | { kind: 'national' }

// ─── How old is this reference? (Block 7C) ────────────────────────────────────
//
// Markets used to open with a three-date strip — "Latest reports: Local Sep 10
// · National Aug 31 · LRP Sep 11" — three dates for three different sections,
// none of them beside the number they date. It is replaced by ONE statement,
// in the reported-sale block under the hero, about the reference the page's
// own figures are built from.
//
// The window is not a new number. FRESH_DAYS and ageDays are lib/barn-geo's,
// the same rule that decides whether a barn resolves as a reference at all —
// so the page cannot say "fresh" about a barn the resolver has already ruled
// stale, or the reverse. Importing beats restating: a second copy of a rule is
// a second thing to be wrong.

export interface SaleAge {
  /** "Billings last reported Sep 10 · 2 days ago" — past the window it says so. */
  line: string
  /** Past FRESH_DAYS. The hero's price carries a short marker when this is true. */
  stale: boolean
  days: number
}

export function saleAge(barnTown: string, reportDate: string, nowMs: number = Date.now()): SaleAge {
  const days = ageDays(reportDate, nowMs)
  const when = Number.isFinite(days)
    ? days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
    : 'date unknown'
  const stale = days > FRESH_DAYS
  const d = new Date(`${reportDate}T00:00:00`)
  const on = Number.isNaN(d.getTime()) ? reportDate : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return {
    days,
    stale,
    line: `${barnTown} last reported ${on} · ${when}${stale ? `, past the ${FRESH_DAYS}-day window` : ''}`,
  }
}

/** The short marker beside a price whose reference is past the window. */
export const STALE_MARKER = 'stale reference'

/** Block 2.6I — the public USDA AMS MyMarketNews page for a report slug (the latest issue of that report). */
export const reportUrl = (slug: string) => `https://mymarketnews.ams.usda.gov/viewReport/${encodeURIComponent(slug)}`

export function scopeLabel(s: Scope): string {
  switch (s.kind) {
    // Block 6B: Local report / Regional reference / National reference — the scope, then its fallback.
    case 'nearby':   return `Local report — ${s.town}`
    case 'pinned':   return `Preferred sale barn — ${s.town}`
    case 'reference': return `Regional reference — ${s.town} · ~${s.miles.toLocaleString('en-US')} mi`
    case 'regional': return `Regional comparison — ${s.region}`
    case 'national': return 'National reference'
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

/**
 * Block 2.6G — thin evidence said plainly. When the source low equals the source
 * high there is ONE reported price, and the line says exactly that ("All 4 head
 * reported at $387.50/cwt"); only a real spread is called a range. Never "range
 * shown" beside a single figure.
 */
export function thinEvidence(
  lo: number | null | undefined, hi: number | null | undefined, avg: number, head: number, basis: 'cwt' | 'hd' = 'cwt',
): { figure: string; note: string; single: boolean } {
  const l = lo ?? avg, h = hi ?? avg
  if (Math.round(l * 100) === Math.round(h * 100)) {
    const price = `$${avg.toFixed(2)}/${basis}`
    return { figure: `$${avg.toFixed(2)}`, note: `All ${head.toLocaleString('en-US')} head reported at ${price}`, single: true }
  }
  return { figure: `$${Math.round(l)}–${Math.round(h)}`, note: `under ${THIN_HEAD_THRESHOLD} head · reported range $${Math.round(l)}–$${Math.round(h)}/${basis}, not one price`, single: false }
}
