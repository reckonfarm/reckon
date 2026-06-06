import { NextResponse } from 'next/server'

// GET /api/layers/radar — proxied RainViewer radar FRAME LIST (no key).
//
// Mirrors /api/layers/usdm & /api/layers/alerts: AbortController timeout, honest
// output, short cache. Returns just what the client needs to build tile URLs and
// label staleness — the host + the recent frames ({time epoch-seconds, path}).
//
// HONEST output:
//   • success → { host, frames:[{time,path}], error:false }
//   • failure / timeout / bad payload → { host:null, frames:[], error:true }, no-store
// error:true is set ONLY on a real failure, so the map shows "Radar temporarily
// unavailable" rather than a misleading blank/stale frame.

const UA = 'Dryline/1.0 (ranch drought monitor; opensource)' // same contact as lib/nws.ts

export async function GET() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      next: { revalidate: 60 }, // ~60s — frames update ~every 10 min, but keep the list fresh
    })
    if (!res.ok) throw new Error(`RainViewer ${res.status}`)

    const data = await res.json()
    const host = data?.host
    const past = data?.radar?.past
    if (typeof host !== 'string' || !Array.isArray(past) || past.length === 0) {
      throw new Error('RainViewer returned an unexpected payload')
    }

    const frames = (past as Array<{ time: number; path: string }>)
      .filter(f => typeof f?.time === 'number' && typeof f?.path === 'string')
      .map(f => ({ time: f.time, path: f.path }))

    return NextResponse.json(
      { host, frames, error: false },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } },
    )
  } catch {
    return NextResponse.json(
      { host: null, frames: [], error: true },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } finally {
    clearTimeout(timeout)
  }
}
