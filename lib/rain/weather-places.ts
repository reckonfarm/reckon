import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { live } from '@/lib/ledger-effective'

// ─── Which places earn a row on Weather (Block 7D.4) ──────────────────────────
//
// Weather listed EVERY live place, name-ordered, whether or not anything had
// ever been recorded there — 1,202px of a 3,409px page at 390, 35%, with two of
// five rows reading "no rain recorded yet". A place earns its row now by
// meeting one of three tests:
//
//   · it has a rain reading
//   · it has a device on it
//   · it is PINNED (062)
//
// Everything else moves behind a picker. Nothing is hidden from the ranch —
// only from the list.
//
// WEATHER IS NEVER BLANK. PK's ruling: an empty Weather on day one reads as
// broken, and he is right — a rancher who has just drawn his first place and
// opened Weather would see nothing and conclude the feature does not work.
// Two guards:
//
//   · a ranch's FIRST place is pinned when it is created (app/api/places),
//     so a new ranch qualifies from the moment it has anywhere at all
//   · an EXISTING ranch with no pins and no readings falls back to the place
//     with the most recorded activity — the one it plainly cares about most
//
// The fallback is a last resort, not a rule: it applies only when the
// qualifying set is empty, and it picks by evidence rather than alphabetically,
// so it lands on the home pasture rather than "Audit pen".

export interface WeatherPlace {
  id: string
  name: string
  pinned: boolean
  /** Why it is on the list — shown nowhere, but the reason the row exists. */
  because: 'reading' | 'device' | 'pin' | 'fallback'
}

export interface WeatherPlaces {
  listed: WeatherPlace[]
  /** Live places that did not qualify — the picker's contents. */
  rest: { id: string; name: string }[]
}

interface PlaceRow { id: string; name: string; pinned_at?: string | null }

export async function weatherPlaces(
  supabase: SupabaseClient,
  placeIdsWithReadings: Set<string>,
): Promise<WeatherPlaces> {
  const { data } = await supabase.from('places').select('id, name, pinned_at').is('retired_at', null).order('name')
  const places = ((data ?? []) as unknown as PlaceRow[])
  if (places.length === 0) return { listed: [], rest: [] }

  const { data: devs } = await supabase.from('devices').select('place_id').not('place_id', 'is', null)
  const withDevice = new Set(((devs ?? []) as { place_id: string }[]).map(d => d.place_id))

  const listed: WeatherPlace[] = []
  const rest: { id: string; name: string }[] = []
  for (const p of places) {
    const because: WeatherPlace['because'] | null =
      p.pinned_at ? 'pin' : placeIdsWithReadings.has(p.id) ? 'reading' : withDevice.has(p.id) ? 'device' : null
    if (because) listed.push({ id: p.id, name: p.name, pinned: !!p.pinned_at, because })
    else rest.push({ id: p.id, name: p.name })
  }

  if (listed.length > 0) return { listed, rest }

  // Nothing qualified. Rather than a blank Weather, surface the place with the
  // most recorded activity — the one the ranch plainly uses.
  const busiest = await busiestPlace(supabase, places)
  if (!busiest) return { listed: [], rest }
  return {
    listed: [{ id: busiest.id, name: busiest.name, pinned: false, because: 'fallback' }],
    rest: rest.filter(r => r.id !== busiest.id),
  }
}

/** Most events naming it, across the four untyped payload keys. */
async function busiestPlace(supabase: SupabaseClient, places: PlaceRow[]): Promise<PlaceRow | null> {
  const KEYS = ['place_id', 'from_place_id', 'to_place_id', 'stock_place_id'] as const
  let best: { place: PlaceRow; n: number } | null = null
  for (const p of places) {
    let n = 0
    for (const k of KEYS) {
      const { count } = await live(supabase.from('events').select('id', { count: 'exact', head: true })).eq(`payload->>${k}`, p.id)
      n += count ?? 0
    }
    if (!best || n > best.n) best = { place: p, n }
  }
  // Even with zero activity everywhere, ONE place is better than none: the
  // first by name, which is what `places` is already ordered by.
  return best?.place ?? places[0] ?? null
}
