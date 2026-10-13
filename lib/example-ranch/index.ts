import 'server-only'
import fixture from './fixture.json'
import type { Lot } from '@/lib/herd'
import { lotLabel } from '@/lib/herd'
import type { ActivityRow, ActivityPage, ActivityFilters, Names, EventDetail } from '@/lib/activity'
import { ACTIVITY_TYPES, describeEvent, quantityOf, standingRows } from '@/lib/activity'
import type { RanchView } from '@/lib/ranch-view'
import { LOT_CLASS_LABELS, type LotClass } from '@/lib/herd'
import { summarizeHay, sinceCount, type HayEntry, type HayLedger } from '@/lib/hay/queries'
import type { TurnoutState } from '@/lib/hay/turnout'
import type { PlaceRow } from '@/lib/places/rows'
import type { PlaceHistory, PlaceMemory } from '@/lib/places/history'
import { whenLabel } from '@/lib/places/history'
import type { LastWork } from '@/lib/ranch-summary'
import type { LastFeeding } from '@/app/dashboard/components/RepeatLastCard'
import { dayKey, fmtDay, fmtTime, plural, todayKey, RANCH_TZ } from '@/lib/jobs/format'
import { isManualEventType } from '@/lib/manual-log'

// ─── The Dry Creek example ranch (Block 49, ruling R2) ───────────────────────
// What a signed-out person sees on Today and Ranch: a real-looking ranch,
// rendered from the committed fixture and nothing else. No ranch table is
// read, no policy was added. The fixture stores every date as a day offset,
// so the records are rehydrated against the ranch's today on each render —
// the newest feeding is always "yesterday", however old the snapshot gets.
// Every reader here is the pure shape of its database twin (listActivity,
// getEvent, getPlaceHistory, lastWorkByLot, ranchView), so the pages render
// the example with the same components and the same words.

export const EXAMPLE_RANCH_NAME = fixture.ranch.name

interface FixtureEvent {
  id: string; type: string; user: string
  dayOffset: number; clock: string; madeDayOffset: number; madeClock: string
  payload: Record<string, unknown>
  supersedes_event_id: string | null; superseded_by: string | null
  voidedDayOffset: number | null; correction_reason: string | null
}

export interface ExampleRanch {
  name: string
  today: string
  people: { id: string; name: string; role: string }[]
  lots: Lot[]
  places: PlaceRow[]
  /** Every record, rehydrated, newest first — including the ones the record never lists (head_count_set, turnout). */
  events: ActivityRow[]
  /** The record's rows: the activity types, newest first. */
  rows: ActivityRow[]
  names: Names
  lastSeenIso: string
  hay: HayLedger
  turnout: TurnoutState
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function dayFrom(today: string, offset: number): string {
  return new Date(Date.parse(`${today}T12:00:00Z`) - offset * 86_400_000).toISOString().slice(0, 10)
}
// The UTC instant at which the ranch reads `day` at `clock` (HH:MM:SS).
function zoned(day: string, clock: string): string {
  const guess = Date.parse(`${day}T${clock}Z`)
  for (const offsetH of [6, 7]) {   // MDT, MST
    const t = new Date(guess + offsetH * 3_600_000)
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: RANCH_TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(t)
    const get = (k: string) => parts.find(p => p.type === k)?.value ?? ''
    if (`${get('year')}-${get('month')}-${get('day')}` === day && parseInt(get('hour'), 10) % 24 === parseInt(clock.slice(0, 2), 10)) return t.toISOString()
  }
  return new Date(guess + 6 * 3_600_000).toISOString()
}

let cached: ExampleRanch | null = null

/** The example ranch as of the ranch's today. Built once per ranch day. */
export function exampleRanch(): ExampleRanch {
  const today = todayKey()
  if (cached && cached.today === today) return cached
  const at = (off: number, clock: string) => zoned(dayFrom(today, off), clock)

  const lots: Lot[] = fixture.lots.map(l => ({
    id: l.id, class: l.class as LotClass, head_count: l.head_count, avg_weight: l.avg_weight, weight_unit: l.weight_unit as Lot['weight_unit'],
    ...(l.place_id ? { place_id: l.place_id } : {}),
    frame: l.frame as Lot['frame'], weaned: l.weaned, sale_windows: [],
    ...(l.name ? { name: l.name } : {}), ...(l.purpose ? { purpose: l.purpose as Lot['purpose'] } : {}),
    created_at: at(l.createdDayOffset, '08:00:00'), updated_at: at(l.createdDayOffset, '08:00:00'),
  }))

  const events: ActivityRow[] = (fixture.events as FixtureEvent[]).map(e => {
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(e.payload)) payload[k] = v && typeof v === 'object' && 'dayOffset' in (v as object) ? dayFrom(today, (v as { dayOffset: number }).dayOffset) : v
    const ts = at(e.dayOffset, e.clock)
    const made = at(e.madeDayOffset, e.madeClock)
    return {
      id: e.id, type: e.type, ts, ingested_at: made, created_at: made, user_id: e.user, device_id: null, payload,
      supersedes_event_id: e.supersedes_event_id, superseded_by: e.superseded_by,
      voided_at: e.voidedDayOffset == null ? null : at(e.voidedDayOffset, e.clock), correction_reason: e.correction_reason,
    }
  }).sort((a, b) => b.ts.localeCompare(a.ts) || b.id.localeCompare(a.id))

