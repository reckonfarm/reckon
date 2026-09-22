import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { effective } from '@/lib/ledger-effective'
import { getRanchLots } from '@/lib/herd-lots'
import { getHayLedger } from '@/lib/hay/queries'
import { ranchYearStart } from '@/lib/jobs/format'

// ─── The Ranch hub's live numbers and the lots' last work (Block 6A) ──────────
// Every number here exists only when something stands behind it: hay on hand
// needs a counted baseline; head in lots needs a live lot; places and devices
// need rows. null = nothing to say, and the hub renders no number.

export interface RanchNumbers {
  hayOnHand: number | null      // baseline + stacked − fed, only with a counted baseline
  headInLots: number | null     // sum of live lots' head counts, only with a live lot
  places: number | null
  devices: number | null
  workSessions: number | null   // 6J: machine sessions this season (jobs), only when there is one
}

export async function ranchNumbers(supabase: SupabaseClient, userId: string): Promise<RanchNumbers> {
  const [lots, hay, places, devices, work] = await Promise.all([
    getRanchLots(supabase, userId).catch(() => []),
    getHayLedger(supabase, { sinceWithoutBaseline: ranchYearStart() }).catch(() => null),
    // Live places only; tolerant of a database without 057.
    supabase.from('places').select('id', { count: 'exact', head: true }).is('retired_at', null).is('deleted_at', null)   // Block 28: the trash is not a place count
      .then(r => (r.error ? supabase.from('places').select('id', { count: 'exact', head: true }) : r)),
    supabase.from('devices').select('id', { count: 'exact', head: true }),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).gte('started_at', ranchYearStart()),
  ])
  const head = lots.reduce((s, l) => s + (l.head_count > 0 ? l.head_count : 0), 0)
  return {
    hayOnHand: hay?.summary.onHand ? hay.summary.onHand.bales : null,
    headInLots: lots.length > 0 && head > 0 ? head : null,
    places: (places.count ?? 0) > 0 ? places.count! : null,
    devices: (devices.count ?? 0) > 0 ? devices.count! : null,
    workSessions: (work.count ?? 0) > 0 ? work.count! : null,
  }
}

// The last recorded work per lot: the most recent feeding that STANDS (through
// the correction chain) naming the lot. One read for every lot on the ranch.
export interface LastWork { ts: string; bales: number | null; what: string | null; head: number | null; eventId: string   /** Block 14: the most recent count of this bunch, if any — shown on its own line. */
  count?: LastCount
}
// The lot's last recorded work: a feeding, or cattle work naming the lot (6G).
export async function lastWorkByLot(supabase: SupabaseClient, lotIds: string[]): Promise<Record<string, LastWork>> {
  if (lotIds.length === 0) return {}
  // 7D: skip the deleted filter on a database without 061 (temporary).
  const { data } = await effective(supabase.from('events').select('id, type, ts, payload').in('type', ['hay_fed', 'cattle_worked', 'cattle_counted']).eq('payload->>source', 'manual'))
    .in('payload->>herd_lot_id', lotIds).order('ts', { ascending: false }).limit(400)
  const out: Record<string, LastWork> = {}
  // Block 14: the last COUNT is its own line on the bunch card, kept apart
  // from the last work so a count never reads as a working.
  const counts: Record<string, LastCount> = {}
  for (const r of (data ?? []) as { id: string; type: string; ts: string; payload: Record<string, unknown> }[]) {
    const lot = typeof r.payload.herd_lot_id === 'string' ? r.payload.herd_lot_id : null
    if (!lot) continue
    if (r.type === 'cattle_counted') {
      if (!counts[lot] && typeof r.payload.counted === 'number') counts[lot] = { ts: r.ts, eventId: r.id, counted: r.payload.counted, expected: typeof r.payload.expected === 'number' ? r.payload.expected : null }
      continue
    }
    if (out[lot]) continue
    out[lot] = {
      ts: r.ts, eventId: r.id,
      bales: r.type === 'hay_fed' && typeof r.payload.bales === 'number' ? r.payload.bales : null,
      what: r.type === 'cattle_worked' && typeof r.payload.what === 'string' ? r.payload.what : null,
      head: r.type === 'cattle_worked' && typeof r.payload.head === 'number' ? r.payload.head : null,
    }
  }
  for (const lot of Object.keys(counts)) out[lot] = { ...(out[lot] ?? { ts: '', eventId: '', bales: null, what: null, head: null }), count: counts[lot] }
  return out
}

export interface LastCount { ts: string; eventId: string; counted: number; expected: number | null }

// ─── Block 25: where a bunch is, and the move that put it there ───────────────
// herd_lots.place_id is the answer; the move is its as-of. A place with no move
// behind it (set when the bunch was made) is shown with no as-of rather than a
// borrowed one: only a move whose destination IS the bunch's place may date it.
export interface BunchWhere { placeId: string; placeName: string; moved?: { ts: string; eventId: string; placement?: boolean } }
export async function whereByLot(supabase: SupabaseClient, lots: { id: string; place_id?: string | null }[]): Promise<Record<string, BunchWhere>> {
  const placed = lots.filter(l => !!l.place_id)
  if (placed.length === 0) return {}
  const [places, moves] = await Promise.all([
    supabase.from('places').select('id, name').is('deleted_at', null).in('id', [...new Set(placed.map(l => l.place_id as string))]),   // Block 28: a place in the trash is no place
    effective(supabase.from('events').select('id, ts, payload').eq('type', 'cattle_moved'))
      .in('payload->>herd_lot_id', placed.map(l => l.id)).order('ts', { ascending: false }).limit(400),
  ])
  const names = new Map(((places.data ?? []) as { id: string; name: string }[]).map(p => [p.id, p.name]))
  const out: Record<string, BunchWhere> = {}
  for (const l of placed) {
    const name = names.get(l.place_id as string)
    if (!name) continue
    const last = ((moves.data ?? []) as { id: string; ts: string; payload: Record<string, unknown> }[]).find(m => m.payload.herd_lot_id === l.id && typeof m.payload.to_place_id === 'string')
    out[l.id] = { placeId: l.place_id as string, placeName: name, ...(last && last.payload.to_place_id === l.place_id ? { moved: { ts: last.ts, eventId: last.id, ...(last.payload.placement === true ? { placement: true } : {}) } } : {}) }
  }
  return out
}
