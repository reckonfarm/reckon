import { createClient } from '@/lib/supabase-server'
import { getRanchMap } from '@/lib/ranch-map'
import RanchMapClient from './RanchMapClient'

// ─── Block 26: the ranch map at the top of Today ─────────────────────────────
// A server component inside its own Suspense: Today never waits for it. A
// ranch with no places renders nothing here — there is no picture to draw, and
// an empty map is not information.
export default async function RanchMapCard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const map = await getRanchMap(supabase, user.id).catch(() => null)
  if (!map) return null
  return <RanchMapClient map={map} />
}

/** The space the map will take, held while it loads, so Today does not jump when it arrives. */
export function RanchMapHold() {
  return <div className="mb-6 h-[40vh] min-h-[240px] rounded-xl border border-forest-green/10 bg-cream" aria-hidden data-audit="ranch-map-hold" />
}