  const placeName = new Map(fixture.places.map(p => [p.id, p.name]))
  const lotName = new Map(lots.map(l => [l.id, lotLabel(l)]))
  const person = new Map(fixture.people.map(p => [p.id, p.name]))
  const names: Names = {
    place: id => { const s = str(id); return s ? placeName.get(s) ?? null : null },
    lot: id => { const s = str(id); return s ? lotName.get(s) ?? null : null },
    bunch: id => { const s = str(id); const l = lots.find(x => x.id === s); return l ? { name: l.name, class: l.class } : null },
    person: uid => person.get(uid) ?? 'Someone on the ranch',
  }

  const standing = (rows: ActivityRow[]) => rows.filter(r => !r.superseded_by && !r.voided_at)
  const places: PlaceRow[] = fixture.places.map(p => {
    const here = standing(events).filter(r => str(r.payload.place_id) === p.id)
    const work = here.find(r => isManualEventType(r.type) && r.type !== 'rain') ?? null
    const rain = here.find(r => r.type === 'rain' && num(r.payload.inches) != null) ?? null
    return { id: p.id, name: p.name, kind: p.kind, retiredAt: null, parentId: p.parent_id, lastWork: work ? { ts: work.ts, type: work.type } : null, lastRain: rain ? { ts: rain.ts, inches: num(rain.payload.inches)! } : null, ring: null, acres: p.acres }
  })

  // Hay — the same pure summariser the ledger uses, over the standing hay lines.
  const hayEntries: HayEntry[] = []
  for (const r of standing(events)) {
    const p = r.payload
    if (p.source !== 'manual') continue
    const bales = r.type === 'bales_stacked' ? num(p.count) : r.type === 'hay_fed' || r.type === 'hay_inventory' ? num(p.bales) : null
    if (bales == null) continue
    if (r.type === 'hay_inventory' && !str(p.as_of)) continue
    hayEntries.push({ id: r.id, type: r.type as HayEntry['type'], ts: r.ts, bales, place_id: str(p.place_id), herd_lot_id: str(p.herd_lot_id), as_of: str(p.as_of) })
  }
  const anchor = hayEntries.filter(e => e.type === 'hay_inventory').sort((a, b) => (b.as_of ?? '').localeCompare(a.as_of ?? '') || b.ts.localeCompare(a.ts))[0] ?? null
  const entries = sinceCount(hayEntries, anchor?.as_of ?? null).sort((a, b) => a.ts.localeCompare(b.ts))
  const hay: HayLedger = { entries, summary: summarizeHay(entries) }

  const turnouts = standing(events).filter(r => r.type === 'turnout' && str(r.payload.date)).map(r => ({ id: r.id, date: str(r.payload.date)!, setAt: r.ts })).sort((a, b) => b.setAt.localeCompare(a.setAt))
  const upcoming = turnouts.find(t => t.date >= today) ?? null
  const last = turnouts.find(t => t.date < today) ?? null

  cached = {
    name: fixture.ranch.name, today, people: fixture.people, lots, places, events,
    rows: events.filter(r => (ACTIVITY_TYPES as readonly string[]).includes(r.type)),
    names, lastSeenIso: at(fixture.lastSeenDayOffset, '20:00:00'), hay, turnout: { upcoming, last },
  }
  return cached
}

