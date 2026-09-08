import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { effective } from '@/lib/ledger-effective'
import { MANUAL_EVENT_TYPES } from '@/lib/manual-log'

// ─── The places list's rows (Block 6A) ────────────────────────────────────────
// name · type · last recorded work · last recorded rain — the last two only
// when a line exists (through the correction chain). A place with no rain
// reading shows no rain; zero is never inferred from silence.

export interface PlaceRow { id: string; name: string; kind: string; lastWork: { ts: string; type: string } | null; lastRain: { ts: string; inches: number } | null }

export async function placeRows(supabase: SupabaseClient): Promise<PlaceRow[]> {
  const { data: places } = await supabase.from('places').select('id, name, kind').order('name', { ascending: true })
  const list = (places ?? []) as { id: string; name: string; kind: string }[]
  if (list.length === 0) return []
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
  return list.map(pl => ({ ...pl, lastWork: work.get(pl.id) ?? null, lastRain: rain.get(pl.id) ?? null }))
}
