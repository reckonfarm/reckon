import 'server-only'
import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase'
import { notSuperseded } from '@/lib/ledger-effective'
import { MANUAL_EVENT_TYPES } from '@/lib/manual-log'
import { getRanchLots } from '@/lib/herd-lots'
import { lotLabel, type Lot } from '@/lib/herd'
import { moveLine, isPlacement, removedName, type MovedBunch } from '@/lib/move-line'
import { fmtDay, plural } from '@/lib/jobs/format'

// ─── Block 29: what changed since you checked — ONE read, two readers ────────
// The card on Today and the map's stepper read the same list: everything
// someone else made (created_at, Block 27) after this person last reviewed.
// A correction or a void is news; the original it replaced is not. `cache()`
// makes the two readers on one Today render one read.
//
// "Seen" is exact: Reviewed sends the newest made-at it was shown, and the
// cursor is stamped no earlier than that — a phone ahead of the server can no
// longer keep its own last records "new" (lib/program-alerts.ts:19-31 argued
// against a bare timestamp cursor for exactly this reason).
export type ChangeKind = 'move' | 'feeding' | 'rain' | 'work' | 'count' | 'stack' | 'inventory' | 'alert'
export interface Change {
  id: string
  kind: ChangeKind
  /** The ground it happened on: place_id, else a move's destination. Null for an alert. */
  placeId: string | null
  fromPlaceId: string | null
  toPlaceId: string | null
  line: string
  who: string
  /** When it was MADE on the phone (Block 27). */
  madeAt: string
  /** When the work happened. */
  workedAt: string
  marker: 'voided' | 'corrected' | null
}
export interface Since {
  changes: Change[]
  /** Every change, including the ones beyond the card's five. */
  total: number
  since: string
  lastSeen: string | null
  /** The newest made-at among the changes shown — what Reviewed sends. */
  newest: string | null
}

export const SHOW = 5
const KIND: Record<string, ChangeKind> = { cattle_moved: 'move', hay_fed: 'feeding', rain: 'rain', cattle_worked: 'work', cattle_counted: 'count', bales_stacked: 'stack', hay_inventory: 'inventory', alert: 'alert' }
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isoHoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

interface Row { id: string; user_id: string; type: string; ts: string; created_at: string; payload: Record<string, unknown>; supersedes_event_id: string | null; voided_at: string | null }

