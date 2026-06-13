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
  active: 'news' | 'drought' | 'hay' | 'markets'
}) {
  const seg = (href: string, label: string, isActive: boolean) => (
    <Link
      key={href}
      href={href}
      scroll={false}
      aria-current={isActive ? 'page' : undefined}
      className={[
        'flex-1 basis-0 inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg px-3 text-center font-dm-sans text-sm font-medium transition-colors',
        isActive
          ? 'bg-forest-green text-white shadow-sm'
          : 'text-forest-green/70 hover:bg-forest-green/5',
      ].join(' ')}
    >
      <SegLabel label={label} />
    </Link>
  )

  // Data-driven so a 3rd/4th view is one array entry (+ widen `active` / the ?view= parse),
  // not a redesign. Each item's href / scroll={false} / aria-current / active=== logic is
  // identical to the previous hardcoded segments — this is structure only.
  // NOTE: the 'drought' key drives ?view=drought while its label reads "Weather" — the
  // label↔key mismatch is deliberate (renaming the value would break deep links, the
  // heavy-fetch gate, and the auth redirect).
  const segments: { key: 'news' | 'drought' | 'hay' | 'markets'; label: string; href: string }[] = [
    { key: 'news',    label: 'News',    href: `/dashboard?fips=${fips}` },
    { key: 'drought', label: 'Weather', href: `/dashboard?fips=${fips}&view=drought` },
    { key: 'hay',     label: 'Hay',     href: `/dashboard?fips=${fips}&view=hay` },
    { key: 'markets', label: 'Markets', href: `/dashboard?fips=${fips}&view=markets` },
  ]

  return (
    <div className="flex w-full rounded-xl bg-forest-green/8 p-1">
      <style>{`@keyframes dlToggleSpin{to{transform:rotate(360deg)}}.dl-toggle-spin{animation:dlToggleSpin .6s linear infinite}`}</style>
      {segments.map(s => seg(s.href, s.label, active === s.key))}
    </div>
  )
}