/** The Ranch view's three numbers, from the fixture (the pure half of ranchView). */
export function exampleView(): RanchView {
  const { lots, hay, places } = exampleRanch()
  const by = new Map<string, { head: number; bunches: number }>()
  for (const l of lots) { const e = by.get(l.class) ?? { head: 0, bunches: 0 }; e.head += l.head_count; e.bunches += 1; by.set(l.class, e) }
  const head = lots.length ? { total: lots.reduce((n, l) => n + l.head_count, 0), bunches: lots.length, byClass: [...by.entries()].sort((a, b) => b[1].head - a[1].head).map(([k, v]) => ({ label: LOT_CLASS_LABELS[k as LotClass] ?? k, head: v.head, bunches: v.bunches })) } : null
  const s = hay.summary
  const r = s.runOut
  const hayNumber = s.onHand ? {
    onHand: s.onHand.bales, baselineAsOf: s.onHand.baseline.asOf, countedBales: s.onHand.baseline.bales, stackedSince: s.onHand.stackedSince.bales, fedSince: s.onHand.fedSince.bales,
    daysLeft: r.date ? r.daysLeft : null,
    withheld: r.date ? null : (r.withheld === 'no_baseline' ? null : (r.withheld ?? null)),
    rate: s.burnRate ? { balesPerDay: s.burnRate.balesPerDay, windowDays: s.burnRate.windowDays, daysWithEntries: s.burnRate.daysWithEntries, bales: s.burnRate.bales } : null,
    fedThisSeason: s.fed ? { bales: s.fed.bales, entries: s.fed.entries, days: s.fed.days } : null,
  } : null
  // Rain this season on the ranch's places — no county normal: the example ranch has no county.
  const { rows } = exampleRanch()
  const year = exampleRanch().today.slice(0, 4)
  const rain = rows.filter(x => x.type === 'rain' && !x.superseded_by && !x.voided_at && num(x.payload.inches) != null && x.ts.slice(0, 4) === year)
  const rainNumber = rain.length ? { recorded: Math.round(rain.reduce((n, x) => n + num(x.payload.inches)!, 0) * 100) / 100, entries: rain.length, places: new Set(rain.map(x => str(x.payload.place_id)).filter(Boolean)).size, normal: null, normalSource: null, year } : null
  const acres = new Map<string, { acres: number; places: number }>()
  for (const p of places) { if (typeof p.acres !== 'number') continue; const e = acres.get(p.kind) ?? { acres: 0, places: 0 }; e.acres += p.acres; e.places += 1; acres.set(p.kind, e) }
  return { head, hay: hayNumber, rain: rainNumber, acresByKind: [...acres.entries()].map(([kind, v]) => ({ kind, ...v })) }
}

/** The record (listActivity's shape), filtered in memory. One page: the example is small. */
export function exampleActivityPage(filters: ActivityFilters = {}): ActivityPage {
  const { rows, names } = exampleRanch()
  let list = rows
  if (filters.actor) list = list.filter(r => r.user_id === filters.actor)
  if (filters.place) list = list.filter(r => [r.payload.place_id, r.payload.from_place_id, r.payload.to_place_id].includes(filters.place))
  if (filters.lot) list = list.filter(r => r.payload.herd_lot_id === filters.lot)
  if (filters.from) list = list.filter(r => dayKey(r.ts) >= filters.from!)
  if (filters.to) list = list.filter(r => dayKey(r.ts) <= filters.to!)
  if (filters.since && !Number.isNaN(Date.parse(filters.since))) list = list.filter(r => Date.parse(r.created_at) > Date.parse(filters.since!))
  return { rows: list, names, nextCursor: null, ranchId: 'example', filters }
}

export function exampleFilterOptions(): { people: { id: string; name: string }[]; places: { id: string; name: string }[]; lots: { id: string; name: string }[] } {
  const { people, places, lots } = exampleRanch()
  return { people: people.map(p => ({ id: p.id, name: p.name })), places: places.map(p => ({ id: p.id, name: p.name })), lots: lots.map(l => ({ id: l.id, name: lotLabel(l) })) }
}

