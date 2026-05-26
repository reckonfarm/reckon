// LFP payment estimation — lib/lfp-payment.ts
//
// FSA formula (Handbook 1-LFP Amendment 7, ¶56 D, Aug 12 2025):
//
//   Step 1: monthly feed cost = rate_per_head × head_count
//   Step 2: monthly feed cost = (eligible_acres ÷ acres_per_AU) × 30 × daily_feed_rate
//   monthly LFP payment      = min(Step 1, Step 2) × 0.60
//   total payment            = monthly LFP payment × payment_months (drought tier factor)
//
// The 60% factor is NOT pre-applied to the published per-head rates.
// The published rates are the raw monthly feed cost (= AU_equivalent × monthly value of forage).
// Source: 1-LFP Amendment 7 ¶56 C, example: $29.34 × 100 head = $2,934 → × 0.60 = $1,760.
//
// 2026 daily AU feed rate: $35.66 ÷ 30 = $1.18867/day
// Source: Official 2026 LFP Payment Rates table (FSA fact sheet, May 2026)

// ─── Types ────────────────────────────────────────────────────────────────────

export type LivestockKind =
  | 'beef_adult'
  | 'beef_non_adult_heavy'
  | 'beef_non_adult_light'
  | 'dairy_adult'
  | 'dairy_non_adult_heavy'
  | 'dairy_non_adult_light'
  | 'beefalo_adult'
  | 'beefalo_non_adult_heavy'
  | 'beefalo_non_adult_light'
  | 'buffalo_adult'
  | 'buffalo_non_adult_heavy'
  | 'buffalo_non_adult_light'
  | 'sheep_adult'
  | 'goat_adult'
  | 'deer'
  | 'equine'
  | 'elk'
  | 'reindeer'
  | 'alpacas'
  | 'emus'
  | 'llamas'
  | 'ostrich'

export interface PaymentRate {
  kind:            LivestockKind
  label:           string
  monthlyRate2026: number   // $/head/month — raw monthly feed cost (before 60%)
  rateConfirmed:   boolean  // true = from official 2026 FSA rate table
}

export interface LfpPaymentEstimate {
  livestockKind:  LivestockKind
  livestockLabel: string
  headCount:      number
  ratePerHead:    number        // raw monthly feed cost per head (before 60%)
  numPayments:    number        // drought tier payment factor (1–5)
  // Breakdown
  step1:          number        // ratePerHead × headCount
  step2:          number | null // carrying-capacity monthly cost; null if no acres given
  limitingStep:   1 | 2         // which step was the lesser (determines payment basis)
  monthlyPayment: number        // min(step1, step2) × 0.60
  grossEstimate:  number        // monthlyPayment × numPayments
  // Carrying-capacity inputs
  eligibleAcres:  number | null
  acresPerAU:     number | null
  dailyFeedRate:  number
  rateYear:       2026
  caveat:         string
}

// ─── 2026 rates ───────────────────────────────────────────────────────────────
// Per-head rates = AU_equivalent × $35.66/AUM (Exhibit 6, Handbook 1-LFP)

export const DAILY_FEED_RATE_2026 = 35.66 / 30  // ≈ $1.18867/day per AU

export const PAYMENT_RATES_2026: PaymentRate[] = [
  {
    kind:            'beef_adult',
    label:           'Beef cattle — adult (cows/bulls)',
    monthlyRate2026: 35.66,
    rateConfirmed:   true,
  },
  {
    kind:            'beef_non_adult_heavy',
    label:           'Beef cattle — non-adult ≥500 lb',
    monthlyRate2026: 26.74,
    rateConfirmed:   true,
  },
  {
    kind:            'beef_non_adult_light',
    label:           'Beef cattle — non-adult <500 lb',
    monthlyRate2026: 17.83,
    rateConfirmed:   true,
  },
  {
    kind:            'dairy_adult',
    label:           'Dairy cattle — adult (cows/bulls)',
    monthlyRate2026: 92.70,
    rateConfirmed:   true,
  },
  {
    kind:            'dairy_non_adult_heavy',
    label:           'Dairy cattle — non-adult ≥500 lb',
    monthlyRate2026: 26.74,
    rateConfirmed:   true,
  },
  {
    kind:            'dairy_non_adult_light',
    label:           'Dairy cattle — non-adult <500 lb',
    monthlyRate2026: 17.83,
    rateConfirmed:   true,
  },
  {
    kind:            'beefalo_adult',
    label:           'Beefalo — adult (cows/bulls)',
    monthlyRate2026: 35.66,
    rateConfirmed:   true,
  },
  {
    kind:            'beefalo_non_adult_heavy',
    label:           'Beefalo — non-adult ≥500 lb',
    monthlyRate2026: 26.74,
    rateConfirmed:   true,
  },
  {
    kind:            'beefalo_non_adult_light',
    label:           'Beefalo — non-adult <500 lb',
    monthlyRate2026: 17.83,
    rateConfirmed:   true,
  },
  {
    kind:            'buffalo_adult',
    label:           'Buffalo / bison — adult (cows/bulls)',
    monthlyRate2026: 35.66,
    rateConfirmed:   true,
  },
  {
    kind:            'buffalo_non_adult_heavy',
    label:           'Buffalo / bison — non-adult ≥500 lb',
    monthlyRate2026: 26.74,
    rateConfirmed:   true,
  },
  {
    kind:            'buffalo_non_adult_light',
    label:           'Buffalo / bison — non-adult <500 lb',
    monthlyRate2026: 17.83,
    rateConfirmed:   true,
  },
  {
    kind:            'sheep_adult',
    label:           'Sheep — adult',
    monthlyRate2026: 8.91,
    rateConfirmed:   true,
  },
  {
    kind:            'goat_adult',
    label:           'Goats — adult',
    monthlyRate2026: 8.91,
    rateConfirmed:   true,
  },
  {
    kind:            'deer',
    label:           'Deer',
    monthlyRate2026: 8.91,
    rateConfirmed:   true,
  },
  {
    kind:            'equine',
    label:           'Equine (horses / donkeys / mules)',
    monthlyRate2026: 26.38,
    rateConfirmed:   true,
  },
  {
    kind:            'elk',
    label:           'Elk',
    monthlyRate2026: 19.26,
    rateConfirmed:   true,
  },
  {
    kind:            'reindeer',
    label:           'Reindeer',
    monthlyRate2026: 7.84,
    rateConfirmed:   true,
  },
  {
    kind:            'alpacas',
    label:           'Alpacas',
    monthlyRate2026: 7.84,
    rateConfirmed:   true,
  },
  {
    kind:            'emus',
    label:           'Emus',
    monthlyRate2026: 18.25,
    rateConfirmed:   true,
  },
  {
    kind:            'llamas',
    label:           'Llamas',
    monthlyRate2026: 13.01,
    rateConfirmed:   true,
  },
  {
    kind:            'ostrich',
    label:           'Ostrich',
    monthlyRate2026: 19.61,
    rateConfirmed:   true,
  },
]

