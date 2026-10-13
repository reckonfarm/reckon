import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const search = searchParams.get('search')?.trim()
  const state  = searchParams.get('state')?.trim().toUpperCase()
  const lat = Number(searchParams.get('lat')), lon = Number(searchParams.get('lon'))

  const db = createServiceClient()

  // Block 49: ?lat=&lon= → the one county nearest that point (the picker's
  // "Near me"). Counties carry a centroid, not a shape, so this is the closest
  // centroid inside a two-degree box — right for a ranch, and the picker is
  // right there if it is not.
  if (Number.isFinite(lat) && Number.isFinite(lon) && searchParams.has('lat')) {
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return Response.json([])
    const { data, error } = await db.from('counties').select('id, fips, name, state, lat, lon')
      .gte('lat', lat - 1).lte('lat', lat + 1).gte('lon', lon - 1.5).lte('lon', lon + 1.5).limit(200)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []) as { id: number; fips: string; name: string; state: string; lat: number | null; lon: number | null }[]
    const cosLat = Math.cos(lat * Math.PI / 180)
    const best = rows.filter(r => r.lat != null && r.lon != null)
      .map(r => ({ r, d: (r.lat! - lat) ** 2 + ((r.lon! - lon) * cosLat) ** 2 }))
      .sort((a, b) => a.d - b.d)[0]
    return Response.json(best ? [best.r] : [])
  }

  // Require at least one filter — never dump all 3 k+ rows to the client
  if (!search && !state) {
    return Response.json([])
  }

  let query = db
    .from('counties')
    .select('id, fips, name, state, lat, lon')
    .order('name')
    .limit(30)

  if (search) {
    // Numeric input → search FIPS prefix; otherwise search name (case-insensitive)
    if (/^\d+$/.test(search)) {
      query = query.or(`fips.ilike.${search}%,name.ilike.%${search}%`)
    } else {
      query = query.ilike('name', `%${search}%`)
    }
  }

  if (state) {
    query = query.eq('state', state)
  }

  const { data, error } = await query

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json(data ?? [])
}