/** One record, by id (getEvent's shape). Nothing on the example can be corrected. */
export function exampleEvent(id: string): EventDetail | null {
  const { rows, names, people } = exampleRanch()
  const byId = new Map(rows.map(r => [r.id, r]))
  const row = byId.get(id)
  if (!row) return null
  const corrects: ActivityRow[] = []
  for (let cur = row.supersedes_event_id ? byId.get(row.supersedes_event_id) : undefined; cur && corrects.length < 25; cur = cur.supersedes_event_id ? byId.get(cur.supersedes_event_id) : undefined) corrects.push(cur)
  const correctedBy: ActivityRow[] = []
  for (let cur = row.superseded_by ? byId.get(row.superseded_by) : undefined; cur && correctedBy.length < 25; cur = cur.superseded_by ? byId.get(cur.superseded_by) : undefined) correctedBy.push(cur)
  const role = people.find(p => p.id === row.user_id)?.role
  return {
    row, names, actorRole: role === 'owner' ? 'owner' : role ? 'member' : 'former member',
    line: describeEvent(row, names), quantity: quantityOf(row),
    placeId: str(row.payload.place_id) ?? str(row.payload.to_place_id), lotId: str(row.payload.herd_lot_id),
    corrects, correctedBy, head: correctedBy[correctedBy.length - 1] ?? row, canCorrect: false,
  }
}

/** A place and what it remembers (getPlaceHistory's shape), plus its activity rows. */
export function examplePlace(id: string): { history: PlaceHistory; activity: ActivityPage } | null {
  const { places, rows, names, lots } = exampleRanch()
  const p = places.find(x => x.id === id)
  if (!p) return null
  const activity = exampleActivityPage({ place: id })
  const all = standingRows(activity.rows).filter(r => !r.voided_at)
  const first = (pred: (r: ActivityRow) => boolean) => all.find(pred) ?? null
  const memory: PlaceMemory[] = []
  const push = (kind: PlaceMemory['kind'], label: string, r: ActivityRow | null, answer: (p: Record<string, unknown>) => string) => {
    if (!r) return
    const a = answer(r.payload)
    memory.push({ kind, label, answer: `${whenLabel(r.ts)} · ${a}`, ts: r.ts, eventId: r.id, detail: a })
  }
  push('feeding', 'Last recorded feeding', first(r => r.type === 'hay_fed'), q => { const b = num(q.bales); const to = names.lot(q.herd_lot_id); return `${b == null ? 'hay' : plural(b, 'bale')}${to ? ` to ${to}` : ''}` })
  push('rain', 'Last recorded rain', first(r => r.type === 'rain'), q => { const i = num(q.inches); return i == null ? 'rain' : `${i.toFixed(2)}"` })
  push('stacked', 'Last bales stacked', first(r => r.type === 'bales_stacked'), q => { const c = num(q.count); return c == null ? 'bales' : plural(c, 'bale') })
  push('count', 'Last stack count', first(r => r.type === 'hay_inventory'), q => { const b = num(q.bales); const asOf = str(q.as_of); return `${b == null ? '?' : b.toLocaleString()} bales on hand${asOf ? ` as of ${fmtDay(`${asOf}T12:00:00-06:00`)}` : ''}` })
  push('worked', 'Last cattle worked', first(r => r.type === 'cattle_worked'), q => { const h = num(q.head); const w = str(q.what); return `${w ?? 'worked'} ${h == null ? 'cattle' : `${h.toLocaleString()} head`}` })
  memory.sort((a, b) => b.ts.localeCompare(a.ts))
  const oldest = activity.rows[activity.rows.length - 1]
  const parent = p.parentId ? places.find(x => x.id === p.parentId) ?? null : null
  void lots
  return {
    history: {
      place: { id: p.id, name: p.name, kind: p.kind, created_at: exampleRanch().lots[0]?.created_at ?? new Date().toISOString(), geometry: null, acres: p.acres, updated_at: oldest?.ts ?? new Date().toISOString(), updated_by: null, retired_at: null, deleted_at: null, parent_id: p.parentId, pinned_at: null },
      memory,
      counts: { entries: activity.rows.length, sinceIso: oldest?.ts ?? null },
      parent: parent ? { id: parent.id, name: parent.name, kind: parent.kind } : null,
      children: places.filter(x => x.parentId === p.id).map(x => ({ id: x.id, name: x.name, kind: x.kind })),
    },
    activity,
  }
}