const BASE_CAVEAT =
  'ESTIMATE ONLY — FSA determines the final payment at enrollment. ' +
  '60% factor per Handbook 1-LFP ¶56 B. ' +
  'If no acreage was entered, the head-count method is used as the upper bound; ' +
  "your actual payment may be lower if your acreage's normal carrying capacity " +
  'produces a smaller monthly feed cost (FSA uses the lesser of the two).'

// ─── Main export ──────────────────────────────────────────────────────────────

export function estimatePayment(
  kind:        LivestockKind,
  headCount:   number,
  numPayments: number,
  opts?: {
    eligibleAcres?: number
    acresPerAU?:    number
  },
): LfpPaymentEstimate {
  if (headCount <= 0)   throw new Error('headCount must be > 0')
  if (numPayments <= 0) throw new Error('numPayments must be > 0 — county is not eligible')

  const rate = PAYMENT_RATES_2026.find(r => r.kind === kind)
  if (!rate) throw new Error(`Unknown livestock kind: "${kind}"`)

  const eligibleAcres = opts?.eligibleAcres ?? null
  const acresPerAU    = opts?.acresPerAU ?? null

  // Step 1: monthly feed cost based on actual head count
  const step1 = rate.monthlyRate2026 * headCount

  // Step 2: monthly feed cost based on normal carrying capacity (only when both acres are given)
  let step2: number | null = null
  if (eligibleAcres !== null && acresPerAU !== null && acresPerAU > 0) {
    step2 = (eligibleAcres / acresPerAU) * 30 * DAILY_FEED_RATE_2026
  }

  // Limiting factor — FSA pays 60% of the lesser
  const limitingStep: 1 | 2 = step2 !== null && step2 < step1 ? 2 : 1
  const limitingCost         = limitingStep === 2 ? step2! : step1
  const monthlyPayment       = limitingCost * 0.60
  const grossEstimate        = monthlyPayment * numPayments

  const unconfirmedNote = rate.rateConfirmed
    ? ''
    : ' Rate for this category estimated from FSA AU ratios — confirm with your FSA office.'

  return {
    livestockKind:  kind,
    livestockLabel: rate.label,
    headCount,
    ratePerHead:    rate.monthlyRate2026,
    numPayments,
    step1,
    step2,
    limitingStep,
    monthlyPayment,
    grossEstimate,
    eligibleAcres,
    acresPerAU,
    dailyFeedRate:  DAILY_FEED_RATE_2026,
    rateYear:       2026,
    caveat:         BASE_CAVEAT + unconfirmedNote,
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function formatPaymentLine(est: LfpPaymentEstimate): string {
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

  const step2Line = est.step2 !== null
    ? `  Step 2 (carrying cap): (${est.eligibleAcres} acres ÷ ${est.acresPerAU} ac/AU) × 30 × ${fmt(est.dailyFeedRate)}/day = ${fmt(est.step2)}/mo`
    : '  Step 2 (carrying cap): not entered — head-count method used'

  return [
    `Step 1 (head count):    ${est.headCount} head × ${fmt(est.ratePerHead)}/head = ${fmt(est.step1)}/mo`,
    step2Line,
    `60% of Step ${est.limitingStep}:          ${fmt(est.limitingStep === 2 ? est.step2! : est.step1)} × 0.60 = ${fmt(est.monthlyPayment)}/mo`,
    `× ${est.numPayments} monthly payment${est.numPayments !== 1 ? 's' : ''}:  ${fmt(est.grossEstimate)} total`,
  ].join('\n')
}
