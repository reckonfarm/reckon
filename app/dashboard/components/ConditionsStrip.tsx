'use client'

import { useLinkStatus } from 'next/link'
import { droughtSeverity, type UsdmReading } from '@/lib/drought-severity'
import { useDashboardView } from '@/app/dashboard/components/DashboardViews'

// ─── Conditions strip ──────────────────────────────────────────────────────────
// The drought lead at the top of Today — one slim row: the USDM category chip
// with its as-of date, tap → Weather. It used to carry today's high/low and
// rain chance too; flow commit 5 cut that half because the 7-day carousel's
// first cell on the same screen said exactly the same numbers. This is now
// the ONE place the drought category renders on Today (the LFP card states the
// consequence — tier, payments — not the chip). READS EXISTING PAGE DATA ONLY:
// the always-awaited `latest` USDM reading.
//
// Honesty: renders only from a real reading — none → nothing (no placeholder).
// The reading (a current condition) carries its visible USDM as-of date. The
// row links to the Weather tab with the toggle's exact href pattern.
//
// Client component for the SAME reason the toggle is one: the Weather view is a heavy
// dynamic render with no loading.js, so a tap shows a useLinkStatus pending spinner
// (the toggle's exact SegLabel mechanism) instead of reading as a dead tap while the
// old view stays on screen.

// USDM chip palette — calm tint + solid dot + dark readable text, the same chip
// vocabulary as LfpAlertCard / LfpHero (which only need D2+; the strip can see any
// active category, so D0/D1 get legible variants of their USDM hues).
const CHIP: Record<number, { dot: string; text: string; bg: string }> = {
  4: { dot: '#730000', text: '#730000', bg: 'rgba(115,0,0,0.07)' },
  3: { dot: '#E60000', text: '#B00000', bg: 'rgba(230,0,0,0.07)' },
  2: { dot: '#FFAA00', text: '#8A5A00', bg: 'rgba(255,170,0,0.12)' },
  1: { dot: '#FCD37F', text: '#8A5A00', bg: 'rgba(252,211,127,0.20)' },
  0: { dot: '#D6CC00', text: '#6E6600', bg: 'rgba(255,255,0,0.10)' },
}
const NO_DROUGHT_CHIP = { dot: '#1B4332', text: '#1B4332', bg: 'rgba(27,67,50,0.06)' }

// Short severity words for the compact chip ("D2 Severe") — display labels for the
// level droughtSeverity() already picked, not a re-derivation.
const SEVERITY_SHORT: Record<number, string> = {
  4: 'Exceptional', 3: 'Extreme', 2: 'Severe', 1: 'Moderate', 0: 'Abnormally dry',
}

function fmtShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Tap feedback — the toggle's SegLabel mechanism: useLinkStatus (inside the Link it
// tracks) swaps the chevron for a spinner while the Weather view renders server-side.
// animate-spin is disabled in this project's @theme, so it uses a scoped keyframe.
function TapStatus() {
  const { pending } = useLinkStatus()
  return pending ? (
    <span
      aria-hidden
      className="dl-strip-spin inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent text-forest-green/50"
    />
  ) : (
    <span aria-hidden className="text-forest-green/40">›</span>
  )
}

export default function ConditionsStrip({
  reading,
  fips,
}: {
  reading: ({ week_date: string } & UsdmReading) | null
  fips: string
}) {
  // On the dashboard the Weather view is already on the page: a tap switches
  // the client view state instead of navigating (zero requests). On /home there
  // is no provider (null) and the href below does the real navigation as before.
  const dashboardView = useDashboardView()

  const sev = droughtSeverity(reading)

  // No real reading → nothing. Never a placeholder row.
  if (!reading) return null

  const chip = sev.level != null ? CHIP[sev.level] : NO_DROUGHT_CHIP
  const chipLabel = sev.level != null ? `D${sev.level} ${SEVERITY_SHORT[sev.level]}` : 'No drought'

  // A plain <a>, not a <Link> (nav-fixes, commit 1). The tap is an in-page
  // view switch (setView below); the href is the same URL for a no-JS or
  // out-of-provider fallback. As a <Link> it was prefetched, and Next's
  // segment cache retries a route-tree prefetch for a URL WITH search params
  // as the bare pathname (segment-cache/scheduler.js pingRoute) — i.e. bare
  // /dashboard, whose middleware 307 is the flow-4a router-cache trap.
  return (
    <a
      href={`/dashboard?fips=${fips}&view=drought`}
      onClick={dashboardView ? e => { e.preventDefault(); dashboardView.setView('drought') } : undefined}
      className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-forest-green/10 bg-white px-4 py-2.5 transition-colors hover:bg-forest-green/5"
    >
      <style>{`@keyframes dlStripSpin{to{transform:rotate(360deg)}}.dl-strip-spin{animation:dlStripSpin .6s linear infinite}`}</style>
      <span className="inline-flex items-center gap-2">
        <>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-dm-sans text-xs font-medium"
              style={{ backgroundColor: chip.bg, color: chip.text }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: chip.dot }} />
              {chipLabel}
            </span>
            <span className="font-dm-sans text-[10px] text-forest-green/40">
              USDM {fmtShort(reading.week_date)}
            </span>
        </>
      </span>

      <span className="inline-flex items-center gap-2 font-dm-sans text-sm text-forest-green">
        <span className="text-xs text-forest-green/50">Weather</span>
        <TapStatus />
      </span>
    </a>
  )
}
