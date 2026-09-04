import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { LfpEligibilityResult } from '@/lib/lfp-eligibility'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

// Small, always-visible LFP status alert — the compact sibling of the crop-insurance
// deadline card. Renders ONLY real computed values from the LFP eligibility engine
// (maxTier / payments / currentD2Streak / weeksUntilTier1 / dataAsOf). It deliberately
// shows NO dollar figure — the payment estimate stays on the big drought-view LfpHero.
// A failed/slow USDM fetch degrades to the honest "unavailable" line, never a false zero.


// The USDM severity chip used to lead each body here; since flow commit 5 the
// conditions strip at the top of Today is the ONE place the drought category
// renders — this card states the LFP consequence (tier, payments, streak) and
// its own as-of, never the chip again.

function fmtAsOf(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Append "County" only when the name doesn't already end with it (mirrors the guard in
// the deadline card / PrecipForecastSection so we never read "X County County").
function countyLabel(name: string): string {
  const n = name.trim()
  return /\bcounty$/i.test(n) ? n : `${n} County`
}

function FreshnessLine({ asOf }: { asOf: string }) {
  return (
    <p className="mt-3 text-xs text-forest-green/40 font-dm-sans">
      U.S. Drought Monitor · as of {fmtAsOf(asOf)}
    </p>
  )
}

// Triggered — the real monthly-payment count. NO dollar here.
function TriggeredBody({ eligibility }: { eligibility: LfpEligibilityResult }) {
  const { payments, maxTier } = eligibility
  return (
    <div className="flex flex-col gap-2">
      <p className="font-dm-sans text-sm text-forest-green/70">
        <span className="font-semibold text-forest-green">
          {payments} monthly payment{payments !== 1 ? 's' : ''} triggered
        </span>
        {' '}— Tier {maxTier}.
      </p>
    </div>
  )
}

// Pending — county meets OBBBA's new D2 threshold (≥4 consecutive weeks) but FSA hasn't
// loaded the rule into the 2026 eligibility maps, so it is NOT officially triggered. NO
// "triggered", NO payment count, NO dollar.
function PendingBody() {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-dm-sans text-sm text-forest-green/70">
        Meets the new OBBBA D2 threshold — not yet official with FSA.
      </p>
    </div>
  )
}

// In a D2 run but not yet triggered — real streak + real weeks-to-trigger.
function BuildingBody({ eligibility }: { eligibility: LfpEligibilityResult }) {
  const streak = eligibility.currentD2Streak
  const left   = eligibility.weeksUntilTier1 ?? Math.max(0, 4 - streak)
  return (
    <p className="font-dm-sans text-sm text-forest-green/70">
      <span className="font-semibold text-forest-green">{streak} week{streak !== 1 ? 's' : ''}</span>
      {' '}into a D2 (Severe) run
      {left > 0
        ? ` — ${left} more consecutive week${left !== 1 ? 's' : ''} triggers your first LFP payment.`
        : ' — your first LFP payment is triggered.'}
    </p>
  )
}

// Scoped shimmer — animate-pulse is disabled in this project's @theme.
export function LfpAlertSkeleton() {
  return (
    <Card shadow="soft" className="p-4 sm:p-6" aria-hidden="true">
      <style>{`@keyframes dlLfpShimmer{0%,100%{opacity:.55}50%{opacity:.85}}.dl-lfp-skel{animation:dlLfpShimmer 1.4s ease-in-out infinite}`}</style>
      <div className="dl-lfp-skel h-3 w-24 rounded bg-forest-green/10" />
      <div className="dl-lfp-skel mt-3 h-5 w-40 rounded bg-forest-green/5" />
      <div className="dl-lfp-skel mt-2 h-4 w-56 rounded bg-forest-green/5" />
    </Card>
  )
}

// ─── Quiet-card visibility (Block 2: silence is a feature) ─────────────────────────
// LOUD = anything a rancher should see without tapping: officially triggered,
// pending-OBBBA, mid-D2-streak (building), or UNAVAILABLE — if silence means
// all-is-well, a failed USDM fetch must speak, not go quiet; otherwise a triggered
// county with a dead fetch reads as healthy. QUIET = only the clean "no D2+ trigger"
// state, which folds into the Program status row. Mirrors the render branches below.
export function isLfpLoud(
  unavailable: boolean,
  eligibility: LfpEligibilityResult | null,
): boolean {
  if (unavailable || !eligibility) return true
  return (
    eligibility.enforcement === 'officially_eligible' ||
    eligibility.enforcement === 'pending_obbba' ||
    eligibility.currentD2Streak > 0
  )
}

// `embedded` renders the same content without the outer Card chrome — used when the
// card lives inside the collapsed "Program status" row (quiet home), whose accordion
// panel already provides the border and padding. Mirrors DeadlineCountdownCard.
export default function LfpAlertCard({
  eligibility,
  unavailable,
  countyName,
  embedded = false,
}: {
  eligibility: LfpEligibilityResult | null
  unavailable: boolean
  countyName:  string
  embedded?:   boolean
}) {
  const body = (
    <>
      <div className="mb-3">
        <p className={EYEBROW}>Drought / LFP</p>
        <Heading level={5} className="mt-1">LFP status</Heading>
      </div>

      {unavailable || !eligibility ? (
        // Honest degraded state — never a false zero or fabricated status.
        <p className="text-sm text-forest-green/50 font-dm-sans">
          Drought status temporarily unavailable — check back shortly.
        </p>
      ) : (
        <>
          {eligibility.enforcement === 'officially_eligible' ? (
            <TriggeredBody eligibility={eligibility} />
          ) : eligibility.enforcement === 'pending_obbba' ? (
            <PendingBody />
          ) : eligibility.currentD2Streak > 0 ? (
            <BuildingBody eligibility={eligibility} />
          ) : (
            <p className="font-dm-sans text-sm text-forest-green/70">
              No D2+ drought trigger for {countyLabel(countyName)} right now.
            </p>
          )}
          <FreshnessLine asOf={eligibility.dataAsOf} />
        </>
      )}
    </>
  )
  if (embedded) return <div>{body}</div>
  return <Card shadow="soft" className="p-4 sm:p-6">{body}</Card>
}
