import { moveLine, isPlacement, removedName, type MovedBunch } from '@/lib/move-line'
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from './supabase'
import { resolveRanchId } from './ranch-membership'
import { getRanchLotsIncludingRetired } from './herd-lots'
import { lotLabel, type Lot } from './herd'
import { MANUAL_EVENT_TYPES, MANUAL_EVENT_LABELS, isManualEventType } from './manual-log'
import { GROUP_ACTION_LABELS, GROUP_ACTION_TYPE, isGroupAction } from './cattle/kinds'
import { fmtDay, fmtTime, plural, dayKey, RANCH_TZ } from './jobs/format'
import { live } from './ledger-effective'
import { liveOnly } from './trash'
import { droughtAlertLine } from './drought-words'

// ─── The activity record (Block 5A) ───────────────────────────────────────────
// Everything a person recorded on the ranch, findable by stable id forever.
// The read cursor (ranch_members.last_seen_at) decides what is NEW on Today;
// it never decides what is REACHABLE here. Every list row links to
// /activity/[id]; a place's "N entries" is /activity?place=<id>. Reads run on
// the USER-SCOPED client — the membership policy on events is the gate;
// display names come through the service role (profiles is not ranch-scoped),
// only for the ids on the page.

// Block 10: a group action is not in MANUAL_EVENT_TYPES — it is not something
// the Log it sheet offers, it has its own screen and it moves head counts. It
// IS in the record, because a working that changed the herd and appears
// nowhere would be the most alarming thing the app could do.
export const ACTIVITY_TYPES = [...MANUAL_EVENT_TYPES, GROUP_ACTION_TYPE, 'alert'] as const
export const PAGE_SIZE = 50