function what(r: Row, placeName: (id: unknown) => string | null, lotName: (id: unknown) => string | null, bunch: (id: unknown) => MovedBunch | null): string {
  const p = r.payload
  const at = placeName(p.place_id)
  const suffix = at ? ` at ${at}` : ''
  switch (r.type) {
    case 'hay_fed': { const b = num(p.bales); const to = lotName(p.herd_lot_id); return `fed ${b == null ? 'hay' : plural(b, 'bale')}${to ? ` to ${to}` : ''}${suffix}` }
    case 'bales_stacked': { const c = num(p.count); return `stacked ${c == null ? 'bales' : plural(c, 'bale')}${suffix}` }
    case 'hay_inventory': { const b = num(p.bales); const asOf = str(p.as_of); return `counted ${b == null ? 'the stack' : `${b.toLocaleString()} bales on hand`}${asOf ? ` as of ${fmtDay(`${asOf}T12:00:00-06:00`)}` : ''}${suffix}` }
    case 'rain': { const i = num(p.inches); return `logged ${i == null ? 'rain' : `${i.toFixed(2)}" of rain`}${suffix}` }
    case 'cattle_moved': { const l = moveLine(num(p.head), bunch(p.herd_lot_id), placeName(p.from_place_id), placeName(p.to_place_id), isPlacement(p)); return l[0].toLowerCase() + l.slice(1) }
    case 'cattle_worked': { const h = num(p.head); const w = str(p.what); return `${w ?? 'worked'} ${h == null ? 'cattle' : `${h.toLocaleString()} head`}${suffix}` }
    case 'cattle_counted': { const c = num(p.counted); const l = lotName(p.herd_lot_id); return `counted ${c == null ? 'cattle' : `${c.toLocaleString()} head`}${l ? ` of ${l}` : ''}` }
    case 'alert': { const county = str(p.county_name); return `LFP alert${county ? ` for ${county}` : ''}` }
    default: return r.type.replace(/_/g, ' ')
  }
}

export const getChangesSince = cache(async (supabase: SupabaseClient, userId: string): Promise<Since | null> => {
  const { data: member } = await supabase.from('ranch_members').select('ranch_id, last_seen_at').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!member) return null
  const lastSeen = (member as { last_seen_at?: string | null }).last_seen_at ?? null
  const since = lastSeen ?? isoHoursAgo(24)
  const [{ data }, { count }] = await Promise.all([
    notSuperseded(supabase.from('events').select('id, user_id, type, ts, created_at, payload, supersedes_event_id, voided_at').in('type', [...MANUAL_EVENT_TYPES, 'alert']))
      .gt('created_at', since).neq('user_id', userId).order('created_at', { ascending: false }).limit(SHOW),
    notSuperseded(supabase.from('events').select('id', { count: 'exact', head: true }).in('type', [...MANUAL_EVENT_TYPES, 'alert']))
      .gt('created_at', since).neq('user_id', userId),
  ])
  const rows = (data ?? []) as Row[]
  const placeIds = new Set<string>(); const lotIds = new Set<string>(); const userIds = new Set<string>()
  for (const r of rows) {
    userIds.add(r.user_id)
    for (const k of ['place_id', 'from_place_id', 'to_place_id']) { const v = str(r.payload[k]); if (v) placeIds.add(v) }
    const l = str(r.payload.herd_lot_id); if (l) lotIds.add(l)
  }
  const [placesRes, profilesRes, herdRes] = await Promise.all([
    placeIds.size ? supabase.from('places').select('id, name, deleted_at').in('id', [...placeIds]) : Promise.resolve({ data: [] as { id: string; name: string; deleted_at: string | null }[] }),
    userIds.size ? createServiceClient().from('profiles').select('id, display_name').in('id', [...userIds]) : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    lotIds.size ? getRanchLots(supabase, userId) : Promise.resolve([] as Lot[]),
  ])
  const placeNames = new Map((placesRes.data ?? []).map(p => [p.id as string, removedName(p.name as string, !!(p as { deleted_at?: string | null }).deleted_at)]))
  const authors = new Map((profilesRes.data ?? []).map(p => [p.id as string, (p.display_name as string | null)?.trim() || null]))
  const lotNames = new Map(herdRes.map(l => [l.id, lotLabel(l)]))
  const bunches = new Map<string, MovedBunch>(herdRes.map(l => [l.id, { name: l.name, class: l.class }]))
  const placeName = (id: unknown) => { const s = str(id); return s ? placeNames.get(s) ?? null : null }
  const lotName = (id: unknown) => { const s = str(id); return s ? lotNames.get(s) ?? null : null }
  const bunch = (id: unknown) => { const s = str(id); return s ? bunches.get(s) ?? null : null }
  const changes: Change[] = rows.map(r => ({
    id: r.id, kind: KIND[r.type] ?? 'work',
    placeId: str(r.payload.place_id) ?? str(r.payload.to_place_id),
    fromPlaceId: str(r.payload.from_place_id), toPlaceId: str(r.payload.to_place_id),
    line: what(r, placeName, lotName, bunch),
    who: r.type === 'alert' ? 'Dryline' : (authors.get(r.user_id) ?? 'Someone on the ranch'),
    madeAt: r.created_at, workedAt: r.ts,
    marker: r.voided_at ? 'voided' : r.supersedes_event_id ? 'corrected' : null,
  }))
  return { changes, total: count ?? changes.length, since, lastSeen, newest: changes[0]?.madeAt ?? null }
})
