import { NextResponse } from 'next/server'

// GET /api/layers/ahps — availability probe + "as of" date for the AHPS observed-precip
// raster (NOAA RFC QPE). Mirrors /api/layers/radar: AbortController timeout, honest
// output, short cache. The raster TILES load DIRECTLY from NOAA's export endpoint as
// <img> (same as the radar tiles from RainViewer); this proxy only reports whether the
// service is reachable and the window's ending date, so the map can show an honest
// "temporarily unavailable" instead of a blank-pretending-loaded layer.
//
// HONEST output:
//   • success → { ok:true,  asOf:'YYYY-MM-DD', error:false }
//   • failure / timeout → { ok:false, asOf:null, error:true }, no-store
// error:true is set ONLY on a real failure.

const SERVICE = 'https://mapservices.weather.noaa.gov/raster/rest/services/obs/rfc_qpe/MapServer'
const UA = 'Dryline/1.0 (ranch drought monitor; opensource)'  // same contact as lib/nws.ts

// The "Last N Days Observed" windows are 24h totals ending at 12 UTC on the most recent
// analysis day. Before 12Z the latest complete analysis is yesterday's. Both the 30-day
// and 90-day windows share this same ending date, so the proxy is window-agnostic.
function endingDate(now: Date): string {
  const end = new Date(now)
  if (now.getUTCHours() < 12) end.setUTCDate(end.getUTCDate() - 1)
  return end.toISOString().slice(0, 10)
}

export async function GET() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    // Truest availability test: a tiny 1×1 export of the 30-day Image sublayer (68) — the
    // exact path the client tiles use. If export answers, the layer can render.
    const probe =
      `${SERVICE}/export?bbox=-11131949,4865942,-11119592,4878298` +
      `&bboxSR=3857&imageSR=3857&size=1,1&format=png32&transparent=true&layers=show:68&f=image`
    const res = await fetch(probe, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      next: { revalidate: 3600 }, // ~1h — RFC QPE updates hourly
    })
    if (!res.ok) throw new Error(`AHPS export ${res.status}`)

    return NextResponse.json(
      { ok: true, asOf: endingDate(new Date()), error: false },
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
