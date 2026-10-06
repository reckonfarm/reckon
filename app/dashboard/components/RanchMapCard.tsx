import { Suspense } from 'react'
import { createClient } from '@/lib/supabase-server'
import { getRanchMap } from '@/lib/ranch-map'
import { getChangesSince } from '@/lib/since'
import RanchMapClient from './RanchMapClient'
import WeatherStrip from './WeatherStrip'
import { entriesToday } from '@/lib/activity'

// ─── Block 26: the ranch map at the top of Today ─────────────────────────────
// A server component inside its own Suspense: Today never waits for it. A
// ranch with no places renders nothing here — there is no picture to draw, and
// an empty map is not information.
export default async function RanchMapCard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const [map, since, todayCount] = await Promise.all([getRanchMap(supabase, user.id).catch(() => null), getChangesSince(supabase, user.id).catch(() => null), entriesToday(supabase).catch(() => 0)])
  if (!map) return null
  // Block 39: the map, one line under it, and the weather strip — nothing else between the map and the record.
  return (
    <>
      <RanchMapClient map={map} changes={since?.changes ?? []} total={since?.total ?? 0} newest={since?.newest ?? null} todayCount={todayCount} />
      {/* Block A: the forecast is NWS's, not the ranch's. Its own boundary, so the
          map never waits for it, and its own held space, so the record below
          does not move when it lands — or never does. */}
      <Suspense fallback={<WeatherStripHold />}><WeatherStrip lat={map.centre.lat} lng={map.centre.lng} /></Suspense>
    </>
  )
}

/** The space the map will take, held while it loads, so Today does not jump when it arrives. */
export function RanchMapHold() {
  return <div className="mb-6 h-[40vh] min-h-[240px] rounded-xl border border-forest-green/10 bg-cream" aria-hidden data-audit="ranch-map-hold" />
}

/** The strip's painted box (64.5 px at 390 wide, measured 2026-10-06), held until NWS answers or fails. */
export function WeatherStripHold() {
  return <div className="-mt-3 mb-6 h-[64.5px] rounded-xl border border-forest-green/10 bg-white" aria-hidden data-audit="weather-strip-hold" />
}
