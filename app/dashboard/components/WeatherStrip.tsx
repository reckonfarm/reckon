import { getLocalForecast, type NWSPeriod } from '@/lib/nws'
import { sunTimesLocal } from '@/lib/sun'
import { RANCH_TZ } from '@/lib/jobs/format'

// ─── The weather strip under the map (Block 39) ──────────────────────────────
// Six numbers a person reads before going out: today's high and low, the
// chance of rain, the wind, sunrise and sunset. The forecast is NWS for the
// ranch's own point (the map's centre — drawn ground, else the last positioned
// record, else the county). Sunrise and sunset are computed from those
// coordinates, no service, so they are right with no signal. Nothing here
// explains itself: a number, and the one word that names it.

const fmtClock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: RANCH_TZ, hour: 'numeric', minute: '2-digit' }).replace(' ', ' ') : '—'

function today(periods: NWSPeriod[]): { high: number | null; low: number | null; rain: number | null; wind: string | null } {
  // The periods start now: the first daytime period is today's high, the first night period tonight's low.
  const day = periods.find(p => p.isDaytime) ?? null
  const night = periods.find(p => !p.isDaytime) ?? null
  const first = periods[0] ?? null
  const rain = periods.slice(0, 2).reduce<number | null>((m, p) => p.precipProbability == null ? m : Math.max(m ?? 0, p.precipProbability), null)
  const wind = first ? `${first.windSpeed.replace(/ to /, '–').replace(/ mph/, '')}${first.windDirection ? ` ${first.windDirection}` : ''}`.trim() : null
  return { high: day?.temperature ?? null, low: night?.temperature ?? null, rain, wind: wind || null }
}

export default async function WeatherStrip({ lat, lng }: { lat: number; lng: number }) {
  const forecast = await getLocalForecast(lat, lng).catch(() => null)
  const t = today(forecast?.periods ?? [])
  const sun = sunTimesLocal(lat, lng, new Date(), RANCH_TZ)
  const cells: { word: string; value: string; audit: string }[] = [
    { word: 'High', value: t.high == null ? '—' : `${t.high}°`, audit: 'high' },
    { word: 'Low', value: t.low == null ? '—' : `${t.low}°`, audit: 'low' },
    { word: 'Rain', value: t.rain == null ? '—' : `${t.rain}%`, audit: 'rain' },
    { word: 'Wind', value: t.wind ?? '—', audit: 'wind' },
    { word: 'Sunrise', value: fmtClock(sun.sunrise), audit: 'sunrise' },
    { word: 'Sunset', value: fmtClock(sun.sunset), audit: 'sunset' },
  ]
  return (
    <div className="-mt-3 mb-6 grid grid-cols-6 gap-1 rounded-xl border border-forest-green/10 bg-white px-2 py-2" data-audit="weather-strip" data-source={forecast ? 'nws' : 'none'}>
      {cells.map(c => (
        <div key={c.audit} className="min-w-0 text-center">
          <p className="truncate font-dm-sans text-[17px] font-semibold tabular-nums text-ink" data-audit={`weather-${c.audit}`}>{c.value}</p>
          <p className="font-dm-sans text-[12px] uppercase tracking-wide text-secondary-ink">{c.word}</p>
        </div>
      ))}
    </div>
  )
}
