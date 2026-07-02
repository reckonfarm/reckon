import Link from 'next/link'
import type { LocalForecast } from '@/lib/nws'
import { droughtSeverity, type UsdmReading } from '@/lib/drought-severity'

// ─── Conditions strip (B2′) ─────────────────────────────────────────────────────
// The compact always-visible weather lead at the top of the county dashboard — one
// slim row (drought chip + today's forecast) directly under the orientation bar, so
// conditions lead on every open regardless of which tab is active. READS EXISTING
// PAGE DATA ONLY: the always-awaited `latest` USDM reading and the always-started
// NWS forecast promise (streamed in behind Suspense; the chip renders immediately).
//
// Honesty: each half renders only from real data — no reading → no chip, no forecast
// → no temps (never a fake temp or fabricated 0%). Both missing → the strip renders
// NOTHING (no placeholder). The drought reading (a current condition) carries its
// visible USDM as-of date. The whole row links to the Weather tab using the exact
// href/scroll pattern of the DroughtCattleToggle segments — no new tab plumbing.

// Same water-blue as the forecast card's rain % so "chance of rain" reads
// consistently across surfaces.
const RAIN_BLUE = '#2563EB'

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

// Today's outlook from the NWS periods the page already fetched: the first calendar
// day's daytime high, overnight low, and max rain chance. Same field semantics as
// ForecastPanel's day rows (precipProbability null = absent → omitted, never 0).
function todayOutlook(fc: LocalForecast | null): { hi: number | null; lo: number | null; rain: number | null } | null {
  const periods = fc?.periods
  if (!periods || periods.length === 0) return null
  const dateKey = periods[0].startTime.slice(0, 10)
  let hi: number | null = null
  let lo: number | null = null
  let rain: number | null = null
  for (const p of periods) {
    if (p.startTime.slice(0, 10) !== dateKey) break
    if (p.isDaytime) hi = hi == null ? p.temperature : Math.max(hi, p.temperature)
    else lo = lo == null ? p.temperature : Math.min(lo, p.temperature)
    if (p.precipProbability != null) rain = rain == null ? p.precipProbability : Math.max(rain, p.precipProbability)
  }
  if (hi == null && lo == null && rain == null) return null
  return { hi, lo, rain }
}

export default function ConditionsStrip({
  reading,
  forecast,
  fips,
}: {
  reading: ({ week_date: string } & UsdmReading) | null
  forecast: LocalForecast | null
  fips: string
}) {
  const sev = droughtSeverity(reading)
  const today = todayOutlook(forecast)

  // No real data at all → nothing. Never a placeholder row.
  if (!reading && !today) return null

  const chip = sev.level != null ? CHIP[sev.level] : NO_DROUGHT_CHIP
  const chipLabel = sev.level != null ? `D${sev.level} ${SEVERITY_SHORT[sev.level]}` : 'No drought'

  return (
    <Link
      href={`/dashboard?fips=${fips}&view=drought`}
      scroll={false}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-forest-green/10 bg-white px-4 py-2.5 transition-colors hover:bg-forest-green/5"
    >
      <span className="inline-flex items-center gap-2">
        {reading && (
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
        )}
      </span>

      <span className="inline-flex items-center gap-2 font-dm-sans text-sm text-forest-green">
        {today && (
          <>
            <span className="text-xs text-forest-green/50">Today</span>
            {(today.hi != null || today.lo != null) && (
              <span className="tabular-nums">
                {today.hi != null && `${today.hi}°`}
                {today.hi != null && today.lo != null && <span className="text-forest-green/40"> / </span>}
                {today.lo != null && <span className={today.hi != null ? 'text-forest-green/60' : ''}>{today.lo}°</span>}
              </span>
            )}
            {today.rain != null && (
              <span className="font-semibold tabular-nums" style={{ color: RAIN_BLUE }}>
                {today.rain}% rain
              </span>
            )}
          </>
        )}
        <span aria-hidden className="text-forest-green/40">›</span>
      </span>
    </Link>
  )
}
