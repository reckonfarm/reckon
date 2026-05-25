import type { NextRequest } from 'next/server'
import { fetchAndStoreDroughtData } from '@/lib/drought-service'
import { storeOfficialMaps } from '@/lib/maps-service'
import { storeForecastOutlooks } from '@/lib/forecast-service'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Step 1 — drought data must succeed; weekDate feeds into storeOfficialMaps
    const droughtResult = await fetchAndStoreDroughtData()

    // Step 2 — maps + forecasts run in parallel; failures are non-fatal
    const [mapsSettled, forecastSettled] = await Promise.allSettled([
      storeOfficialMaps(droughtResult.weekDate),
      storeForecastOutlooks(),
    ])

    const maps = mapsSettled.status === 'fulfilled'
      ? { ok: true, ...mapsSettled.value }
      : { ok: false, error: mapsSettled.reason instanceof Error ? mapsSettled.reason.message : String(mapsSettled.reason) }

    const forecast = forecastSettled.status === 'fulfilled'
      ? { ok: true, ...forecastSettled.value }
      : { ok: false, error: forecastSettled.reason instanceof Error ? forecastSettled.reason.message : String(forecastSettled.reason) }

    return Response.json({ ok: true, drought: droughtResult, maps, forecast })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
