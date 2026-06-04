import type { LfpEligibilityResult } from '@/lib/lfp-eligibility'
import { estimatePayment } from '@/lib/lfp-payment'
import LfpEstimateNote from '@/app/components/LfpEstimateNote'

// ─── LFP hero (SLICE 1 — structure only) ───────────────────────────────────────
// The sharp LFP status at the PERMANENT TOP of the dashboard, always open.
// READS ENGINE OUTPUT ONLY — the computeLfpEligibility result + estimatePayment.
// It never reimplements tier logic, week-counting, or payment math; the placeholders
// (progress tracker, delta) land in later slices.
//
// It is a sober financial status tracker, never a game: an advance is reported, not
// celebrated; the FSA "estimate only" caveat is present at every state. (No visual
// polish this slice — that comes next.)

interface LfpHeroProps {
  eligibility: LfpEligibilityResult
  countyName:  string
}

// Display label for the engine's maxTier (+ current streak) — a label for a number the
// engine already produced, NOT tier logic.
function severityLabel(maxTier: number, currentD2Streak: number): string {
  if (maxTier >= 5)        return 'D4 Exceptional'
  if (maxTier >= 3)        return 'D3 Extreme'
  if (maxTier >= 1)        return 'D2 Severe'
  if (currentD2Streak > 0) return 'D2 Severe'
  return 'No D2+ drought trigger'
}

function fmtAsOf(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function LfpHero({ eligibility, countyName }: LfpHeroProps) {
  const { maxTier, payments, weeksUntilTier1, currentD2Streak, tiers, dataAsOf } = eligibility
  const triggered = maxTier >= 1 && payments > 0

  // County-level / 100-head adult-beef REFERENCE figure — the same basis as the dashboard
  // banner and the OG card. Never a personalized number.
  const refEstimate = triggered
    ? estimatePayment('beef_adult', 100, payments).cappedEstimate
    : null

  const tierLabel = tiers.find(t => t.tier === maxTier)?.label ?? ''
  const weeksLeft = weeksUntilTier1 ?? 4

  return (
    <section className="space-y-4 rounded-xl border border-forest-green/10 bg-white p-5 sm:p-6">

      {/* a. County + drought severity */}
      <p className="font-dm-sans text-sm font-medium text-forest-green/60">
        {countyName} County — {severityLabel(maxTier, currentD2Streak)}
      </p>

      {/* b. Hero line — engine output: dollar estimate if triggered, else the D2 countdown */}
      {triggered ? (
        <div>
          <p className="font-fraunces text-4xl font-semibold tabular-nums text-forest-green sm:text-5xl">
            ~${Math.round(refEstimate!).toLocaleString()}
          </p>
          <p className="mt-1 font-dm-sans text-sm text-forest-green/60">estimated LFP payment</p>
        </div>
      ) : (
        <p className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
          {weeksLeft} week{weeksLeft !== 1 ? 's' : ''} of D2 from your first LFP payment
        </p>
      )}

      {/* c. Plain-language line */}
      <p className="font-dm-sans text-sm leading-relaxed text-forest-green/70">
        {triggered
          ? `Your county qualifies for ${payments} monthly LFP payment${payments !== 1 ? 's' : ''} — ${tierLabel}. Estimate assumes ~100 head of adult beef cattle; your herd may differ.`
          : currentD2Streak > 0
            ? `Your county is in D2 (Severe) drought — ${currentD2Streak} consecutive week${currentD2Streak !== 1 ? 's' : ''} so far. Four consecutive weeks triggers your first LFP payment.`
            : `Your county isn't in a qualifying drought yet. Four consecutive weeks of D2 (Severe) drought triggers the first LFP payment.`}
      </p>

      {/* d. Progress tracker — placeholder (slice 2) */}
      <div className="rounded border border-dashed border-forest-green/25 px-4 py-6 text-center font-dm-sans text-xs uppercase tracking-wider text-forest-green/35">
        PROGRESS TRACKER HERE
      </div>

      {/* e. Delta — placeholder (slice 3) */}
      <div className="rounded border border-dashed border-forest-green/25 px-4 py-3 text-center font-dm-sans text-xs uppercase tracking-wider text-forest-green/35">
        DELTA HERE
      </div>

      {/* f. FSA "estimate only" caveat + as-of (shown at every state) */}
      <div className="space-y-1.5">
        <LfpEstimateNote />
        <p className="font-dm-sans text-xs text-forest-green/40">
          Drought data as of {fmtAsOf(dataAsOf)}.
        </p>
      </div>
    </section>
  )
}
