import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from './supabase'
import { resolveRanchId } from './ranch-membership'
import { getRanchLotsIncludingRetired } from './herd-lots'
import { lotLabel, type Lot } from './herd'
import { MANUAL_EVENT_TYPES, MANUAL_EVENT_LABELS, isManualEventType } from './manual-log'
import { fmtDay, fmtTime, plural, RANCH_TZ } from './jobs/format'

// ─── The activity record (Block 5A) ───────────────────────────────────────────
// Everything a person recorded on the ranch, findable by stable id forever.
// The read cursor (ranch_members.last_seen_at) decides what is NEW on Today;
// it never decides what is REACHABLE here. Every list row links to
// /activity/[id]; a place's "N entries" is /activity?place=<id>. Reads run on
// the USER-SCOPED client — the membership policy on events is the gate;
// display names come through the service role (profiles is not ranch-scoped),
// only for the ids on the page.

export const ACTIVITY_TYPES = [...MANUAL_EVENT_TYPES, 'alert'] as const
export const PAGE_SIZE = 50

export interface ActivityRow {
  id: string
  type: string
  ts: string             // when it happened on the ranch (work time)
  ingested_at: string    // when the ranch's record received it (recording time)
  user_id: string
  device_id: string | null
  payload: Record<string, unknown>
  // Block 5B (054): the correction chain. The record shows every row — a
  // superseded line stays legible, marked; a void is marked; a correction says
  // what it corrects.
  supersedes_event_id?: string | null
  superseded_by?: string | null
  voided_at?: string | null
  correction_reason?: string | null
}
export const ACTIVITY_COLS = 'id, type, ts, ingested_at, user_id, device_id, payload, supersedes_event_id, superseded_by, voided_at, correction_reason'
export interface Names {
  place: (id: unknown) => string | null
  lot: (id: unknown) => string | null
  person: (userId: string) => string
}
export interface ActivityFilters { actor?: string | null; place?: string | null; lot?: string | null; from?: string | null; to?: string | null; since?: string | null }   // since = recorded (ingested_at) after this instant — Today's "View all N updates"
export interface ActivityPage { rows: ActivityRow[]; names: Names; nextCursor: string | null; ranchId: string; filters: ActivityFilters }

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const DAY = /^\d{4}-\d{2}-\d{2}$/

// Ranch-day boundaries (America/Denver), never UTC — the class of defect that bit
// the seed (UTC-stamped counts) and work-time-vs-recording-time.
export function ranchDayStartIso(day: string): string { return zonedIso(day, 0) }
export function ranchDayEndIso(day: string): string { return zonedIso(day, 24) }
function zonedIso(day: string, hour: number): string {
  // Find the UTC instant at which America/Denver reads `day` at `hour`:00.
  const guess = new Date(`${day}T00:00:00Z`).getTime() + hour * 3_600_000
  for (const offsetH of [6, 7]) {   // MDT, MST
    const t = new Date(guess + offsetH * 3_600_000)
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: RANCH_TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(t)
    const get = (k: string) => local.find(p => p.type === k)?.value ?? ''
    const localDay = `${get('year')}-${get('month')}-${get('day')}`, localHour = parseInt(get('hour'), 10) % 24
    const wantDay = hour === 24 ? new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10) : day
    if (localDay === wantDay && localHour === hour % 24) return t.toISOString()
  }
  return new Date(guess + 6 * 3_600_000).toISOString()
}

