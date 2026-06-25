'use client'

import LfpDisclaimer from '@/app/components/LfpDisclaimer'
import LfpEstimateNote from '@/app/components/LfpEstimateNote'
import type { LfpEnforcement } from '@/lib/lfp-eligibility'

interface TriggeredBannerProps {
  countyName:      string
  maxTier:         number
  payments:        number
  defaultEstimate: number   // pre-computed server-side with 100 beef_adult default
  grazingEndDate:  string   // YYYY-MM-DD — show as "FSA signup closes …"
  enforcement:     LfpEnforcement
}

// "Find your county FSA office" — USDA service-center locator. Shown on the pending banner
// where the only honest next step is to check with the local office directly.
const FSA_OFFICE_LOCATOR = 'https://www.farmers.gov/working-with-us/service-center-locator'

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

function scrollToChecklist() {
  document.getElementById('action-cards')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function TriggeredBanner({
  countyName,
  maxTier,
  payments,
  defaultEstimate,
  grazingEndDate,
  enforcement,
}: TriggeredBannerProps) {
  if (maxTier < 1) return null

  // Pending — county qualifies under OBBBA's new D2 rule, but FSA hasn't loaded OBBBA into
  // the 2026 eligibility maps, so it is NOT officially triggered. No dollar, no signup date,
  // no "signup is open now." Amber, consistent with the OBBBA-note palette.
  if (enforcement === 'pending_obbba') {
    return (
      <div className="rounded-xl bg-amber-50 px-5 py-4 ring-1 ring-amber-200">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-dm-sans text-xs font-semibold uppercase tracking-wider text-amber-700">
              LFP — Meets new OBBBA threshold
            </p>
            <p className="mt-1 font-fraunces text-xl font-semibold text-amber-900 sm:text-2xl">
              {countyName} qualifies under the new D2 rule — not yet official
            </p>
            <p className="mt-1 font-dm-sans text-sm leading-relaxed text-amber-800">
              Your county has hit D2 (Severe) for 4+ consecutive weeks, which qualifies under
              the One Big Beautiful Bill Act&apos;s new threshold. But FSA hasn&apos;t loaded
              the OBBBA rules into the 2026 eligibility maps yet, so it&apos;s not officially
              triggered. Expected to qualify once FSA updates — keep your records, and{' '}
              <a
                href={FSA_OFFICE_LOCATOR}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-amber-900 underline hover:text-amber-700"
              >
                check with your county FSA office
              </a>.
            </p>
          </div>

          <button
            onClick={scrollToChecklist}
            className="shrink-0 rounded-lg bg-amber-100 px-4 py-2.5 font-dm-sans text-sm font-semibold text-amber-900 ring-1 ring-amber-200 hover:bg-amber-200/70 transition-colors"
          >
            View FSA checklist →
          </button>
        </div>

        <LfpDisclaimer className="mt-3 !text-amber-700/80" />
      </div>
    )
  }

  // Officially eligible — the existing green triggered banner, unchanged.
  if (enforcement !== 'officially_eligible') return null

  const est = defaultEstimate.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  })

  return (
    <div className="rounded-xl bg-forest-green px-5 py-4 shadow-[0_4px_16px_rgba(27,67,50,0.25)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-dm-sans text-xs font-semibold uppercase tracking-wider text-white/60">
            LFP — Tier {maxTier} triggered
          </p>
          <p className="mt-1 font-fraunces text-xl font-semibold text-white sm:text-2xl">
            {countyName} is triggered
          </p>
          <p className="mt-1 font-dm-sans text-sm text-white/80">
            ~{est} estimated{' '}
            <span className="text-white/50">(100 beef cattle default)</span>
            {' · '}
            {payments} monthly LFP payment{payments !== 1 ? 's' : ''} · FSA signup is open now.
          </p>
          <p className="mt-1 font-dm-sans text-xs text-white/55">
            Don&apos;t wait — FSA signup closes {formatDate(grazingEndDate)}.
          </p>
          <div className="mt-2">
            <LfpEstimateNote tone="onDark" />
          </div>
        </div>

        <button
          onClick={scrollToChecklist}
          className="shrink-0 rounded-lg bg-white/15 px-4 py-2.5 font-dm-sans text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/25 transition-colors"
        >
          View FSA checklist →
        </button>
      </div>

      <LfpDisclaimer className="mt-3 !text-white/55" />
    </div>
  )
}
