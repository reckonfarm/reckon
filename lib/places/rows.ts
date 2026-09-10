import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { effective } from '@/lib/ledger-effective'
import { MANUAL_EVENT_TYPES } from '@/lib/manual-log'
import { placeRing } from '@/lib/places/anchor'
import type { LatLng } from '@/lib/places/geo'

// ─── The places list's rows (Block 6A · shapes in slice 1) ────────────────────
// name · type · last recorded work · last recorded rain — the last two only
// when a line exists (through the correction chain). A place with no rain
// reading shows no rain; zero is never inferred from silence.
//
// Slice 1 adds the shape and its acreage, both nullable and both silent when
// absent: an undrawn place is a legitimate place and says nothing about acres.

export interface PlaceRow {
  id: string
  name: string
  kind: string
  retiredAt: string | null
  lastWork: { ts: string; type: string } | null
  lastRain: { ts: string; inches: number } | null
  ring: LatLng[] | null
  acres: number | null
}

/** Live rows first, retired kept separate — never dropped (they must stay reachable). */
export interface PlaceRows { live: PlaceRow[]; retired: PlaceRow[] }

export async function placeRows(supabase: SupabaseClient): Promise<PlaceRows> {
  const list = await selectPlaces(supabase)
  const shaped = list.map(pl => ({ ...pl, ring: placeRing(pl.geometry), acres: typeof pl.acres === 'number' ? pl.acres : null }))
  if (shaped.length === 0) return { live: [], retired: [] }
  const { data: events } = await effective(supabase.from('events').select('id, type, ts, payload').in('type', [...MANUAL_EVENT_TYPES]).eq('payload->>source', 'manual'))
    .order('ts', { ascending: false }).limit(1000)
  const work = new Map<string, { ts: string; type: string }>()
  const rain = new Map<string, { ts: string; inches: number }>()
  for (const r of (events ?? []) as { id: string; type: string; ts: string; payload: Record<string, unknown> }[]) {
    const p = r.payload
    const named = [p.place_id, p.from_place_id, p.to_place_id].filter((v): v is string => typeof v === 'string' && !!v)
    for (const pid of named) {
      if (!work.has(pid)) work.set(pid, { ts: r.ts, type: r.type })
      if (r.type === 'rain' && p.place_id === pid && !rain.has(pid) && typeof p.inches === 'number') rain.set(pid, { ts: r.ts, inches: p.inches })
    }
  }
  const rows: PlaceRow[] = shaped.map(pl => ({
    id: pl.id, name: pl.name, kind: pl.kind, ring: pl.ring, acres: pl.acres,
    retiredAt: pl.retired_at ?? null,
    lastWork: work.get(pl.id) ?? null,
    lastRain: rain.get(pl.id) ?? null,
  }))
  return { live: rows.filter(r => !r.retiredAt), retired: rows.filter(r => r.retiredAt) }
}

// TOLERANT READ, on 040's precedent (lib/jobs/annotations.ts fetchFieldsCut):
// before migration 056 is applied `acres` does not exist, and asking for it
// fails the WHOLE select — which would empty the places list and make it look
// like the outfit has no ground. So ask for it, and if the column isn't there
// yet, ask again without it. The acreage simply stays invisible until the
// migration runs; nothing else on the page changes.
async function selectPlaces(supabase: SupabaseClient) {
  type Row = { id: string; name: string; kind: string; geometry: unknown; acres: number | null; retired_at: string | null }
  const full = await supabase.from('places').select('id, name, kind, geometry, acres, retired_at').order('name', { ascending: true })
  if (!full.error) return (full.data ?? []) as Row[]
  const legacy = await supabase.from('places').select('id, name, kind, geometry').order('name', { ascending: true })
  return ((legacy.data ?? []) as Omit<Row, 'acres' | 'retired_at'>[]).map(r => ({ ...r, acres: null, retired_at: null }))
}
