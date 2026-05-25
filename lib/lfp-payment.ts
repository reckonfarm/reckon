// LFP payment estimation — lib/lfp-payment.ts
//
// The published monthly rate per head is already the 60%-of-feed-cost figure
// that FSA uses as the maximum payment ceiling (per 7 CFR 1416.408).
// A producer's actual payment = published rate × head count × num payments
// ONLY IF their acreage's normal carrying capacity produces a monthly feed cost
// at or above the published rate. If carrying capacity is lower, FSA uses the
// lower actual feed cost × 60% instead.
//
// This calculator always uses the published 2025 rate (the UPPER BOUND).
// Label every result as ESTIMATE — final amount is determined by FSA at signup.
//
// Source: droughtmonitor.unl.edu/FSA/About/PaymentRates.aspx (2025 column)

// ─── Types ────────────────────────────────────────────────────────────────────

export type LivestockKind =
  | 'beef_adult'
  | 'beef_non_adult'
  | 'dairy_adult'
  | 'dairy_non_adult'
  | 'sheep_adult'
  | 'goat_adult'
  | 'buffalo_adult'

export interface PaymentRate {
  kind:            LivestockKind
  label:           string
  monthlyRate2025: number   // $/head/month — 2025 published rate (upper bound)
  rateConfirmed:   boolean  // true = sourced directly from FSA page; false = FSA-standard ratio
}

export interface LfpPaymentEstimate {
  livestockKind:   LivestockKind
  livestockLabel:  string
  headCount:       number
  monthlyRate:     number   // $/head/month used
  numPayments:     number   // from eligibility tier
  grossEstimate:   number   // monthlyRate × headCount × numPayments (upper-bound estimate)
  rateYear:        2025
  caveat:          string
}

// ─── 2025 Published rates ─────────────────────────────────────────────────────

export const PAYMENT_RATES_2025: PaymentRate[] = [
  {
    kind:            'beef_adult',
    label:           'Beef cattle (adult, ≥500 lb)',
    monthlyRate2025: 41.40,
    rateConfirmed:   true,
  },
  {
    kind:            'beef_non_adult',
    label:           'Beef cattle (non-adult, <500 lb)',
    // FSA standard: non-adult rate ≈ 2/3 of adult; verify with local FSA office
    monthlyRate2025: 27.60,
    rateConfirmed:   false,
  },
  {
    kind:            'dairy_adult',
    label:           'Dairy cattle (adult)',
    monthlyRate2025: 107.64,
    rateConfirmed:   true,
  },
  {
    kind:            'dairy_non_adult',
    label:           'Dairy cattle (non-adult)',
    // FSA standard: typically same as beef adult; verify with local FSA office
    monthlyRate2025: 41.40,
    rateConfirmed:   false,
  },
  {
    kind:            'sheep_adult',
    label:           'Sheep (adult)',
    monthlyRate2025: 10.35,
    rateConfirmed:   true,
  },
  {
    kind:            'goat_adult',
    label:           'Goats (adult)',
    monthlyRate2025: 10.35,
    rateConfirmed:   true,
  },
  {
    kind:            'buffalo_adult',
    label:           'Buffalo / beefalo (adult)',
    // FSA standard: same schedule as adult beef
    monthlyRate2025: 41.40,
    rateConfirmed:   false,
  },
]

const BASE_CAVEAT =
  'ESTIMATE ONLY — uses the 2025 maximum published FSA rate. ' +
  'Your actual payment may be lower if your acreage\'s normal carrying capacity ' +
  'produces a monthly feed cost below the published rate (FSA uses 60% of the ' +
  'lesser of the two figures). FSA determines the final payment at enrollment.'

// ─── Main export ──────────────────────────────────────────────────────────────

export function estimatePayment(
  kind:        LivestockKind,
  headCount:   number,
  numPayments: number,
): LfpPaymentEstimate {
  if (headCount <= 0)   throw new Error('headCount must be > 0')
  if (numPayments <= 0) throw new Error('numPayments must be > 0 — county is not eligible')

  const rate = PAYMENT_RATES_2025.find(r => r.kind === kind)
  if (!rate) throw new Error(`Unknown livestock kind: "${kind}"`)

  const grossEstimate = rate.monthlyRate2025 * headCount * numPayments

  const unconfirmedNote = rate.rateConfirmed
    ? ''
    : ' Rate for this livestock category is estimated from FSA standard ratios — confirm with your FSA office.'

  return {
    livestockKind:  kind,
    livestockLabel: rate.label,
    headCount,
    monthlyRate:    rate.monthlyRate2025,
    numPayments,
    grossEstimate,
    rateYear:       2025,
    caveat:         BASE_CAVEAT + unconfirmedNote,
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function formatPaymentLine(estimate: LfpPaymentEstimate): string {
  const gross = estimate.grossEstimate.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  })
  const rate = estimate.monthlyRate.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  })
  return (
    `${gross} gross estimate — ` +
    `${estimate.headCount.toLocaleString()} ${estimate.livestockLabel} ` +
    `× ${rate}/head/mo × ${estimate.numPayments} monthly payment${estimate.numPayments !== 1 ? 's' : ''}`
  )
}
