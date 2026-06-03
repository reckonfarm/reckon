import type { NextRequest } from 'next/server'
import { fetchAndStoreDroughtData } from '@/lib/drought-service'
import { storeOfficialMaps } from '@/lib/maps-service'
import { storeForecastOutlooks } from '@/lib/forecast-service'
import { checkAndSendAlerts } from '@/lib/alert-service'
import { checkHayMatchAlerts } from '@/lib/hay-service'
import { captureLfpSnapshots } from '@/lib/lfp-snapshot'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Step 1 — drought data must succeed; weekDate feeds everything else
    const droughtResult = await fetchAndStoreDroughtData()

    // Step 2 — maps, forecasts, alerts, hay-match, and LFP snapshot capture run in
    // parallel; failures are non-fatal. All depend only on drought_data being fresh
    // (Step 1, already awaited) and reuse the same weekDate.
    const [mapsSettled, forecastSettled, alertsSettled, hayMatchSettled, snapshotSettled] = await Promise.allSettled([
      storeOfficialMaps(droughtResult.weekDate),
      storeForecastOutlooks(),
      checkAndSendAlerts(droughtResult.weekDate),
      checkHayMatchAlerts(droughtResult.weekDate),
      // Decoupled LFP capture: calls the audited engine per active county, stores its output.
      captureLfpSnapshots(droughtResult.weekDate),
    ])

    const maps = mapsSettled.status === 'fulfilled'
      ? { ok: true, ...mapsSettled.value }
      : { ok: false, error: mapsSettled.reason instanceof Error ? mapsSettled.reason.message : String(mapsSettled.reason) }

    const forecast = forecastSettled.status === 'fulfilled'
      ? { ok: true, ...forecastSettled.value }
      : { ok: false, error: forecastSettled.reason instanceof Error ? forecastSettled.reason.message : String(forecastSettled.reason) }

    const alerts = alertsSettled.status === 'fulfilled'
      ? { ok: true, ...alertsSettled.value }
      : { ok: false, error: alertsSettled.reason instanceof Error ? alertsSettled.reason.message : String(alertsSettled.reason) }

    const hayMatch = hayMatchSettled.status === 'fulfilled'
      ? { ok: true, ...hayMatchSettled.value }
      : { ok: false, error: hayMatchSettled.reason instanceof Error ? hayMatchSettled.reason.message : String(hayMatchSettled.reason) }

    const snapshot = snapshotSettled.status === 'fulfilled'
      ? { ok: true, ...snapshotSettled.value }
      : { ok: false, error: snapshotSettled.reason instanceof Error ? snapshotSettled.reason.message : String(snapshotSettled.reason) }

    return Response.json({ ok: true, drought: droughtResult, maps, forecast, alerts, hayMatch, snapshot })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
