import 'server-only'

export interface NWSPeriod {
  name: string
  isDaytime: boolean
  temperature: number
  temperatureUnit: string
  shortForecast: string
  detailedForecast: string
  startTime: string
  endTime: string
}

export interface LocalForecast {
  generatedAt: string
  updateTime: string
  periods: NWSPeriod[]
  lat: number
  lon: number
  forecastUrl: string
}

const UA = 'Reckon/1.0 (ranch drought monitor; opensource)'

export async function getLocalForecast(lat: number, lon: number): Promise<LocalForecast | null> {
  try {
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: { 'User-Agent': UA }, cache: 'no-store' },
    )
    if (!pointsRes.ok) return null

    const pointsJson = await pointsRes.json() as {
      properties?: { forecast?: string }
    }
    const forecastUrl = pointsJson?.properties?.forecast
    if (!forecastUrl) return null

    const forecastRes = await fetch(forecastUrl, {
      headers: { 'User-Agent': UA },
      cache: 'no-store',
    })
    if (!forecastRes.ok) return null

    const forecastJson = await forecastRes.json() as {
      properties?: {
        generatedAt?: string
        updateTime?: string
        periods?: Array<{
          name: string
          isDaytime: boolean
          temperature: number
          temperatureUnit: string
          shortForecast: string
          detailedForecast: string
          startTime: string
          endTime: string
        }>
      }
    }
    const props = forecastJson?.properties
    if (!props) return null

    return {
      generatedAt: props.generatedAt ?? '',
      updateTime: props.updateTime ?? '',
      periods: (props.periods ?? []).slice(0, 14),
      lat,
      lon,
      forecastUrl,
    }
  } catch {
    return null
  }
}
