import { createClient } from '@/lib/supabase-server'
import { getHourlyForecast, type LocalForecast } from '@/lib/nws'
import { getRainLedger } from '@/lib/rain/queries'
import type { PrecipNormalResult } from '@/lib/precip-normal'
import { hayingWindow, frostAndSnow, sprayHours, rainAgainstNormal, type Read } from '@/lib/weather/reads'
import Disclosure from '@/app/components/ui/Disclosure'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

// ─── What only we can say (Block 44) ─────────────────────────────────────────
// Four lines under the forecast, in PK's order: rain on my ground this season
// against normal, the haying window, frost and first snow, the hours calm
// enough to spray. Each is a number or a day; the arithmetic is one tap away.
// Nothing new is fetched but NWS's hourly forecast for the same point.

export default async function WeatherReads({ lat, lon, forecastPromise, precipPromise }: { lat: number; lon: number; forecastPromise: Promise<LocalForecast | null>; precipPromise: Promise<PrecipNormalResult> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const [forecast, precip, hours, rain] = await Promise.all([
    forecastPromise.catch(() => null),
    precipPromise.catch(() => null),
    getHourlyForecast(lat, lon).catch(() => null),
    user ? getRainLedger(supabase).catch(() => null) : Promise.resolve(null),
  ])
  const periods = forecast?.periods ?? []
  const normal = precip && typeof precip === 'object' ? precip.ytdNormal : null
  const reads: { key: string; word: string; read: Read }[] = []
  if (rain) reads.push({ key: 'rain', word: 'Rain on my ground', read: rainAgainstNormal(rain.ytd.inches, normal, rain.places.filter(p => p.place_id).length) })
  reads.push({ key: 'haying', word: 'Haying', read: hayingWindow(periods) })
  reads.push({ key: 'frost', word: 'Frost · snow', read: frostAndSnow(periods) })
  reads.push({ key: 'spray', word: 'Spraying', read: sprayHours(hours ?? []) })
  return (
    <section aria-labelledby="wx-reads-h" data-audit="weather-reads">
      <h2 id="wx-reads-h" className={`${EYEBROW} mb-3 !text-ink`}>This week on my ground</h2>
      <Card shadow="none" className="divide-y divide-forest-green/10 px-5 py-1">
        {reads.map(r => (
          <div key={r.key} className="py-3" data-audit={`read-${r.key}`}>
            <p className="font-dm-sans text-[17px] text-ink"><span className="font-semibold">{r.word}</span> · <span data-audit={`read-${r.key}-line`}>{r.read.line}</span></p>
            {r.read.why.length > 0 && (
              <Disclosure title="How" audit={`read-${r.key}-why`} className="mt-1" summary="">
                <ul className="font-dm-sans text-[15px] text-ink">{r.read.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </Disclosure>
            )}
          </div>
        ))}
      </Card>
    </section>
  )
}