// ── Operational lists (Block 6B): what stands, and what a correction replaced ──
// The standing rows of a loaded page, and the chain behind one of them walked
// within the same page (the original usually sits a minute away). An empty
// chain means the replaced entry is older than the page: the row says so and
// the entry itself carries the whole chain.
// What STANDS on an operational list: every chain head — the effective entry,
// and a void (it counts for nothing, marked; it is never hidden, because an
// entry that stops being findable is the failure 5A exists to kill).
export function standingRows(rows: ActivityRow[]): ActivityRow[] {
  return rows.filter(r => !r.superseded_by)
}
export function chainWithin(rows: ActivityRow[], head: ActivityRow, names: Names): { id: string; line: string; who: string; when: string; reason: string | null }[] {
  const byId = new Map(rows.map(r => [r.id, r]))
  const out: { id: string; line: string; who: string; when: string; reason: string | null }[] = []
  let cur: ActivityRow = head
  for (let i = 0; i < CHAIN_MAX && cur.supersedes_event_id; i++) {
    const prev = byId.get(cur.supersedes_event_id)
    if (!prev) break
    out.push({ id: prev.id, line: describeEvent(prev, names), who: names.person(prev.user_id), when: `${fmtDay(prev.ts)} ${fmtTime(prev.ts)}`, reason: cur.correction_reason ?? null })
    cur = prev
  }
  return out
}

// ── One line for one event, the same words everywhere ─────────────────────────
export function describeEvent(r: ActivityRow, names: Names): string {
  const line = describeBody(r, names)
  return r.voided_at ? `Voided: ${line}` : line
}
function describeBody(r: ActivityRow, names: Names): string {
  const p = r.payload
  const at = names.place(p.place_id)
  const suffix = at ? ` at ${at}` : ''
  switch (r.type) {
    case 'rain': { const inches = num(p.inches); return inches == null ? `Rain${suffix}` : `${inches.toFixed(2)}" of rain${suffix}` }
    case 'hay_fed': { const bales = num(p.bales); const to = names.lot(p.herd_lot_id); const who = to ? ` to ${to}` : ''; return bales == null ? `Hay fed${who}${suffix}` : `Fed ${plural(bales, 'bale')}${who}${suffix}` }
    case 'bales_stacked': { const count = num(p.count); return count == null ? `Bales stacked${suffix}` : `Stacked ${plural(count, 'bale')}${suffix}` }
    case 'cattle_moved': { const head = num(p.head); const from = names.place(p.from_place_id); const to = names.place(p.to_place_id); const who = head == null ? 'Cattle' : `${head.toLocaleString()} head`; const route = from && to ? ` ${from} → ${to}` : to ? ` to ${to}` : from ? ` from ${from}` : ''; return `Moved ${who}${route}` }
    case 'cattle_worked': { const head = num(p.head); const what = str(p.what); const who = head == null ? 'cattle' : `${head.toLocaleString()} head`; return `${what ? what[0].toUpperCase() + what.slice(1) : 'Worked'} ${who}${suffix}` }
    case 'hay_inventory': { const bales = num(p.bales); const asOf = str(p.as_of); const when = asOf ? ` as of ${fmtDay(`${asOf}T12:00:00-06:00`)}` : ''; return bales == null ? `Bales on hand counted${when}` : `${plural(bales, 'bale')} on hand${when}${suffix}` }
    case 'alert': return str(p.title) ?? 'Alert'
    default: return (isManualEventType(r.type) ? MANUAL_EVENT_LABELS[r.type] : r.type) + suffix
  }
}

// The quantity as "value · unit", for the detail page's own field.
export function quantityOf(r: ActivityRow): string | null {
  const p = r.payload
  switch (r.type) {
    case 'rain': { const i = num(p.inches); return i == null ? null : `${i.toFixed(2)} in` }
    case 'hay_fed': { const b = num(p.bales); return b == null ? null : plural(b, 'bale') }
    case 'bales_stacked': { const c = num(p.count); return c == null ? null : plural(c, 'bale') }
    case 'hay_inventory': { const b = num(p.bales); return b == null ? null : `${plural(b, 'bale')} on hand` }
    case 'cattle_moved': case 'cattle_worked': { const h = num(p.head); return h == null ? null : `${h.toLocaleString()} head` }
    default: return null
  }
}

