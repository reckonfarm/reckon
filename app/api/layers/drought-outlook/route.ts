import { NextResponse } from 'next/server'

// GET /api/layers/drought-outlook — availability + per-horizon issuance for the CPC
// DROUGHT outlook raster (monthly L1 + seasonal L4 on cpc_drought_outlk). Mirrors the
// other layer proxies (timeout, honest output, ~1h cache); the raster tiles load directly
// from NOAA via export. Returns PER-HORIZON { issued, valid } keyed to the layer's
// RasterWindow.key ('monthly' / 'seasonal'); RasterLayerView shows the active window's.
//
// NOTE: unlike the precip outlooks (fcst_date = epoch ms), the drought outlook's fcst_date
// is an "MM/DD/YYYY" string, and `target` is "Jun 2026" (monthly) / "August 31" (seasonal
// through-date). Parsed accordingly below.
//
// HONEST output:
//   • success → { ok:true, error:false, horizons: { monthly:{...}, seasonal:{...} } }
//   • total failure / timeout → { ok:false, error:true }, no-store  (only when BOTH fail)

const BASE = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_drought_outlk/MapServer'
const UA = 'Dryline/1.0 (ranch drought monitor; opensource)'

// "05/31/2026" → "2026-05-31" (the view formats it for display).
function isoFromMDY(s: unknown): string | null {
  if (typeof s !== 'string') return null
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null
}

// "August 31" → "Aug 31" (keep the seasonal through-date short for the compact legend).
function shortTarget(s: unknown): string | null {
  if (typeof s !== 'string' || !s) return null
  const [month, ...rest] = s.split(' ')
  return [month.slice(0, 3), ...rest].join(' ')
}

async function queryOne(url: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal, headers: { 'User-Agent': UA }, next: { revalidate: 3600 } })
    if (!res.ok) return null
    const data = await res.json() as { features?: Array<{ attributes?: Record<string, unknown> }> }
    return data.features?.[0]?.attributes ?? null
  } catch {
    return null
  }
}

export async function GET() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const fields = 'outFields=fcst_date,target&returnGeometry=false&resultRecordCount=1&f=json'
    const [monthly, seasonal] = await Promise.all([
      queryOne(`${BASE}/1/query?where=1%3D1&${fields}`, controller.signal),
      queryOne(`${BASE}/4/query?where=1%3D1&${fields}`, controller.signal),
    ])

    const horizons: Record<string, { issued: string | null; valid: string }> = {}
    if (monthly) {
      const t = monthly.target
      horizons['monthly'] = {
        issued: isoFromMDY(monthly.fcst_date),
        valid: typeof t === 'string' && t ? `Monthly (${t})` : 'Monthly',
      }
    }
    if (seasonal) {
      const t = shortTarget(seasonal.target)
      horizons['seasonal'] = {
        issued: isoFromMDY(seasonal.fcst_date),
        valid: t ? `Seasonal (thru ${t})` : 'Seasonal',
      }
    }

    // Both queries failed → a real availability failure.
    if (Object.keys(horizons).length === 0) throw new Error('CPC drought outlook: both horizon queries failed')

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
