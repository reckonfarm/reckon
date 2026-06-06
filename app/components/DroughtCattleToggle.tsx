'use client'

import Link from 'next/link'
import { useLinkStatus } from 'next/link'

// Two-way segmented control marking Market News and the Drought dashboard as PEER
// views of one county. Preserves fips. News is the DEFAULT (bare /dashboard, no view
// param); Drought is opt-in via &view=drought.
//
// Client component so the tapped segment can show a pending spinner via useLinkStatus
// while the (dynamic, no-loading.js) Drought view renders server-side — so the first
// cold tap feels responsive instead of frozen. Perceived-perf only; no data change.

// useLinkStatus must run inside the <Link> it tracks. animate-spin is disabled in this
// project's @theme, so the spinner uses a scoped keyframe.
function SegLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus()
  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      {label}
      {pending && (
        <span
          aria-hidden
          className="dl-toggle-spin inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent"
        />
      )}
    </span>
  )
}

export default function DroughtCattleToggle({
  fips,
  active,
}: {
  fips: string
  active: 'news' | 'drought'
}) {
  const seg = (href: string, label: string, isActive: boolean) => (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={[
        'flex-1 rounded-md px-4 py-1.5 text-center font-dm-sans text-sm font-medium transition-colors',
        isActive
          ? 'bg-forest-green text-white shadow-sm'
          : 'text-forest-green/60 hover:bg-forest-green/5',
      ].join(' ')}
    >
      <SegLabel label={label} />
    </Link>
  )
  return (
    <div className="flex w-full rounded-lg border border-forest-green/15 bg-white p-0.5">
      <style>{`@keyframes dlToggleSpin{to{transform:rotate(360deg)}}.dl-toggle-spin{animation:dlToggleSpin .6s linear infinite}`}</style>
      {seg(`/dashboard?fips=${fips}`, 'News', active === 'news')}
      {seg(`/dashboard?fips=${fips}&view=drought`, 'Drought', active === 'drought')}
    </div>
  )
}
