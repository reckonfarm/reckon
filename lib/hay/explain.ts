import { fmtDay, plural } from '../jobs/format'
import type { OnHand } from './queries'

// ─── One explanation of hay on hand (Block 6 · 6C) ────────────────────────────
// The receipt after a feeding and the Hay panel state the SAME complete
// equation, from the same numbers: what was counted, what was added since,
// what was fed since, what is on hand. The Sept 8 audit's receipt read "323
// remaining from your count of 420 … 102 fed since" and left out the 5
// stacked; a man who checks 420 − 102 gets 318 and stops trusting the app's
// arithmetic. Every term is shown, zero included, so the subtraction on the
// back of an envelope comes out the same.
// Scope is the ranch: the ledger behind on hand is ranch-wide (every stack,
// every place), and it is never a particular stack's balance — the line says
// so, and the count's date is the equation's effective date.

export interface OnHandExplanation {
  equation: string          // "200 counted Tue, Sep 8, 2026 + 5 added − 12 fed = 193 bales on hand"
  scope: string             // "across the ranch since that count — not any one stack's balance"
  shortfall: string | null  // when on hand reads below zero: more fed than the count allows
}

export const ranchDay = (key: string) => fmtDay(`${key}T12:00:00-06:00`)

export function explainOnHand(o: OnHand): OnHandExplanation {
  const b = o.baseline
  const equation = `${b.bales.toLocaleString()} counted ${ranchDay(b.asOf)} + ${o.stackedSince.bales.toLocaleString()} added − ${o.fedSince.bales.toLocaleString()} fed = ${plural(o.bales, 'bale')} on hand`
  return {
    equation,
    scope: 'across the ranch since that count — not any one stack’s balance',
    shortfall: o.bales < 0 ? `more fed than your ${ranchDay(b.asOf)} count allows; recount when you can` : null,
  }
}
