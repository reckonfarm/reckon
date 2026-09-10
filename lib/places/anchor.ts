import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase'
import { getRanch } from '@/lib/ranch-membership'
import { ringFromGeoJSON, type LatLng } from '@/lib/places/geo'

// ─── Where the map opens ──────────────────────────────────────────────────────
//
// A draw surface has to start somewhere, and on a phone in a field the
// difference between the right somewhere and a state-level view is several
// minutes of panning. Four answers, best first, each one a real fact about
// this outfit rather than a guess:
//
//   1. Ground already drawn — the centre of every shape this ranch has.
//   2. The last positioned thing that happened — the most recent event
//      carrying a fix. On Kiehl Ranch that is a Scout impact from the last
//      cutting day, which is the ranch's actual working ground, ~22 km from
//      the county centroid.
//   3. The home county's centroid.
//   4. Montana. Honest last resort, and the operator pans.
//
// Steps 1 and 2 run on the CALLER'S user-scoped client, so the membership
// policies are the scope and nothing here can see another outfit's ground.
// Step 3 needs `counties`, which is service-role-only reference data (a public
// county centroid, no user data) — the same shape /api/home-county uses.
// Never throws: every step degrades to the next.

export const MONTANA_CENTRE: LatLng = { lat: 46.9, lng: -110.0 }

function centreOf(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null
  const lats = points.map(p => p.lat), lngs = points.map(p => p.lng)
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  }
}

export async function resolveMapCentre(
  supabase: SupabaseClient,
  userId: string,
  drawnRings: LatLng[][],
): Promise<LatLng> {
  // 1 — ground already drawn.
  const drawn = centreOf(drawnRings.flat())
  if (drawn) return drawn

  // 2 — the last positioned thing that happened here.
  try {
    const { data } = await supabase
      .from('events')
      .select('lat, lng')
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .order('ts', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lat = (data as { lat?: unknown } | null)?.lat
    const lng = (data as { lng?: unknown } | null)?.lng
    if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng }
  } catch { /* fall through */ }

  // 3 — the home county's centroid.
  try {
    const ranch = await getRanch(supabase, userId)
    if (ranch) {
      const svc = createServiceClient()
      const { data: r } = await svc.from('ranches').select('home_county_fips').eq('id', ranch.id).maybeSingle()
      const fips = (r as { home_county_fips?: unknown } | null)?.home_county_fips
      if (typeof fips === 'string' && fips) {
        const { data: c } = await svc.from('counties').select('lat, lon').eq('fips', fips).maybeSingle()
        const lat = (c as { lat?: unknown } | null)?.lat
        const lon = (c as { lon?: unknown } | null)?.lon
        if (typeof lat === 'number' && typeof lon === 'number') return { lat, lng: lon }
      }
    }
  } catch { /* fall through */ }

  // 4 — Montana.
  return MONTANA_CENTRE
}

/** The stored shape as a ring, or null when the place is undrawn. */
export function placeRing(geometry: unknown): LatLng[] | null {
  const ring = ringFromGeoJSON(geometry)
  return ring && ring.length >= 4 ? ring : null
}
