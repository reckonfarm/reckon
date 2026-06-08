import { NextResponse } from 'next/server'

// GET /api/layers/outlook — availability + per-horizon issuance for the CPC precip
// OUTLOOK raster (6–10 day + monthly). Mirrors the other layer proxies (timeout, honest
// output, ~1h cache); the raster tiles load directly from NOAA via export. Unlike AHPS/QPF
// (one flat asOf), the two outlook horizons live on different MapServers with different
// issued dates + valid periods, so this returns PER-HORIZON { issued, valid } metadata
// keyed to match the layer's RasterWindow.key ('610' / 'monthly'). RasterLayerView shows
// the active window's entry — and falls back to flat asOf for AHPS/QPF (unchanged).
//
// HONEST output:
//   • success → { ok:true,  error:false, horizons: { '610': {...}, 'monthly': {...} } }
//   • total failure / timeout → { ok:false, error:true }, no-store
// error:true only when BOTH horizon queries fail (a real outage); a partial success still
// renders (the missing horizon just shows its label without a date).

const BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks'
const UA = 'Dryline/1.0 (ranch drought monitor; opensource)'

// fcst_date comes back as epoch ms; keep the date portion for the "issued {date}" stamp.
function isoDate(ms: unknown): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null
}

async function queryOne(
  url: string,
  signal: AbortSignal,
): Promise<{ attributes?: Record<string, unknown> } | null> {
  try {
    const res = await fetch(url, { signal, headers: { 'User-Agent': UA }, next: { revalidate: 3600 } })
    if (!res.ok) return null
    const data = await res.json() as { features?: Array<{ attributes?: Record<string, unknown> }> }
    return data.features?.[0] ?? null
  } catch {
    return null
  }
}

export async function GET() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const [d610, dMonthly] = await Promise.all([
      queryOne(`${BASE}/cpc_6_10_day_outlk/MapServer/1/query?where=1%3D1&outFields=fcst_date&returnGeometry=false&resultRecordCount=1&f=json`, controller.signal),
      queryOne(`${BASE}/cpc_mthly_precip_outlk/MapServer/0/query?where=1%3D1&outFields=fcst_date,valid_seas&returnGeometry=false&resultRecordCount=1&f=json`, controller.signal),
    ])

    const horizons: Record<string, { issued: string | null; valid: string }> = {}
    if (d610) {
      horizons['610'] = { issued: isoDate(d610.attributes?.fcst_date), valid: '6–10 day' }
    }
    if (dMonthly) {
      const seas = dMonthly.attributes?.valid_seas
      horizons['monthly'] = {
        issued: isoDate(dMonthly.attributes?.fcst_date),
        valid: typeof seas === 'string' && seas ? `Monthly (${seas})` : 'Monthly',
      }
    }

    // Both queries failed → a real availability failure (not "no signal").
    if (Object.keys(horizons).length === 0) throw new Error('CPC outlook: both horizon queries failed')

    return NextResponse.json(
      { ok: true, error: false, horizons },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } },
    )
  } catch {
    return NextResponse.json(
      { ok: false, error: true },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } finally {
    clearTimeout(timeout)
  }
}
