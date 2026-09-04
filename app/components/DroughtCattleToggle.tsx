'use client'

import { flagEnabled } from '@/lib/flags'
import { useDashboardView, type DashboardViewKey } from '@/app/dashboard/components/DashboardViews'

// Segmented control marking the peer views of one county. TODAY is the DEFAULT
// (bare /dashboard, no view param — internal key 'news', see below); Weather is
// opt-in via &view=drought.
//
// A tap is a client state change (DashboardViewProvider), not a navigation:
// the bodies are already on the page, so the switch is instant and no request
// is made. The URL's ?view= is kept in sync by the provider so deep links and
// reloads land on the same view. The old useLinkStatus pending spinner is gone
// with the round-trip it was covering for.

export default function DroughtCattleToggle() {
  const ctx = useDashboardView()
  const active = ctx?.view ?? 'news'

  // Data-driven so a 3rd/4th view is one array entry (+ widen the key type / the
  // ?view= parse), not a redesign.
  // NOTE: the 'drought' key drives ?view=drought while its label reads "Weather", and
  // the 'news' key is the default view while its label reads "Today" — the label↔key
  // mismatches are deliberate (renaming the values would break deep links, the
  // heavy-fetch gate, and the auth redirect).
  const segments: { key: DashboardViewKey; label: string }[] = [
    { key: 'news',    label: 'Today' },
    // Jobs — derived work sessions (replaced Activity 2026-08-09; the raw-event
    // feed was a debug view, jobs are the product). Second position holds: the
    // ranch's own record beats the outside world's on the home surface. Stale
    // ?view=activity deep links parse to this view on the dashboard side.
    { key: 'jobs',    label: 'Jobs' },
    { key: 'drought', label: 'Weather' },
    // Hay segment rides the marketplace flag (the dashboard's ?view=hay parse is
    // gated on the same flag, so a stale deep link falls back to the default view).
    ...(flagEnabled('marketplace') ? [{ key: 'hay' as const, label: 'Hay' }] : []),
    { key: 'markets', label: 'Markets' },
  ]

  return (
    <div className="flex w-full rounded-xl bg-forest-green/8 p-1" role="tablist" aria-label="County views">
      {segments.map(s => {
        const isActive = active === s.key
        return (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => ctx?.setView(s.key)}
            className={[
              'flex-1 basis-0 inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-lg px-3 text-center font-dm-sans text-sm font-medium transition-colors',
              isActive
                ? 'bg-forest-green text-white shadow-sm'
                : 'text-forest-green/70 hover:bg-forest-green/5',
            ].join(' ')}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}
