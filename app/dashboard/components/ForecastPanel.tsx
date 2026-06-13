'use client'

import { useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import WeatherGlyph, { WindGlyph } from './WeatherGlyph'
import type { LocalForecast, NWSPeriod } from '@/lib/nws'

// Rain-chance accent — the same water-blue used by the rain-event markers on the
// rainfall graph, so "chance of rain" reads consistently across the weather view.
const RAIN_BLUE = '#2563EB'

// Condition class iconFor() resolves to; WeatherGlyph paints each as a custom brand SVG.
export type IconKind = 'sun' | 'partly' | 'cloud' | 'rain' | 'snow' | 'storm'

function iconFor(short: string): IconKind {
  const t = short.toLowerCase()
  if (/thunder|tstm|storm/.test(t)) return 'storm'
  if (/snow|flurr|sleet|ice|wintry|blizzard/.test(t)) return 'snow'
  if (/rain|shower|drizzle/.test(t)) return 'rain'
  if (/partly|mostly sunny|partly sunny|few clouds/.test(t)) return 'partly'
  if (/cloud|overcast/.test(t)) return 'cloud'
  if (/sun|clear|fair/.test(t)) return 'sun'
  return 'cloud'
}

interface DayRow {
  dateKey:     string
  label:       string
  date:        string        // calendar date, e.g. "Jun 9"
  high:        number | null
  low:         number | null
  precip:      number | null   // % chance — the hero field (max across the day's periods)
  windMph:     number | null   // sustained upper bound (mph), max across the day's periods
  iconKind:    IconKind
  detailDay:   string
  detailNight: string
}

// NWS returns windSpeed as a string — either a single value ("15 mph") or a range
// ("10 to 15 mph"). We want the SUSTAINED UPPER BOUND, which is the last integer in the
// string. Returns null when nothing parses (empty/absent), so cards stay honest.
function parseWindUpper(windSpeed: string): number | null {
  const nums = windSpeed.match(/\d+/g)
  if (!nums || nums.length === 0) return null
  return Number(nums[nums.length - 1])
}

// Pair the 14 day/night periods into ≤7 per-day rows: daytime period → high + conditions,
// its night period → low. Handles the leading "Tonight"-only edge (an afternoon load can
// start on a night period) by borrowing conditions/icon from the night and labeling it
// "Tonight". precip headline = the max chance across the day's periods.
function buildDays(periods: NWSPeriod[]): DayRow[] {
  const map = new Map<string, DayRow>()
  const order: string[] = []
  for (const p of periods) {
    const dateKey = (p.startTime || '').slice(0, 10)
    if (!dateKey) continue
    let row = map.get(dateKey)
    if (!row) {
      row = { dateKey, label: '', date: '', high: null, low: null, precip: null, windMph: null, iconKind: 'cloud', detailDay: '', detailNight: '' }
      map.set(dateKey, row)
      order.push(dateKey)
    }
    if (p.isDaytime) {
      row.high = p.temperature
      row.iconKind = iconFor(p.shortForecast)
      row.detailDay = p.detailedForecast
    } else {
      row.low = p.temperature
      row.detailNight = p.detailedForecast
      if (row.high == null) row.iconKind = iconFor(p.shortForecast)  // leading night-only
    }
    if (p.precipProbability != null) {
      row.precip = row.precip == null ? p.precipProbability : Math.max(row.precip, p.precipProbability)
    }
    const windUpper = parseWindUpper(p.windSpeed)
    if (windUpper != null) {
      row.windMph = row.windMph == null ? windUpper : Math.max(row.windMph, windUpper)
    }
  }
  const rows = order.map(k => map.get(k)!)
  rows.forEach((r, i) => {
    const d = new Date(`${r.dateKey}T12:00:00`)
    r.label = i === 0
      ? (r.high != null ? 'Today' : 'Tonight')
      : d.toLocaleDateString('en-US', { weekday: 'short' })
    r.date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  })
  return rows.slice(0, 7)
}

function UnavailableCard() {
  return (
    <Card className="p-4 sm:p-6">
      <p className="text-sm text-forest-green/50 font-dm-sans">
        Forecast temporarily unavailable — check back shortly.
      </p>
    </Card>
  )
}

export default function ForecastPanel({ data }: { data: LocalForecast | null }) {
  const [open, setOpen] = useState<number | null>(null)

  // Honest-degraded: null (fetch failed/timed out) or no usable periods → unavailable.
  if (!data) return <UnavailableCard />
  const days = buildDays(data.periods)
  if (days.length === 0) return <UnavailableCard />

  const updated = data.updateTime
    ? new Date(data.updateTime).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null

  return (
    <Card className="p-4 sm:p-5">
      {/* Horizontal swipe carousel — one row tall, scrolls sideways on touch. */}
      <div className="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory [-webkit-overflow-scrolling:touch]">
        {days.map((d, i) => {
          const isOpen = open === i
          const hasRain = d.precip != null && d.precip > 0
          const isWindy = d.windMph != null && d.windMph > 15
          return (
            <button
              key={d.dateKey}
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-pressed={isOpen}
              className={`relative snap-start shrink-0 w-[64px] rounded-xl border px-1.5 py-2 text-center transition-colors ${
                isOpen ? 'border-forest-green/40 bg-forest-green/5' : 'border-forest-green/10 hover:bg-forest-green/5'
              }`}
            >
              {/* Wind badge — top-right corner, only on periods over 15 mph sustained.
                  Absolutely positioned so no-wind cards keep their exact stacked layout.
                  Forest-green + muted: it's spray-planning context, not an alarm. */}
              {isWindy && (
                <span
                  className="pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 font-dm-sans text-[9px] font-semibold leading-none text-forest-green/60"
                  title={`Wind to ${d.windMph} mph`}
                >
                  <WindGlyph size={12} />
                  {d.windMph}
                </span>
              )}
              <div className="text-[11px] font-dm-sans font-semibold leading-tight text-forest-green/70">{d.label}</div>
              <div className="text-[9px] font-dm-sans leading-tight text-forest-green/40">{d.date}</div>
              <div className="my-1 flex justify-center leading-none"><WeatherGlyph kind={d.iconKind} /></div>
              {/* Hero: % chance of rain — the field a rancher reads first. */}
              <div
                className="font-dm-sans text-lg font-bold leading-none"
                style={{ color: hasRain ? RAIN_BLUE : 'rgba(27,67,50,0.35)' }}
              >
                {d.precip != null ? `${d.precip}%` : '—'}
              </div>
              <div className="mt-1.5 font-dm-sans text-[11px] text-forest-green">
                {d.high != null ? `${d.high}°` : '—'}
                <span className="text-forest-green/40"> / {d.low != null ? `${d.low}°` : '—'}</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Detail-on-demand: tapping a day reveals NWS's prose for that day (kept hidden
          by default so the strip stays compact). */}
      {open != null && days[open] && (
        <div className="mt-3 rounded-lg border border-forest-green/10 bg-[#FDFBF7] px-3 py-2">
          <p className="font-dm-sans text-xs font-semibold text-forest-green">{days[open].label}</p>
          {days[open].detailDay && (
            <p className="mt-1 font-dm-sans text-xs leading-relaxed text-forest-green/70">{days[open].detailDay}</p>
          )}
          {days[open].detailNight && (
            <p className="mt-1 font-dm-sans text-xs leading-relaxed text-forest-green/50">
              <span className="font-medium">Overnight: </span>{days[open].detailNight}
            </p>
          )}
        </div>
      )}

      {/* Visible freshness stamp (the never-lie rule), honest about precision: this is
          NWS's gridpoint forecast for the county CENTER, not a specific ranch. One line,
          small, so it doesn't bloat the compact card. */}
      <p className="mt-3 truncate font-dm-sans text-[10px] text-forest-green/40">
        NWS · county center{updated ? ` · updated ${updated}` : ''}
      </p>
    </Card>
  )
}
