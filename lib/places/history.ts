import type { SupabaseClient } from '@supabase/supabase-js'
import { fmtDay, fmtTime, dayKey, todayKey, plural } from '@/lib/jobs/format'
import { lotLabel, type Lot } from '@/lib/herd'
import { getRanchLots } from '@/lib/herd-lots'
import { placeEntryCounts } from '@/lib/activity'
import { ledgerFilters } from '@/lib/ledger-effective'
import { hasEventDeletion } from '../schema-capability'

// ─── A place's practical memory (Block 2F) ────────────────────────────────────
// "When did we last…" at one place, answered from the ledger: the most recent
// line of each kind that names this place — feeding, rain, stacking, a stack
// count, cattle moved here or away, cattle worked — plus the last reading
// from any device registered at the place. Typed function over the caller's
// SupabaseClient (user-scoped on pages → RLS is the scope); empty on error,
// never throws. Every answer carries the record it came from.

export interface PlaceMemory {
  kind: 'feeding' | 'rain' | 'stacked' | 'count' | 'moved' | 'worked' | 'device'
  label: string        // "Last recorded feeding"
  answer: string       // "yesterday 7:10 AM · 4 bales to the north bunch"
  ts: string           // ISO
  eventId: string | null
  detail: string       // the full line
}

export interface PlaceHistory {
  place: { id: string; name: string; kind: string; created_at: string; geometry: unknown; acres: number | null; updated_at: string; updated_by: string | null; retired_at: string | null } | null
  memory: PlaceMemory[]           // present kinds only, most recent first
  counts: { entries: number; sinceIso: string | null }
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function whenLabel(iso: string): string {
  const d = dayKey(iso)
  if (d === todayKey()) return `today ${fmtTime(iso)}`
  if (d === dayKey(Date.now() - 86_400_000)) return `yesterday ${fmtTime(iso)}`
  return `${fmtDay(iso)} ${fmtTime(iso)}`
}

interface Row { id: string; type: string; ts: string; device_id: string | null; payload: Record<string, unknown> | null }

export async function getPlaceHistory(supabase: SupabaseClient, placeId: string): Promise<PlaceHistory> {
  const empty: PlaceHistory = { place: null, memory: [], counts: { entries: 0, sinceIso: null } }
  try {
    // Tolerant read (040's precedent): `acres` does not exist before migration
    // 056, and asking for it would fail the select and 404 the whole page.
    const withAcres = await supabase.from('places').select('id, name, kind, created_at, geometry, acres, updated_at, updated_by, retired_at').eq('id', placeId).maybeSingle()
    const place = withAcres.error
      ? (await supabase.from('places').select('id, name, kind, created_at, geometry').eq('id', placeId).maybeSingle()).data
      : withAcres.data
    if (!place) return empty

    // Manual lines that name this place (as where, or as the move's endpoints).
    // 7D: skip the deleted filter on a database without 061 (temporary).
    const { effective } = ledgerFilters(await hasEventDeletion(supabase))
    const [here, from, to, devices, herd] = await Promise.all([
      // Block 5B: the "last …" answers are what currently STANDS (through the chain).
      effective(supabase.from('events').select('id, type, ts, device_id, payload').eq('payload->>source', 'manual').eq('payload->>place_id', placeId)).order('ts', { ascending: false }).limit(400),
      effective(supabase.from('events').select('id, type, ts, device_id, payload').eq('type', 'cattle_moved').eq('payload->>from_place_id', placeId)).order('ts', { ascending: false }).limit(5),
      effective(supabase.from('events').select('id, type, ts, device_id, payload').eq('type', 'cattle_moved').eq('payload->>to_place_id', placeId)).order('ts', { ascending: false }).limit(5),
      supabase.from('devices').select('id, name, type').eq('place_id', placeId),
      getRanchLots(supabase),
    ])
    const rows = new Map<string, Row>()
    for (const r of [...(here.data ?? []), ...(from.data ?? []), ...(to.data ?? [])] as Row[]) rows.set(r.id, r)
    const all = [...rows.values()].sort((a, b) => b.ts.localeCompare(a.ts))
    const lotNames = new Map(herd.map(l => [l.id, lotLabel(l)]))   // the RANCH's lots (Block 4A)

    const first = (pred: (r: Row) => boolean) => all.find(pred) ?? null
    const memory: PlaceMemory[] = []
    const push = (kind: PlaceMemory['kind'], label: string, r: Row | null, answer: (p: Record<string, unknown>) => string) => {
      if (!r) return
      const p = r.payload ?? {}
      const a = answer(p)
      memory.push({ kind, label, answer: `${whenLabel(r.ts)} · ${a}`, ts: r.ts, eventId: r.id, detail: a })
    }
    push('feeding', 'Last recorded feeding', first(r => r.type === 'hay_fed'), p => {
      const b = num(p.bales); const lot = str(p.herd_lot_id); const to = lot ? lotNames.get(lot) : null
      return `${b == null ? 'hay' : plural(b, 'bale')}${to ? ` to ${to}` : ''}`
    })
    push('rain', 'Last recorded rain', first(r => r.type === 'rain'), p => { const i = num(p.inches); return i == null ? 'rain' : `${i.toFixed(2)}"` })
    push('stacked', 'Last bales stacked', first(r => r.type === 'bales_stacked'), p => { const c = num(p.count); return c == null ? 'bales' : plural(c, 'bale') })
    push('count', 'Last stack count', first(r => r.type === 'hay_inventory'), p => { const b = num(p.bales); const asOf = str(p.as_of); return `${b == null ? '?' : b.toLocaleString()} bales on hand${asOf ? ` as of ${fmtDay(`${asOf}T12:00:00-06:00`)}` : ''}` })
    push('moved', 'Last cattle move', first(r => r.type === 'cattle_moved'), p => {
      const h = num(p.head); const who = h == null ? 'cattle' : `${h.toLocaleString()} head`
      return str(p.to_place_id) === placeId ? `${who} moved here` : `${who} moved away`
    })
    push('worked', 'Last cattle worked', first(r => r.type === 'cattle_worked'), p => { const h = num(p.head); const w = str(p.what); return `${w ?? 'worked'} ${h == null ? 'cattle' : `${h.toLocaleString()} head`}` })

    // Devices at the place: the latest reading from any of them.
    const devs = (devices.data ?? []) as { id: string; name: string; type: string }[]
    if (devs.length > 0) {
      const { data: reading } = await supabase.from('events').select('id, type, ts, device_id, payload')
        .in('device_id', devs.map(d => d.id)).order('ts', { ascending: false }).limit(1).maybeSingle()
      if (reading) {
        const r = reading as Row
        const dev = devs.find(d => d.id === r.device_id)
        const a = `${dev?.name ?? 'device'} reported ${r.type.replace(/_/g, ' ')}`
        memory.push({ kind: 'device', label: 'Last device reading', answer: `${whenLabel(r.ts)} · ${a}`, ts: r.ts, eventId: r.id, detail: a })
      }
    }
    memory.sort((a, b) => b.ts.localeCompare(a.ts))
    return {
      place: { acres: null, updated_by: null, retired_at: null, ...place } as PlaceHistory['place'],
      memory,
      counts: await placeEntryCounts(supabase, placeId),   // Block 5A: exact, same predicate as /activity?place=
    }
  } catch {
    return empty
  }
}
