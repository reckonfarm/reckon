'use client'

import LfpDisclaimer from '@/app/components/LfpDisclaimer'

interface TriggeredBannerProps {
  countyName:      string
  maxTier:         number
  payments:        number
  defaultEstimate: number   // pre-computed server-side with 100 beef_adult default
  grazingEndDate:  string   // YYYY-MM-DD — show as "FSA signup closes …"
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

export default function TriggeredBanner({
  countyName,
  maxTier,
  payments,
  defaultEstimate,
  grazingEndDate,
}: TriggeredBannerProps) {
  if (maxTier < 1) return null

  function scrollToChecklist() {
    document.getElementById('action-cards')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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
