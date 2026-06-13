import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { LfpEligibilityResult } from '@/lib/lfp-eligibility'

// Small, always-visible LFP status alert — the compact sibling of the crop-insurance
// deadline card. Renders ONLY real computed values from the LFP eligibility engine
// (maxTier / payments / currentD2Streak / weeksUntilTier1 / dataAsOf). It deliberately
// shows NO dollar figure — the payment estimate stays on the big drought-view LfpHero.
// A failed/slow USDM fetch degrades to the honest "unavailable" line, never a false zero.

const EYEBROW = 'text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide'

// USDM severity chip for the triggered tier — the same calm tint/dot/text vocabulary as
// the drought-view LfpHero. A real label for a real tier, never decoration.
function severity(maxTier: number): { label: string; dot: string; text: string; bg: string } {
  if (maxTier >= 5) return { label: 'D4 Exceptional', dot: '#730000', text: '#730000', bg: 'rgba(115,0,0,0.07)' }
  if (maxTier >= 3) return { label: 'D3 Extreme',     dot: '#E60000', text: '#B00000', bg: 'rgba(230,0,0,0.07)' }
  return              { label: 'D2 Severe',           dot: '#FFAA00', text: '#8A5A00', bg: 'rgba(255,170,0,0.12)' }
}

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

// Triggered — severity chip + the real monthly-payment count. NO dollar here.
function TriggeredBody({ eligibility }: { eligibility: LfpEligibilityResult }) {
  const sev = severity(eligibility.maxTier)
  const { payments, maxTier } = eligibility
  return (
    <div className="flex flex-col gap-2">
      <span
        className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 font-dm-sans text-xs font-medium"
        style={{ backgroundColor: sev.bg, color: sev.text }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sev.dot }} />
        {sev.label}
      </span>
      <p className="font-dm-sans text-sm text-forest-green/70">
        <span className="font-semibold text-forest-green">
          {payments} monthly payment{payments !== 1 ? 's' : ''} triggered
        </span>
        {' '}— Tier {maxTier}.
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

export default function LfpAlertCard({
  eligibility,
  unavailable,
  countyName,
}: {
  eligibility: LfpEligibilityResult | null
  unavailable: boolean
  countyName:  string
}) {
  return (
    <Card shadow="soft" className="p-4 sm:p-6">
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
          {eligibility.maxTier >= 1 ? (
            <TriggeredBody eligibility={eligibility} />
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
    </Card>
  )
}
