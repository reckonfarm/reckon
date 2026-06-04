import type { LfpEligibilityResult } from '@/lib/lfp-eligibility'
import { estimatePayment } from '@/lib/lfp-payment'
import LfpEstimateNote from '@/app/components/LfpEstimateNote'

// ─── LFP hero (SLICE 2 — sharp visual pass) ────────────────────────────────────
// The LFP status at the permanent top of the dashboard. READS ENGINE OUTPUT ONLY
// (computeLfpEligibility result + estimatePayment) — no tier/week/payment logic
// reimplemented.
//
// Visual hierarchy (consumer-money-app restraint, existing brand):
//   • The HERO LINE — the dollar figure when triggered, else the D2 countdown — is the
//     largest element by a wide margin, in forest green, with generous air around it.
//   • County name + a small, calm severity chip (USDM D-scale color) orient above it.
//   • The plain-language line and the FSA caveat + as-of stay small, gray, and recessive.
//   • One flat card, one accent (forest green) for the hero, whitespace is the polish.
// Sober financial status — never a game. Progress-tracker + delta placeholders unchanged.

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
  return 'No D2+ trigger'
}

// USDM D-scale colors for the small severity chip — the standard drought-category color
// (semantic, not decoration). Kept calm: a faint tint, a solid dot, dark readable text.
function severityChip(label: string): { dot: string; text: string; bg: string } {
  switch (label) {
    case 'D4 Exceptional': return { dot: '#730000', text: '#730000', bg: 'rgba(115,0,0,0.07)' }
    case 'D3 Extreme':     return { dot: '#E60000', text: '#B00000', bg: 'rgba(230,0,0,0.07)' }
    case 'D2 Severe':      return { dot: '#FFAA00', text: '#8A5A00', bg: 'rgba(255,170,0,0.12)' }
    default:               return { dot: '#1B4332', text: '#1B4332', bg: 'rgba(27,67,50,0.06)' }
  }
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
  const sev       = severityLabel(maxTier, currentD2Streak)
  const chip      = severityChip(sev)

  return (
    <section className="rounded-xl border border-forest-green/10 bg-white p-6 shadow-[0_2px_12px_rgba(27,67,50,0.08)] sm:p-8">

      {/* a. County + severity chip — small, orienting, above the hero */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="font-dm-sans text-sm font-medium text-forest-green/70">
          {countyName}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-dm-sans text-xs font-medium"
          style={{ backgroundColor: chip.bg, color: chip.text }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: chip.dot }} />
          {sev}
        </span>
      </div>

      {/* b. HERO LINE — largest element by a wide margin, forest green, generous air */}
      <div className="mt-7 sm:mt-8">
        {triggered ? (
          <>
            <p className="font-fraunces text-5xl font-semibold leading-none tracking-tight tabular-nums text-forest-green sm:text-6xl">
              ~${Math.round(refEstimate!).toLocaleString()}
            </p>
            <p className="mt-3 font-dm-sans text-sm text-forest-green/50">
              estimated LFP payment
            </p>
          </>
        ) : (
          <p className="max-w-md font-fraunces text-3xl font-semibold leading-tight tracking-tight text-forest-green sm:text-4xl">
            {weeksLeft} week{weeksLeft !== 1 ? 's' : ''} of D2 from your first LFP payment
          </p>
        )}
      </div>

      {/* c. Plain-language line — small, gray, money/decision framing under the hero */}
      <p className="mt-4 max-w-xl font-dm-sans text-sm leading-relaxed text-forest-green/60">
        {triggered
          ? `Your county qualifies for ${payments} monthly LFP payment${payments !== 1 ? 's' : ''} — ${tierLabel}. Estimate assumes ~100 head of adult beef cattle; your herd may differ.`
          : currentD2Streak > 0
            ? `Your county is in D2 (Severe) drought — ${currentD2Streak} consecutive week${currentD2Streak !== 1 ? 's' : ''} so far. Four consecutive weeks triggers your first LFP payment.`
            : `Your county isn't in a qualifying drought yet. Four consecutive weeks of D2 (Severe) drought triggers the first LFP payment.`}
      </p>

      {/* d + e. Progress tracker & delta — placeholders unchanged (filled in slices 3 & 4) */}
      <div className="mt-8 space-y-3">
        <div className="rounded border border-dashed border-forest-green/25 px-4 py-6 text-center font-dm-sans text-xs uppercase tracking-wider text-forest-green/35">
          PROGRESS TRACKER HERE
        </div>
        <div className="rounded border border-dashed border-forest-green/25 px-4 py-3 text-center font-dm-sans text-xs uppercase tracking-wider text-forest-green/35">
          DELTA HERE
        </div>
      </div>

      {/* f. FSA "estimate only" caveat + as-of — small, gray, recessive (every state) */}
      <div className="mt-6 space-y-1.5 border-t border-forest-green/[0.08] pt-4">
        <LfpEstimateNote />
        <p className="font-dm-sans text-xs text-forest-green/40">
          Drought data as of {fmtAsOf(dataAsOf)}.
        </p>
      </div>
    </section>
  )
}