export interface ActivityRow {
  id: string
  type: string
  ts: string             // when it happened on the ranch (work time)
  ingested_at: string    // when the ranch's record received it (arrival)
  created_at: string     // Block 27: when it was MADE on the phone — orders the ledger and "since you checked"
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
export const ACTIVITY_COLS = 'id, type, ts, created_at, ingested_at, user_id, device_id, payload, supersedes_event_id, superseded_by, voided_at, correction_reason'
export interface Names {
  place: (id: unknown) => string | null
  lot: (id: unknown) => string | null
  person: (userId: string) => string
  /** Block 25: the bunch itself, for a line that reads name · class · head. */
  bunch: (id: unknown) => MovedBunch | null
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
// ─── Block 12 (12.9): an alert must say what it is alerting ───────────────────
// PK's ruling: "an alert with no title should never render the bare word
// 'Alert'. If the payload can't say what it is, the alert doesn't show." The
// LFP alert never had a title — lib/alert-service writes kind / county / tier
// / payments — so every one of them read as the bare word in the record for
// weeks. The sentence is built from the payload here; a payload this cannot
// name returns null and listActivity leaves the row out.
export function alertLine(p: Record<string, unknown>): string | null {
  const title = str(p.title)
  if (title) return title
  // Block 16 (ruling 2): the Thursday alert reads as the U.S. Drought
  // Monitor's — source, valid date, class in plain words, no LFP language.
  return droughtAlertLine(p)
}

export function describeEvent(r: ActivityRow, names: Names): string {
  const line = describeBody(r, names)
  return r.voided_at ? `Removed: ${line}` : line   // 12.5: 'void' is not a word a person reads
}
function describeBody(r: ActivityRow, names: Names): string {
  const p = r.payload
  const at = names.place(p.place_id)
  const suffix = at ? ` at ${at}` : ''
  switch (r.type) {
    case 'rain': { const inches = num(p.inches); return inches == null ? `Rain${suffix}` : `${inches.toFixed(2)}" of rain${suffix}` }
    case 'hay_fed': { const bales = num(p.bales); const to = names.lot(p.herd_lot_id); const who = to ? ` to ${to}` : ''; return bales == null ? `Hay fed${who}${suffix}` : `Fed ${plural(bales, 'bale')}${who}${suffix}` }
    case 'bales_stacked': { const count = num(p.count); return count == null ? `Bales stacked${suffix}` : `Stacked ${plural(count, 'bale')}${suffix}` }
    case 'bunch_seen': { const lot = names.lot(p.herd_lot_id); return `Seen ${lot ?? 'cattle'}${suffix}` }   // Block 30
    case 'cattle_moved': return moveLine(num(p.head), names.bunch(p.herd_lot_id), names.place(p.from_place_id), names.place(p.to_place_id), isPlacement(p))   // Block 25: the one move wording
    case 'cattle_worked': { const head = num(p.head); const what = str(p.what); const lot = names.lot(p.herd_lot_id); const who = (head == null ? 'cattle' : `${head.toLocaleString()} head`) + (lot ? ` of ${lot}` : ''); return `${what ? what[0].toUpperCase() + what.slice(1) : 'Worked'} ${who}${suffix}` }
    case 'cattle_counted': { const c = num(p.counted); const e = num(p.expected); const lot = names.lot(p.herd_lot_id); return `Counted ${c == null ? 'cattle' : `${c.toLocaleString()} head`}${lot ? ` of ${lot}` : ''}${e != null && c != null ? ` · ${e.toLocaleString()} expected · ${c - e === 0 ? 'same' : c - e > 0 ? `+${c - e}` : `−${e - c}`}` : ''}${suffix}` }
    case 'hay_inventory': { const bales = num(p.bales); const asOf = str(p.as_of); const when = asOf ? ` as of ${fmtDay(`${asOf}T12:00:00-06:00`)}` : ''; return bales == null ? `Bales on hand counted${when}` : `${plural(bales, 'bale')} on hand${when}${suffix}` }
    case GROUP_ACTION_TYPE: {
      // One line, like every other row (8B.3). The full arithmetic is on the
      // entry's own page; this says what happened and where they went.
      const action = str(p.action)
      const label = isGroupAction(action) ? GROUP_ACTION_LABELS[action] : 'Worked'
      const counted = num(p.counted)
      const from = str(p.source_name)
      const results = Array.isArray(p.results) ? p.results as { name?: unknown; head?: unknown }[] : []
      const moved = results
        .map(x => { const h = num(x.head); const n = str(x.name); return h == null || !n ? null : `${h.toLocaleString()} to ${n}` })
        .filter((x): x is string => x !== null).join(', ')
      // Block 19: a split counted nothing — nobody stood at a chute. It says
      // which bunch split, who left, and how many stayed.
      if (action === 'split') {
        const stayed = num(p.stayed)
        return `Split${from ? ` ${from}` : ''}${moved ? ` · ${moved}` : ''}${stayed == null ? '' : ` · ${stayed.toLocaleString()} stay`}`
      }
      return `${label}${counted == null ? '' : ` · ${counted.toLocaleString()} counted`}${from ? ` from ${from}` : ''}${moved ? ` · ${moved}` : ' · none moved'}`
    }
    case 'alert': return alertLine(p) ?? 'Alert'   // never reached for a row listActivity dropped — see alertLine
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
    case 'cattle_counted': { const c = num(p.counted); return c == null ? null : `${c.toLocaleString()} head counted` }
    default: return null
  }
}

// ── Names for a set of rows ───────────────────────────────────────────────────
async function namesFor(supabase: SupabaseClient, userId: string, rows: ActivityRow[]): Promise<Names> {
  const placeIds = new Set<string>(); const userIds = new Set<string>(); const lotIds = new Set<string>()
  for (const r of rows) { userIds.add(r.user_id); for (const k of ['place_id', 'from_place_id', 'to_place_id', 'stock_place_id']) { const v = str(r.payload[k]); if (v) placeIds.add(v) }; const l = str(r.payload.herd_lot_id); if (l) lotIds.add(l) }   // stock_place_id: the stack hay was taken from (6E)
  // Block 13: NEVER ORPHAN AN EVENT. A place or bunch in the trash still names
  // itself on every entry that pointed at it — read without the live filter,
  // and say "gone" beside the name rather than dropping it to a blank.
  const [places, profiles, lots, trashedLots] = await Promise.all([
    placeIds.size ? supabase.from('places').select('id, name, deleted_at').in('id', [...placeIds]) : Promise.resolve({ data: [] as { id: string; name: string; deleted_at: string | null }[] }),
    userIds.size ? createServiceClient().from('profiles').select('id, display_name, email').in('id', [...userIds]) : Promise.resolve({ data: [] as { id: string; display_name: string | null; email: string | null }[] }),
    getRanchLotsIncludingRetired(supabase, userId),
    lotIds.size ? supabase.from('herd_lots').select('id, name, class, deleted_at').in('id', [...lotIds]).not('deleted_at', 'is', null) : Promise.resolve({ data: [] as { id: string; name: string | null; class: string; deleted_at: string }[] }),
  ])
  const placeNames = new Map((places.data ?? []).map(p => [p.id as string, removedName(p.name as string, !!(p as { deleted_at?: string | null }).deleted_at)]))
  const people = new Map((profiles.data ?? []).map(p => [p.id as string, ((p.display_name as string | null)?.trim() || (p.email as string | null) || 'Someone on the ranch')]))
  const lotNames = new Map((lots as Lot[]).map(l => [l.id, lotLabel(l)]))
  const bunches = new Map<string, MovedBunch>((lots as Lot[]).map(l => [l.id, { name: l.name, class: l.class }]))
  for (const l of (trashedLots.data ?? []) as { id: string; name: string | null; class: string }[]) if (!lotNames.has(l.id)) lotNames.set(l.id, removedName(l.name?.trim() || l.class, true))
  for (const l of (trashedLots.data ?? []) as { id: string; name: string | null; class: string }[]) if (!bunches.has(l.id)) bunches.set(l.id, { name: l.name, class: l.class as Lot['class'], deleted: true })
  return {
    place: id => { const s = str(id); return s ? placeNames.get(s) ?? null : null },
    lot: id => { const s = str(id); return s ? lotNames.get(s) ?? null : null },
    bunch: id => { const s = str(id); return s ? bunches.get(s) ?? null : null },
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
// A few days at a time (Block 37, ruling 3). FETCH_ROWS bounds one read; a day
// with more rows than that is still one page, ended by the cap.
export const DAYS_PER_PAGE = 3
const FETCH_ROWS = 400

export async function listActivity(supabase: SupabaseClient, userId: string, filters: ActivityFilters, cursor?: string | null): Promise<ActivityPage | null> {
  const ranchId = await resolveRanchId(supabase, userId)
  if (!ranchId) return null
  // 7D: the record shows what stands and what was crossed out, but never what
  // was DELETED — that is the point of deleting it. `live` is the only filter
  // the record applies; superseded and voided rows still belong here.
  let q = live(supabase.from('events').select(ACTIVITY_COLS))
    .eq('ranch_id', ranchId).in('type', [...ACTIVITY_TYPES])
    .order('ts', { ascending: false }).order('id', { ascending: false }).limit(FETCH_ROWS + 1)
  if (filters.actor) q = q.eq('user_id', filters.actor)
  if (filters.place) q = q.or(placePredicate(filters.place))
  if (filters.lot) q = q.eq('payload->>herd_lot_id', filters.lot)
  if (filters.from && DAY.test(filters.from)) q = q.gte('ts', ranchDayStartIso(filters.from))
  if (filters.to && DAY.test(filters.to)) q = q.lt('ts', ranchDayEndIso(filters.to))
  if (filters.since && !Number.isNaN(Date.parse(filters.since))) q = q.gt('created_at', new Date(filters.since).toISOString())   // Block 27: made since, not arrived since
  if (cursor) {
    const [cts, cid] = cursor.split('|')
    if (cts && cid) q = q.or(`ts.lt.${cts},and(ts.eq.${cts},id.lt.${cid})`)
  }
  const { data } = await q
  // 12.9: an alert that cannot say what it is does not show — see alertLine.
  const all = ((data ?? []) as ActivityRow[]).filter(r => r.type !== 'alert' || alertLine(r.payload) !== null)
  // Block 37 (ruling 3): the page is a few DAYS, not fifty rows — a list longer
  // than a screen is a failure to group, and a busy day never splits across
  // pages. The first DAYS_PER_PAGE ranch days present are shown whole; the
  // cursor (ts|id) stays what it was, so more days are one tap away.
  let cut = all.length
  const days = new Set<string>()
  for (let i = 0; i < all.length; i++) {
    const d = dayKey(all[i].ts)
    if (!days.has(d)) { if (days.size === DAYS_PER_PAGE) { cut = i; break }; days.add(d) }
  }
  const rows = all.slice(0, Math.min(cut, FETCH_ROWS))
  const last = rows[rows.length - 1]
  const nextCursor = all.length > rows.length && last ? `${last.ts}|${last.id}` : null
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
  // A deleted link in a chain is not shown either — the chain walk stops where
  // the visible record stops.
  const hop = async (nextId: string | null | undefined) => nextId ? ((await live(supabase.from('events').select(ACTIVITY_COLS)).eq('id', nextId).maybeSingle()).data as ActivityRow | null) : null
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
export async function filterOptions(supabase: SupabaseClient, userId: string): Promise<{ people: { id: string; name: string }[]; places: { id: string; name: string; retired?: boolean }[]; lots: { id: string; name: string; retired?: boolean }[] }> {
  const ranchId = await resolveRanchId(supabase, userId)
  if (!ranchId) return { people: [], places: [], lots: [] }
  const [{ data: members }, { data: places }, lots] = await Promise.all([
    createServiceClient().from('ranch_members').select('user_id').eq('ranch_id', ranchId),
    // Tolerant of a database without 057 — there, no place is retired.
    liveOnly(supabase.from('places').select('id, name, retired_at').eq('ranch_id', ranchId)).order('name')
      .then(async r => (r.error
        ? { data: (((await supabase.from('places').select('id, name').eq('ranch_id', ranchId).order('name')).data ?? []) as { id: string; name: string }[]).map(x => ({ ...x, retired_at: null as string | null })) }
        : { data: (r.data ?? []) as { id: string; name: string; retired_at: string | null }[] })),
    getRanchLotsIncludingRetired(supabase, userId),
  ])
  const ids = (members ?? []).map(m => m.user_id as string)
  const { data: profiles } = ids.length ? await createServiceClient().from('profiles').select('id, display_name, email').in('id', ids) : { data: [] }
  return {
    // Every member is listed — a member with no profiles row yet is still a person
    // whose entries can be filtered, named the way the record's lines name them.
    people: ids.map(id => { const p = (profiles ?? []).find(x => x.id === id); return { id, name: ((p?.display_name as string | null)?.trim() || (p?.email as string | null) || 'Someone on the ranch') } }).sort((a, b) => a.name.localeCompare(b.name)),
    // Retired places are LISTED AND FLAGGED here, not hidden — the same as
    // retired lots below. This is the correction form's picker: an old entry
    // that happened at a place since retired must be able to keep naming it,
    // and the operator has to be able to see that is what they are doing.
    // (The logging picker, GET /api/places, is live-only.)
    places: (places ?? []).map(p => ({ id: p.id as string, name: p.name as string, ...(p.retired_at ? { retired: true } : {}) })),
    lots: (lots as Lot[]).map(l => ({ id: l.id, name: lotLabel(l), ...(l.retired_at ? { retired: true } : {}) })),   // retired lots are named, and say so (6A)
  }
}
