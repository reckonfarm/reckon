import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getRanchLots } from '@/lib/herd-lots'
import { whereByLot, seenByLot } from '@/lib/ranch-summary'
import { placeRows } from '@/lib/places/rows'
import { resolveMapCentre } from '@/lib/places/anchor'
import { describeEvent, listActivity } from '@/lib/activity'
import { bunchLabel, type Lot } from '@/lib/herd'
import { moveLine } from '@/lib/move-line'
import type { LatLng } from '@/lib/places/geo'

// ─── Block 26: the ranch, as one picture at the top of Today ─────────────────
// Reads existing columns only — places, bunches and the ledger — and invents
// nothing:
//   · a place with no shape and no position is NOT given one. It is listed
//     (`unplaced`) so the key can offer it as a chip, into the same sheet.
//   · days-in-place exists only when a live move (or placement) whose
//     destination IS the bunch's place backs the date. No move, no number.
//   · the latest event at a place comes off the ranch's own Activity read, in
//     Activity's own words.
//
// Bunch colours: existing brand tokens only, handed out in the order the
// bunches were made so a bunch keeps its colour from day to day. Never a USDM
// colour, never amber, never red — on this app those mean trouble.
// Block 26c (PK): never amber or red — those are reserved for problems.
export const BUNCH_COLORS = ['#225F87', '#2D6A4F', '#5B4B9C', '#0E7C86', '#6B7FD7', '#1B4332'] as const

export interface MapBunch { id: string; label: string; name: string; head: number; color: string; since: { ts: string; eventId: string; line: string } | null; seen: { ts: string; eventId: string; by: string } | null }
export interface MapPlace {
  id: string; name: string; kind: string
  ring: LatLng[] | null
  acres: number | null
  bunches: MapBunch[]
  latest: { id: string | null; line: string; ts: string } | null
}
export interface RanchMap {
  places: MapPlace[]; centre: LatLng
  keyed: { lotId: string; placeId: string; label: string; name: string; color: string }[]
  /** Block 26c: bunches with no recorded place — listed, never missing. */
  unplaced: { lotId: string; label: string; color: string }[]
}

const TYPE_WORDS: Record<string, string> = { hay_fed: 'Hay fed', bales_stacked: 'Bales stacked', hay_inventory: 'Hay counted', rain: 'Rain recorded', cattle_moved: 'Cattle moved', cattle_worked: 'Cattle worked', cattle_counted: 'Cattle counted', group_action: 'Cattle worked' }

export async function getRanchMap(supabase: SupabaseClient, userId: string): Promise<RanchMap | null> {
  const [{ live }, lots, activity] = await Promise.all([
    placeRows(supabase),
    getRanchLots(supabase, userId),
    listActivity(supabase, userId, {}).catch(() => null),
  ])
  if (live.length === 0) return null
  const where = await whereByLot(supabase, lots).catch(() => ({} as Awaited<ReturnType<typeof whereByLot>>))
  const seen = await seenByLot(supabase, lots, where).catch(() => ({} as Awaited<ReturnType<typeof seenByLot>>))
  const colorOf = new Map(lots.map((l, i) => [l.id, BUNCH_COLORS[i % BUNCH_COLORS.length]]))
  const placeName = new Map(live.map(p => [p.id, p.name]))

  // The latest entry naming each place, in Activity's own words.
  const latest = new Map<string, { id: string; line: string; ts: string }>()
  for (const r of activity?.rows ?? []) {
    if (r.voided_at || r.superseded_by) continue
    for (const k of ['place_id', 'to_place_id', 'from_place_id']) {
      const pid = r.payload[k]
      if (typeof pid === 'string' && !latest.has(pid)) latest.set(pid, { id: r.id, line: describeEvent(r, activity!.names), ts: r.ts })
    }
  }

  const bunchesAt = (placeId: string): MapBunch[] => (lots as Lot[]).filter(l => l.place_id === placeId).map(l => {
    const w = where[l.id]
    return {
      id: l.id, label: bunchLabel(l), name: l.name?.trim() || bunchLabel(l).split(' · ')[0], head: l.head_count, color: colorOf.get(l.id)!,
      since: w?.moved ? { ts: w.moved.ts, eventId: w.moved.eventId, line: moveLine(null, l, null, placeName.get(placeId) ?? null, w.moved.placement === true) } : null,
      seen: seen[l.id] ?? null,
    }
  })

  const places: MapPlace[] = live.map(p => ({
    id: p.id, name: p.name, kind: p.kind, ring: p.ring, acres: p.acres,
    bunches: bunchesAt(p.id),
    latest: latest.get(p.id) ?? (p.lastWork ? { id: null, line: TYPE_WORDS[p.lastWork.type] ?? 'Recorded work', ts: p.lastWork.ts } : null),
  }))
  const centre = await resolveMapCentre(supabase, userId, places.filter(p => p.ring).map(p => p.ring!))
  const keyed = (lots as Lot[]).filter(l => l.place_id && placeName.has(l.place_id)).map(l => ({ lotId: l.id, placeId: l.place_id!, label: bunchLabel(l), name: l.name?.trim() || bunchLabel(l).split(' · ')[0], color: colorOf.get(l.id)! }))
  const unplaced = (lots as Lot[]).filter(l => !l.place_id || !placeName.has(l.place_id)).map(l => ({ lotId: l.id, label: bunchLabel(l), color: colorOf.get(l.id)! }))
  return { places, centre, keyed, unplaced }
}