/** Each bunch's last recorded work and last count (lastWorkByLot's shape). */
export function exampleLastWork(): Record<string, LastWork> {
  const { rows } = exampleRanch()
  const out: Record<string, LastWork> = {}
  for (const r of standingRows(rows).filter(r => !r.voided_at && r.payload.source === 'manual')) {
    const lot = str(r.payload.herd_lot_id)
    if (!lot) continue
    if (r.type === 'cattle_counted') {
      if (!out[lot]?.count && num(r.payload.counted) != null) out[lot] = { ...(out[lot] ?? { ts: '', eventId: '', bales: null, what: null, head: null }), count: { ts: r.ts, eventId: r.id, counted: num(r.payload.counted)!, expected: num(r.payload.expected) } }
      continue
    }
    if (r.type !== 'hay_fed' && r.type !== 'cattle_worked') continue
    if (out[lot]?.eventId) continue
    out[lot] = { ...(out[lot] ?? {}), ts: r.ts, eventId: r.id, bales: r.type === 'hay_fed' ? num(r.payload.bales) : null, what: r.type === 'cattle_worked' ? str(r.payload.what) : null, head: r.type === 'cattle_worked' ? num(r.payload.head) : null }
  }
  return out
}

/** Recorded since the owner last checked (the Today card's rows). */
export function exampleSince(): { rows: { id: string; who: string; line: string; workedAt: string; marker: 'voided' | 'corrected' | null }[]; total: number; lastSeen: string; newest: string | null } {
  const { rows, names, lastSeenIso, people } = exampleRanch()
  const owner = people.find(p => p.role === 'owner')?.id
  const fresh = rows.filter(r => r.user_id !== owner && Date.parse(r.created_at) > Date.parse(lastSeenIso)).sort((a, b) => b.created_at.localeCompare(a.created_at))
  return {
    rows: fresh.slice(0, 5).map(r => ({ id: r.id, who: names.person(r.user_id), line: describeEvent(r, names), workedAt: r.ts, marker: r.voided_at ? 'voided' : r.supersedes_event_id ? 'corrected' : null })),
    total: fresh.length, lastSeen: lastSeenIso, newest: fresh[0]?.created_at ?? null,
  }
}

/** The feedings the ranch repeats (RepeatLastFeeding's rows). */
export function exampleFeedings(): LastFeeding[] {
  const { rows, lots, names } = exampleRanch()
  const fed = standingRows(rows).filter(r => !r.voided_at && r.type === 'hay_fed' && num(r.payload.bales) != null)
  const perLot = new Map<string, { latest: ActivityRow; times: number }>()
  const floor = Date.now() - 14 * 86_400_000
  for (const r of fed) { if (Date.parse(r.ts) < floor) continue; const lot = str(r.payload.herd_lot_id); if (!lot) continue; const e = perLot.get(lot); if (e) e.times += 1; else perLot.set(lot, { latest: r, times: 1 }) }
  const chosen = new Map<string, ActivityRow>()
  if (fed[0]) chosen.set(fed[0].id, fed[0])
  for (const { latest, times } of perLot.values()) if (times >= 2) chosen.set(latest.id, latest)
  const when = (iso: string) => { const d = dayKey(iso); const t = fmtTime(iso); return d === todayKey() ? `today ${t}` : d === dayKey(Date.now() - 86_400_000) ? `yesterday ${t}` : `${fmtDay(iso)} ${t}` }
  return [...chosen.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 4).map(r => {
    const lotId = str(r.payload.herd_lot_id), placeId = str(r.payload.place_id)
    const lot = lotId ? lots.find(l => l.id === lotId) : undefined
    return { id: r.id, bales: num(r.payload.bales)!, lotId: lot ? lotId : null, lotLabel: lot ? lotLabel(lot) : null, placeId: names.place(placeId) ? placeId : null, placeName: names.place(placeId), whenLabel: when(r.ts) }
  })
}

/** Records made today on the example ranch (the number under the map). */
export function exampleTodayCount(): number {
  const { rows } = exampleRanch()
  return rows.filter(r => !r.voided_at && dayKey(r.ts) === todayKey()).length
}
