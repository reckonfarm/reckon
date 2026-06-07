import 'server-only'
import { timeoutSignal } from './external-fetch'

export interface NWSPeriod {
  name: string
  isDaytime: boolean
  temperature: number
  temperatureUnit: string
  shortForecast: string
  detailedForecast: string
  startTime: string
  endTime: string
  // Parsed for the 7-day county forecast card. The NWS /forecast response carries
  // these per period, but they used to be dropped — precipProbability is the field a
  // rancher reads first, so it's the must-have; wind is cheap context for spraying.
  precipProbability: number | null   // probabilityOfPrecipitation.value (%), null when absent
  windSpeed: string                  // e.g. "10 mph" (NWS returns it as a string)
  windDirection: string              // e.g. "NW"
}

export interface LocalForecast {
  generatedAt: string
  updateTime: string
  periods: NWSPeriod[]
  lat: number
  lon: number
  forecastUrl: string
}

const UA = 'Dryline/1.0 (ranch drought monitor; opensource)'

// NWS raw forecast period (api.weather.gov /forecast). probabilityOfPrecipitation is
// an object with a nullable numeric value; wind comes back as strings.
interface RawPeriod {
  name?: string
  isDaytime?: boolean
  temperature?: number
  temperatureUnit?: string
  shortForecast?: string
  detailedForecast?: string
  startTime?: string
  endTime?: string
  probabilityOfPrecipitation?: { value?: number | null }
  windSpeed?: string
  windDirection?: string
}

export async function getLocalForecast(lat: number, lon: number): Promise<LocalForecast | null> {
  try {
    // The point→office lookup is effectively static for a given county centroid, so
    // cache it a week. timeoutSignal() turns a hung NWS host into a catchable reject
    // (the lib already degrades a failure to null; this just stops it blocking render).
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: { 'User-Agent': UA }, signal: timeoutSignal(), next: { revalidate: 604800 } },
    )
    if (!pointsRes.ok) return null

    const pointsJson = await pointsRes.json() as {
      properties?: { forecast?: string }
    }
    const forecastUrl = pointsJson?.properties?.forecast
    if (!forecastUrl) return null

    // The forecast itself updates ~hourly; revalidate at 1h so we don't hammer NWS.
    const forecastRes = await fetch(forecastUrl, {
      headers: { 'User-Agent': UA },
      signal: timeoutSignal(),
      next: { revalidate: 3600 },
    })
    if (!forecastRes.ok) return null

    const forecastJson = await forecastRes.json() as {
      properties?: {
        generatedAt?: string
        updateTime?: string
        periods?: RawPeriod[]
      }
    }
    const props = forecastJson?.properties
    if (!props) return null

    const periods: NWSPeriod[] = (props.periods ?? []).slice(0, 14).map(p => ({
      name:              p.name ?? '',
      isDaytime:         p.isDaytime ?? true,
      temperature:       p.temperature ?? 0,
      temperatureUnit:   p.temperatureUnit ?? 'F',
      shortForecast:     p.shortForecast ?? '',
      detailedForecast:  p.detailedForecast ?? '',
      startTime:         p.startTime ?? '',
      endTime:           p.endTime ?? '',
      precipProbability: p.probabilityOfPrecipitation?.value ?? null,
      windSpeed:         p.windSpeed ?? '',
      windDirection:     p.windDirection ?? '',
    }))

    return {
      generatedAt: props.generatedAt ?? '',
      updateTime: props.updateTime ?? '',
      periods,
      lat,
      lon,
      forecastUrl,
    }
  } catch {
    return null
  }
}
