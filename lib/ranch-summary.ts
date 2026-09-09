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
}

export async function ranchNumbers(supabase: SupabaseClient, userId: string): Promise<RanchNumbers> {
  const [lots, hay, places, devices] = await Promise.all([
    getRanchLots(supabase, userId).catch(() => []),
    getHayLedger(supabase, { since: ranchYearStart() }).catch(() => null),
    supabase.from('places').select('id', { count: 'exact', head: true }),
    supabase.from('devices').select('id', { count: 'exact', head: true }),
  ])
  const head = lots.reduce((s, l) => s + (l.head_count > 0 ? l.head_count : 0), 0)
  return {
    hayOnHand: hay?.summary.onHand ? hay.summary.onHand.bales : null,
    headInLots: lots.length > 0 && head > 0 ? head : null,
    places: (places.count ?? 0) > 0 ? places.count! : null,
    devices: (devices.count ?? 0) > 0 ? devices.count! : null,
  }
}

// The last recorded work per lot: the most recent feeding that STANDS (through
// the correction chain) naming the lot. One read for every lot on the ranch.
export interface LastWork { ts: string; bales: number | null; what: string | null; head: number | null; eventId: string }
// The lot's last recorded work: a feeding, or cattle work naming the lot (6G).
export async function lastWorkByLot(supabase: SupabaseClient, lotIds: string[]): Promise<Record<string, LastWork>> {
  if (lotIds.length === 0) return {}
  const { data } = await effective(supabase.from('events').select('id, type, ts, payload').in('type', ['hay_fed', 'cattle_worked']).eq('payload->>source', 'manual'))
    .in('payload->>herd_lot_id', lotIds).order('ts', { ascending: false }).limit(400)
  const out: Record<string, LastWork> = {}
  for (const r of (data ?? []) as { id: string; type: string; ts: string; payload: Record<string, unknown> }[]) {
    const lot = typeof r.payload.herd_lot_id === 'string' ? r.payload.herd_lot_id : null
    if (!lot || out[lot]) continue
    out[lot] = {
      ts: r.ts, eventId: r.id,
      bales: r.type === 'hay_fed' && typeof r.payload.bales === 'number' ? r.payload.bales : null,
      what: r.type === 'cattle_worked' && typeof r.payload.what === 'string' ? r.payload.what : null,
      head: r.type === 'cattle_worked' && typeof r.payload.head === 'number' ? r.payload.head : null,
    }
  }
  return out
}