// ── Names for a set of rows ───────────────────────────────────────────────────
async function namesFor(supabase: SupabaseClient, userId: string, rows: ActivityRow[]): Promise<Names> {
  const placeIds = new Set<string>(); const userIds = new Set<string>()
  for (const r of rows) { userIds.add(r.user_id); for (const k of ['place_id', 'from_place_id', 'to_place_id']) { const v = str(r.payload[k]); if (v) placeIds.add(v) } }
  const [places, profiles, lots] = await Promise.all([
    placeIds.size ? supabase.from('places').select('id, name').in('id', [...placeIds]) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    userIds.size ? createServiceClient().from('profiles').select('id, display_name, email').in('id', [...userIds]) : Promise.resolve({ data: [] as { id: string; display_name: string | null; email: string | null }[] }),
    getRanchLotsIncludingRetired(supabase, userId),
  ])
  const placeNames = new Map((places.data ?? []).map(p => [p.id as string, p.name as string]))
  const people = new Map((profiles.data ?? []).map(p => [p.id as string, ((p.display_name as string | null)?.trim() || (p.email as string | null) || 'Someone on the ranch')]))
  const lotNames = new Map((lots as Lot[]).map(l => [l.id, lotLabel(l)]))
  return {
    place: id => { const s = str(id); return s ? placeNames.get(s) ?? null : null },
    lot: id => { const s = str(id); return s ? lotNames.get(s) ?? null : null },
    person: uid => people.get(uid) ?? 'Someone on the ranch',
  }
}

// The one predicate for "names this place" (as where, or as a move's endpoints).
// The record's place filter and the place page's entry count both use it, so the
// count a place claims is exactly the list the link opens.
export function placePredicate(placeId: string): string {
  return `payload->>place_id.eq.${placeId},payload->>from_place_id.eq.${placeId},payload->>to_place_id.eq.${placeId}`
}
export async function placeEntryCounts(supabase: SupabaseClient, placeId: string): Promise<{ entries: number; sinceIso: string | null }> {
  const [{ count }, { data: earliest }] = await Promise.all([
    supabase.from('events').select('id', { count: 'exact', head: true }).in('type', [...ACTIVITY_TYPES]).or(placePredicate(placeId)),
    supabase.from('events').select('ts').in('type', [...ACTIVITY_TYPES]).or(placePredicate(placeId)).order('ts', { ascending: true }).limit(1).maybeSingle(),
  ])
  return { entries: count ?? 0, sinceIso: (earliest?.ts as string | undefined) ?? null }
}

// ── The list: keyset pagination on (ts desc, id desc); filters; the ranch's rows only ──
export async function listActivity(supabase: SupabaseClient, userId: string, filters: ActivityFilters, cursor?: string | null): Promise<ActivityPage | null> {
  const ranchId = await resolveRanchId(supabase, userId)
  if (!ranchId) return null
  let q = supabase.from('events').select(ACTIVITY_COLS)
    .eq('ranch_id', ranchId).in('type', [...ACTIVITY_TYPES])
    .order('ts', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE + 1)
  if (filters.actor) q = q.eq('user_id', filters.actor)
  if (filters.place) q = q.or(placePredicate(filters.place))
  if (filters.lot) q = q.eq('payload->>herd_lot_id', filters.lot)
  if (filters.from && DAY.test(filters.from)) q = q.gte('ts', ranchDayStartIso(filters.from))
  if (filters.to && DAY.test(filters.to)) q = q.lt('ts', ranchDayEndIso(filters.to))
  if (filters.since && !Number.isNaN(Date.parse(filters.since))) q = q.gt('ingested_at', new Date(filters.since).toISOString())
  if (cursor) {
    const [cts, cid] = cursor.split('|')
    if (cts && cid) q = q.or(`ts.lt.${cts},and(ts.eq.${cts},id.lt.${cid})`)
  }
  const { data } = await q
  const all = (data ?? []) as ActivityRow[]
  const rows = all.slice(0, PAGE_SIZE)
  const last = rows[rows.length - 1]
  const nextCursor = all.length > PAGE_SIZE && last ? `${last.ts}|${last.id}` : null
  return { rows, names: await namesFor(supabase, userId, rows), nextCursor, ranchId, filters }
}

