import { NextResponse } from 'next/server'

// GET /api/layers/qpf — availability probe + real issuance date for the WPC QPF
// forecast-precip raster. Mirrors /api/layers/ahps (AbortController timeout, honest
// output, short cache); the raster TILES load directly from NOAA's export endpoint as
// <img>. Unlike AHPS (which computes a 12Z ending date), QPF carries a true issue_time
// field, so this queries one feature for it — honest forecast framing ("issued {date}").
//
// HONEST output:
//   • success → { ok:true,  asOf:'YYYY-MM-DD', error:false }   (asOf = real issue date)
//   • failure / timeout → { ok:false, asOf:null, error:true }, no-store
// error:true is set ONLY on a real failure.

const SERVICE = 'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer'
const UA = 'Dryline/1.0 (ranch drought monitor; opensource)'  // same contact as lib/nws.ts

export async function GET() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    // One small query on the Day-1–7 layer (11) for the WPC issuance time. This both
    // confirms the service is reachable AND gives the honest forecast timestamp.
    const url =
      `${SERVICE}/11/query?where=1%3D1&outFields=issue_time` +
      `&returnGeometry=false&resultRecordCount=1&f=json`
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      next: { revalidate: 3600 }, // ~1h — WPC issues QPF roughly every 6h
    })
    if (!res.ok) throw new Error(`WPC QPF query ${res.status}`)

    const data = await res.json() as { features?: Array<{ attributes?: { issue_time?: string } }> }
    // issue_time looks like "2026-06-07 21:03:57"; keep the date portion.
    const issue = data.features?.[0]?.attributes?.issue_time
    const asOf = typeof issue === 'string' && issue.length >= 10 ? issue.slice(0, 10) : null
    if (!asOf) throw new Error('WPC QPF returned no issue_time')

    return NextResponse.json(
      { ok: true, asOf, error: false },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } },
    )
  } catch {
    return NextResponse.json(
      { ok: false, asOf: null, error: true },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } finally {
    clearTimeout(timeout)
  }
}
