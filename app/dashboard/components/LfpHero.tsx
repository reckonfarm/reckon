import { Suspense } from 'react'
import type { LfpEligibilityResult } from '@/lib/lfp-eligibility'
import { estimatePayment } from '@/lib/lfp-payment'
import { getLfpDelta } from '@/lib/lfp-delta'
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

// Faithful short form of the engine's own tier label for the schedule rows (display only).
function shortLabel(label: string): string {
  return label.replace(' during the grazing period', '').replace(' (OBBBA 2025)', '')
}

// ─── Progress tracker — the core mechanic ──────────────────────────────────────
// Shows where the county OBJECTIVELY STANDS in the real LFP tier ladder the engine
// reports. A sober status tracker, never a game — the ladder climbs only because
// drought worsened (hardship, reported factually), never a thing to want or chase.
//
// HONEST PROGRESS: the engine's result exposes a granular "how close" only for Tier 1
// (currentD2Streak vs 4 CONSECUTIVE D2 weeks) — shown as a segmented bar. For the other
// tiers (7-of-8-week, any-time, N-non-consecutive-week rules) it reports only the
// triggered flag, so we render the discrete payout SCHEDULE and the next threshold's real
// rule as text — we do NOT fake a clean consecutive-week bar where the logic isn't.
function ProgressTracker({ eligibility }: { eligibility: LfpEligibilityResult }) {
  const { maxTier, payments, tiers, currentD2Streak, weeksUntilTier1 } = eligibility

  // PRE-TRIGGER (primary state): the consecutive-week build toward the first payment.
  if (maxTier === 0) {
    const filled = Math.min(Math.max(currentD2Streak, 0), 4)
    const left   = weeksUntilTier1 ?? 4
    return (
      <div className="space-y-3">
        <p className="font-dm-sans text-xs font-medium uppercase tracking-wider text-forest-green/45">
          Path to your first LFP payment
        </p>
        <div className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`h-2 flex-1 rounded-full ${i < filled ? 'bg-forest-green' : 'bg-forest-green/10'}`} />
          ))}
        </div>
        <p className="font-dm-sans text-sm text-forest-green/70">
          <span className="font-medium tabular-nums text-forest-green">{filled}</span> of 4 consecutive D2 (Severe) weeks
        </p>
        <p className="font-dm-sans text-sm leading-relaxed text-forest-green/55">
          {currentD2Streak > 0
            ? `${left} more consecutive week${left !== 1 ? 's' : ''} of D2 would trigger Tier 1 — 1 monthly payment.`
            : 'Four consecutive weeks of D2 (Severe) drought would trigger Tier 1 — 1 monthly payment.'}
        </p>
      </div>
    )
  }

  // TRIGGERED / CLIMBING: the real payout schedule. Tiers in effect are forest green; the
  // current tier is marked; tiers not yet in effect are muted. No granular bar (see above).
  const nextTier = maxTier < 6 ? tiers[maxTier] : null  // tiers[] 0-indexed; tiers[maxTier] = tier maxTier+1
  return (
    <div className="space-y-3">
      <p className="font-dm-sans text-xs font-medium uppercase tracking-wider text-forest-green/45">
        LFP payout schedule
      </p>
      <ol>
        {tiers.map(t => {
          const reached = t.triggered
          const current = t.tier === maxTier
          return (
            <li
              key={t.tier}
              className={`flex items-center justify-between gap-3 border-l-2 py-2 pl-3 ${reached ? 'border-forest-green' : 'border-forest-green/10'}`}
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-dm-sans text-sm">
                <span className={reached ? 'font-medium text-forest-green' : 'text-forest-green/40'}>
                  {shortLabel(t.label)}
                </span>
                {current && (
                  <span className="font-dm-sans text-[11px] font-medium uppercase tracking-wide text-forest-green/50">
                    Current
                  </span>
                )}
              </span>
              <span className={`shrink-0 font-dm-sans text-sm tabular-nums ${reached ? 'text-forest-green' : 'text-forest-green/40'}`}>
                {t.payments} pmt{t.payments !== 1 ? 's' : ''}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="font-dm-sans text-sm leading-relaxed text-forest-green/55">
        Your county has reached Tier {maxTier} — {payments} monthly payment{payments !== 1 ? 's' : ''}. You&apos;re paid at your highest qualifying tier.
        {nextTier
          ? ` Tier ${nextTier.tier} requires ${shortLabel(nextTier.label)} (${nextTier.payments} payment${nextTier.payments !== 1 ? 's' : ''}).`
          : ' This is the highest tier.'}
      </p>
    </div>
  )
}

// ─── Delta line — honest week-over-week change from the snapshot store ──────────
// Empty/quiet by design: until snapshots accumulate for a county, this renders NOTHING
// (a complete non-event). Any missing data / read failure → nothing, never a fabricated
// number. The basis is the stored monotonic figures (see lib/lfp-delta.ts).

function sincePhrase(priorWeek: string, currentWeek: string): string {
  const days = (new Date(`${currentWeek}T00:00:00`).getTime() - new Date(`${priorWeek}T00:00:00`).getTime()) / 86_400_000
  return days <= 8 ? 'since last Thursday' : `since the week of ${fmtAsOf(priorWeek)}`
}

async function DeltaLine({ fips }: { fips: string }) {
  const delta = await getLfpDelta(fips)
  if (!delta) return null   // graceful empty state — render nothing at all

  let text: string
  switch (delta.kind) {
    case 'tracking_begins':
      text = 'Tracking begins this week.'
      break
    case 'money':
      text = `↑ $${Math.round(delta.dollars).toLocaleString()} ${sincePhrase(delta.priorWeek, delta.currentWeek)}.`
      break
    case 'streak':
      text = `+${delta.weeks} week${delta.weeks !== 1 ? 's' : ''} of D2 ${sincePhrase(delta.priorWeek, delta.currentWeek)}.`
      break
    case 'unchanged':
      text = `Unchanged ${sincePhrase(delta.priorWeek, delta.currentWeek)}.`
      break
  }
  return <p className="font-dm-sans text-sm text-forest-green/55">{text}</p>
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

      {/* d. Progress tracker — the core mechanic (slice 3). Reads engine output only. */}
      {/* e. Delta — placeholder unchanged (filled in slice 4). */}
      <div className="mt-8 space-y-6">
        <ProgressTracker eligibility={eligibility} />
        {/* e. Delta — renders nothing until snapshots accumulate (empty state = non-event). */}
        <Suspense fallback={null}>
          <DeltaLine fips={eligibility.fips} />
        </Suspense>
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