// ── One event, by stable id, with everything the detail page states ──────────
export interface EventDetail {
  row: ActivityRow
  names: Names
  actorRole: 'owner' | 'member' | 'former member'
  line: string
  quantity: string | null
  placeId: string | null
  lotId: string | null
  // Block 5B — the correction chain, both ways. `corrects`: the rows this one
  // replaced, nearest first back to the first entry; `correctedBy`: the rows
  // that replaced this one, nearest first up to the current entry (the head).
  corrects: ActivityRow[]
  correctedBy: ActivityRow[]
  head: ActivityRow          // the entry that currently stands for this chain (may be a void)
  canCorrect: boolean        // logged by hand, and nothing has replaced it
}
const CHAIN_MAX = 25
export async function getEvent(supabase: SupabaseClient, userId: string, id: string): Promise<EventDetail | null> {
  const { data } = await supabase.from('events').select(`${ACTIVITY_COLS}, ranch_id`).eq('id', id).maybeSingle()
  if (!data) return null
  const row = data as ActivityRow & { ranch_id: string }
  const hop = async (nextId: string | null | undefined) => nextId ? ((await supabase.from('events').select(ACTIVITY_COLS).eq('id', nextId).maybeSingle()).data as ActivityRow | null) : null
  const corrects: ActivityRow[] = []
  for (let cur: ActivityRow | null = await hop(row.supersedes_event_id); cur && corrects.length < CHAIN_MAX; cur = await hop(cur.supersedes_event_id)) corrects.push(cur)
  const correctedBy: ActivityRow[] = []
  for (let cur: ActivityRow | null = await hop(row.superseded_by); cur && correctedBy.length < CHAIN_MAX; cur = await hop(cur.superseded_by)) correctedBy.push(cur)
  const head = correctedBy[correctedBy.length - 1] ?? row
  const canCorrect = isManualEventType(row.type) && !row.superseded_by && !row.voided_at
  const names = await namesFor(supabase, userId, [row, ...corrects, ...correctedBy])
  // The caller only saw this row through their own membership (043); the actor's
  // role is read with the service role because a member's own row is all the
  // client policy on ranch_members shows.
  const { data: m } = await createServiceClient().from('ranch_members').select('role').eq('ranch_id', row.ranch_id).eq('user_id', row.user_id).maybeSingle()
  const actorRole: EventDetail['actorRole'] = m?.role === 'owner' ? 'owner' : m ? 'member' : 'former member'
  return { row, names, actorRole, line: describeEvent(row, names), quantity: quantityOf(row), placeId: str(row.payload.place_id) ?? str(row.payload.to_place_id), lotId: str(row.payload.herd_lot_id), corrects, correctedBy, head, canCorrect }
}

// The people and places a filter can name (for the filter controls).
export async function filterOptions(supabase: SupabaseClient, userId: string): Promise<{ people: { id: string; name: string }[]; places: { id: string; name: string }[]; lots: { id: string; name: string; retired?: boolean }[] }> {
  const ranchId = await resolveRanchId(supabase, userId)
  if (!ranchId) return { people: [], places: [], lots: [] }
  const [{ data: members }, { data: places }, lots] = await Promise.all([
    createServiceClient().from('ranch_members').select('user_id').eq('ranch_id', ranchId),
    supabase.from('places').select('id, name').eq('ranch_id', ranchId).order('name'),
    getRanchLotsIncludingRetired(supabase, userId),
  ])
  const ids = (members ?? []).map(m => m.user_id as string)
  const { data: profiles } = ids.length ? await createServiceClient().from('profiles').select('id, display_name, email').in('id', ids) : { data: [] }
  return {
    // Every member is listed — a member with no profiles row yet is still a person
    // whose entries can be filtered, named the way the record's lines name them.
    people: ids.map(id => { const p = (profiles ?? []).find(x => x.id === id); return { id, name: ((p?.display_name as string | null)?.trim() || (p?.email as string | null) || 'Someone on the ranch') } }).sort((a, b) => a.name.localeCompare(b.name)),
    places: (places ?? []).map(p => ({ id: p.id as string, name: p.name as string })),
    lots: (lots as Lot[]).map(l => ({ id: l.id, name: lotLabel(l), ...(l.retired_at ? { retired: true } : {}) })),   // retired lots are named, and say so (6A)
  }
}
