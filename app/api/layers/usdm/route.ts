import { NextResponse } from 'next/server'

// Current-week U.S. Drought Monitor polygons (D0–D4) from the official USDM
// ArcGIS FeatureServer, generalized (~2 km tolerance) to ~290 KB so the client
// isn't pulling the ~6.4 MB full-resolution file. The `DM` property on each
// feature is the drought category (0=D0 … 4=D4); `ReleaseDate` is epoch ms.
//
// First entry in the Regional-map layer registry (the 'vector' archetype proxy).
// /api/usdm is kept as a thin alias of this route for the hay map.
const USDM_URL =
  'https://services5.arcgis.com/0OTVzJS4K09zlixn/arcgis/rest/services/USDM_current/FeatureServer/0/query' +
  '?where=1%3D1&outFields=DM,ReleaseDate&f=geojson&returnGeometry=true&maxAllowableOffset=0.02'

// GET /api/layers/usdm — proxied + cached USDM drought GeoJSON.
// Cached 6h (USDM releases weekly on Thursdays) and edge-cached via Cache-Control.
// On upstream failure/slowness, returns an empty FeatureCollection with error:true
// (not cached) so the map can show a "layer unavailable" note instead of implying
// no drought — the pins still render either way.
export async function GET() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(USDM_URL, {
      signal: controller.signal,
      next: { revalidate: 21600 }, // 6 hours
    })
    if (!res.ok) throw new Error(`USDM upstream ${res.status}`)

    const geo = await res.json()
    if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
      throw new Error('USDM returned an unexpected payload')
    }

    const releaseDate = geo.features[0]?.properties?.ReleaseDate ?? null
    return NextResponse.json(
      { type: 'FeatureCollection', features: geo.features, releaseDate },
      { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' } },
    )
  } catch {
    return NextResponse.json(
      { type: 'FeatureCollection', features: [], error: true },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } finally {
    clearTimeout(timeout)
  }
}
