import type { NWSPeriod, NWSHour } from '@/lib/nws'
import { RANCH_TZ } from '@/lib/jobs/format'

// ─── What only we can say from the weather we already pull (Block 44) ────────
// Pure reads over the NWS periods and hours: a haying window, frost and snow
// timing, hours calm enough to spray. Each returns the answer AND the
// arithmetic behind it, so the screen can paint the number and keep the
// reasons one tap away. Nothing here calls a service.

const DRY_POP = 20      // a day with at most this chance of rain counts as dry
const HAY_TEMP = 60     // °F — below this the cut does not cure
const FROST = 32
const SPRAY_MPH = 10    // wind at or under this: spray

const dayName = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: RANCH_TZ, weekday: 'short' })
const hourName = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: RANCH_TZ, hour: 'numeric' }).replace(' ', ' ')
const mph = (s: string): number => { const m = s.match(/(\d+)(?:\s*to\s*(\d+))?/); return m ? Number(m[2] ?? m[1]) : 0 }

export interface Read { line: string; why: string[] }

/** The longest run of dry, warm days in the forecast — a cut can cure in it. */
export function hayingWindow(periods: NWSPeriod[]): Read {
  const days = periods.filter(p => p.isDaytime)
  if (days.length === 0) return { line: 'No forecast', why: [] }
  let best: NWSPeriod[] = [], run: NWSPeriod[] = []
  for (const d of days) {
    const dry = (d.precipProbability ?? 0) <= DRY_POP && d.temperature >= HAY_TEMP
    if (dry) run.push(d); else run = []
    if (run.length > best.length) best = [...run]
  }
  const why = days.map(d => `${dayName(d.startTime)}: ${d.temperature}°, ${d.precipProbability ?? 0}% rain${(d.precipProbability ?? 0) <= DRY_POP && d.temperature >= HAY_TEMP ? ' — dry' : ''}`)
  why.push(`A dry day is ${DRY_POP}% rain or less and ${HAY_TEMP}° or warmer.`)
  if (best.length < 3) return { line: best.length === 0 ? 'No dry day in the next week' : `${best.length} dry ${best.length === 1 ? 'day' : 'days'} at most, not a window`, why }
  return { line: `${dayName(best[0].startTime)}–${dayName(best[best.length - 1].startTime)} · ${best.length} dry days`, why }
}

/** The first night at or under freezing, and the first period that names snow. */
export function frostAndSnow(periods: NWSPeriod[]): Read {
  if (periods.length === 0) return { line: 'No forecast', why: [] }
  const frost = periods.find(p => !p.isDaytime && p.temperature <= FROST) ?? null
  const snow = periods.find(p => /snow/i.test(p.shortForecast)) ?? null
  const nights = periods.filter(p => !p.isDaytime).map(p => `${p.name}: ${p.temperature}°`)
  const why = [...nights, `Frost is ${FROST}° or under; snow is the forecast's own word.`]
  const parts: string[] = []
  parts.push(frost ? `Frost ${frost.name.toLowerCase()} · ${frost.temperature}°` : 'No frost in the next week')
  parts.push(snow ? `Snow ${snow.name.toLowerCase()}` : 'No snow')
  return { line: parts.join(' · '), why }
}

/** Today's hours calm enough to spray, as ranges. */
export function sprayHours(hours: NWSHour[]): Read {
  if (hours.length === 0) return { line: 'No hourly forecast', why: [] }
  const today = hours.slice(0, 24)
  const calm = today.map(h => ({ h, ok: mph(h.windSpeed) <= SPRAY_MPH }))
  const ranges: string[] = []
  let start: NWSHour | null = null, last: NWSHour | null = null
  for (const c of calm) {
    if (c.ok) { if (!start) start = c.h; last = c.h }
    else if (start && last) { ranges.push(`${hourName(start.startTime)}–${hourName(last.endTime)}`); start = null; last = null }
  }
  if (start && last) ranges.push(`${hourName(start.startTime)}–${hourName(last.endTime)}`)
  const why = today.map(h => `${hourName(h.startTime)}: ${h.windSpeed}${h.windDirection ? ` ${h.windDirection}` : ''}`)
  why.push(`Calm is ${SPRAY_MPH} mph or under.`)
  return { line: ranges.length ? `${ranges.join(', ')} under ${SPRAY_MPH} mph` : `Nothing under ${SPRAY_MPH} mph today`, why }
}

/** Recorded rain this season on the ranch's places against the county normal to date. */
export function rainAgainstNormal(recordedYtd: number, normalYtd: number | null, placesCounted: number): Read {
  const rec = `${recordedYtd.toFixed(2)}"`
  if (normalYtd == null) return { line: `${rec} recorded · normal unknown`, why: [`Recorded on ${placesCounted} ${placesCounted === 1 ? 'place' : 'places'} this season.`, 'No normal for the county to date.'] }
  const diff = recordedYtd - normalYtd
  return {
    line: `${rec} recorded · ${normalYtd.toFixed(2)}" normal · ${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)}"`,
    why: [`Recorded on ${placesCounted} ${placesCounted === 1 ? 'place' : 'places'} this season, added up.`, `Normal is the county's 30-year normal to today's date (NOAA / ACIS).`, `${rec} − ${normalYtd.toFixed(2)}" = ${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)}"`],
  }
}
