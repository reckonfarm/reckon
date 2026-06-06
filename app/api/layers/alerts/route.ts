import { NextResponse, type NextRequest } from 'next/server'

// GET /api/layers/alerts?area=ST — proxied NWS active severe-weather alerts as GeoJSON.
//
// Mirrors /api/layers/usdm (the 'vector' registry proxy): AbortController timeout,
// honest output, short cache. NWS-specific: the required User-Agent (the app's
// existing NWS contact string, matching lib/nws.ts) and a SHORT cache — alerts
// change minute-to-minute, unlike the weekly USDM release.
//
// HONEST THREE-STATE CONTRACT (the make-or-break):
//   • success, alerts present → { features:[…drawable only…], error:false }
//   • success, NWS returned zero → { features:[], error:false }   ← honest EMPTY, NOT error
//   • fetch fail / timeout / bad payload → { features:[], error:true }, no-store
// error:true is set ONLY on a real fetch failure — a legitimately empty result
// (a quiet day) is never an error, so the map can show a reassuring "No active alerts"
// instead of a false "unavailable".
//
// Only polygon-bearing alerts are DRAWABLE; many NWS alerts are zone-based with
// geometry:null (they reference affectedZones, not an inline polygon) — those are
// filtered out so the count + draw reflect what's actually on the map.

const UA = 'Dryline/1.0 (ranch drought monitor; opensource)' // same contact as lib/nws.ts

const honestEmpty = () =>
  NextResponse.json(
    { type: 'FeatureCollection', features: [], error: false },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )

export async function GET(request: NextRequest) {
  const area = (request.nextUrl.searchParams.get('area') ?? '').toUpperCase()
  // Missing/invalid area → nothing to ask NWS for. Honest-empty (no alerts to show),
  // NOT an error — there's no upstream failure here.
  if (!/^[A-Z]{2}$/.test(area)) return honestEmpty()

  const url = `https://api.weather.gov/alerts/active?area=${area}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
      next: { revalidate: 90 }, // ~90s — alerts move fast
    })
    if (!res.ok) throw new Error(`NWS alerts upstream ${res.status}`)

    const geo = await res.json()
    if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
      throw new Error('NWS alerts returned an unexpected payload')
    }

    // Drawable = has inline geometry; zone-only alerts (geometry:null) are excluded.
    const features = (geo.features as Array<{ geometry: unknown }>).filter(f => f.geometry != null)

    return NextResponse.json(
      { type: 'FeatureCollection', features, error: false },
      { headers: { 'Cache-Control': 'public, s-maxage=90, stale-while-revalidate=300' } },
    )
  } catch {
    // Real fetch failure → honest-degraded, never cached as success.
    return NextResponse.json(
      { type: 'FeatureCollection', features: [], error: true },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } finally {
    clearTimeout(timeout)
  }
}
