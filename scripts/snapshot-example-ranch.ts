// ─── The Dry Creek example ranch: one snapshot of the Test Ranch (Block 49) ───
//   npx tsx scripts/snapshot-example-ranch.ts        → lib/example-ranch/fixture.json
//
// Ruling R2: a signed-out Today and Ranch show an EXAMPLE ranch rendered from a
// static fixture committed to the repo — zero reads of ranch tables, no anon
// policy. This script makes that fixture, once, from the Test Ranch on
// production with the service role (a read; it writes nothing to the database).
//
// Scrubbed on the way out:
//   · people become Dry Creek's: the owner is Walt, the hand is Ray; no emails;
//   · every bunch, place and record the suites planted (AUDIT-, SIM-, Audit …)
//     is dropped, and so is every record that names one of them;
//   · notes are dropped (the Test Ranch's are audit notes);
//   · ids are re-minted (sha-1 of the original, shaped like a UUID) so no fixture
//     id equals a production row's;
//   · the Test Ranch has no geometry, so nothing here is anyone's ground.
// Dates are stored as DAY OFFSETS plus a clock, REBASED so the newest record
// is yesterday: the example always reads "yesterday, 4 bales" however old the
// snapshot gets. A payload day ('as_of', a turnout 'date') is stored as
// { dayOffset } and rehydrated the same way.
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

for (const f of ['.env', '.env.local']) {
  const p = resolve(process.cwd(), f)
  if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

const TEST_RANCH = '90d9fe59-9e41-4964-9728-a78eef262f64'
const RANCH_TZ = 'America/Denver'
const PLANTED = /^(AUDIT|SIM)\b|^Audit\b|AUDIT/i
const OUT = resolve(process.cwd(), 'lib/example-ranch/fixture.json')

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })

/** A new id for an old one: stable, UUID-shaped, never a production id. */
function remint(id: string): string {
  const h = createHash('sha1').update(`dry-creek:${id}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
// Ranch-day parts of an instant.
function ranchParts(iso: string): { day: string; clock: string } {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: RANCH_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: RANCH_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d)
  return { day, clock }
}
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T12:00:00Z`) / 86_400_000)

export interface FixtureEvent {
  id: string; type: string; user: string
  dayOffset: number; clock: string
  madeDayOffset: number; madeClock: string
  payload: Record<string, unknown>
  supersedes_event_id: string | null; superseded_by: string | null
  voidedDayOffset: number | null; correction_reason: string | null
}
export interface Fixture {
  ranch: { name: string }
  snapshotDay: string
  people: { id: string; name: string; role: string }[]
  lots: { id: string; class: string; name: string; head_count: number; avg_weight: number | null; weight_unit: string; frame: string; weaned: boolean; purpose: string | null; place_id: string | null; createdDayOffset: number }[]
  places: { id: string; name: string; kind: string; parent_id: string | null; acres: number | null }[]
  events: FixtureEvent[]
  lastSeenDayOffset: number
}

async function main() {
  const today = ranchParts(new Date().toISOString()).day
  const todayN = dayNumber(today)
  const offset = (iso: string) => { const { day, clock } = ranchParts(iso); return { off: todayN - dayNumber(day), clock } }

  const [members, lotsRes, placesRes, eventsRes] = await Promise.all([
    admin.from('ranch_members').select('user_id, role, last_seen_at').eq('ranch_id', TEST_RANCH),
    admin.from('herd_lots').select('id, class, name, head_count, avg_weight, weight_unit, frame, weaned, purpose, place_id, retired_at, created_at').eq('ranch_id', TEST_RANCH).is('retired_at', null),
    admin.from('places').select('id, name, kind, parent_id, acres, retired_at, deleted_at').eq('ranch_id', TEST_RANCH).is('retired_at', null).is('deleted_at', null),
    admin.from('events').select('id, type, ts, created_at, user_id, payload, supersedes_event_id, superseded_by, voided_at, correction_reason').eq('ranch_id', TEST_RANCH).is('device_id', null).order('ts', { ascending: false }),
  ])
  for (const r of [members, lotsRes, placesRes, eventsRes]) if (r.error) throw new Error(r.error.message)

  const owner = (members.data ?? []).find(m => m.role === 'owner')
  const hand = (members.data ?? []).find(m => m.role !== 'owner')
  if (!owner) throw new Error('no owner on the Test Ranch')
  const people = new Map<string, { id: string; name: string; role: string }>()
  people.set(owner.user_id, { id: remint(owner.user_id), name: 'Walt', role: 'owner' })
  if (hand) people.set(hand.user_id, { id: remint(hand.user_id), name: 'Ray', role: 'member' })

  const keepLots = (lotsRes.data ?? []).filter(l => !PLANTED.test(l.name ?? ''))
  const keepPlaces = (placesRes.data ?? []).filter(p => !PLANTED.test(p.name ?? ''))
  const lotIds = new Set(keepLots.map(l => l.id)), placeIds = new Set(keepPlaces.map(p => p.id))
  const idOk = (v: unknown, set: Set<string>) => v == null || v === '' || (typeof v === 'string' && set.has(v))

  const events: FixtureEvent[] = []
  for (const e of eventsRes.data ?? []) {
    const p = (e.payload ?? {}) as Record<string, unknown>
    if (!people.has(e.user_id)) continue
    if (typeof p.note === 'string' && PLANTED.test(p.note)) continue
    if (typeof p.what === 'string' && PLANTED.test(p.what)) continue
    if (!idOk(p.herd_lot_id, lotIds) || !idOk(p.lot_id, lotIds) || !idOk(p.source_lot_id, lotIds)) continue
    if (!idOk(p.place_id, placeIds) || !idOk(p.from_place_id, placeIds) || !idOk(p.to_place_id, placeIds) || !idOk(p.stock_place_id, placeIds)) continue
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(p)) {
      if (k === 'note') continue
      if (/_id$/.test(k) && typeof v === 'string' && v) payload[k] = remint(v)
      else if ((k === 'as_of' || k === 'date') && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) payload[k] = { dayOffset: todayN - dayNumber(v) }
      else payload[k] = v
    }
    const t = offset(e.ts), m = offset(e.created_at)
    events.push({
      id: remint(e.id), type: e.type, user: people.get(e.user_id)!.id,
      dayOffset: t.off, clock: t.clock, madeDayOffset: m.off, madeClock: m.clock,
      payload,
      supersedes_event_id: e.supersedes_event_id ? remint(e.supersedes_event_id) : null,
      superseded_by: e.superseded_by ? remint(e.superseded_by) : null,
      voidedDayOffset: e.voided_at ? offset(e.voided_at).off : null,
      correction_reason: e.correction_reason ?? null,
    })
  }
  // A chain link to a dropped record is no link.
  const have = new Set(events.map(e => e.id))
  for (const e of events) {
    if (e.supersedes_event_id && !have.has(e.supersedes_event_id)) e.supersedes_event_id = null
    if (e.superseded_by && !have.has(e.superseded_by)) e.superseded_by = null
  }
  // Rebase: the newest record becomes yesterday, every other day keeps its distance.
  const newest = Math.min(...events.map(e => e.dayOffset))
  const shift = Number.isFinite(newest) ? newest - 1 : 0
  const rebase = (o: number | null) => (o == null ? null : o - shift)
  for (const e of events) {
    e.dayOffset -= shift; e.madeDayOffset -= shift; e.voidedDayOffset = rebase(e.voidedDayOffset)
    for (const [k, v] of Object.entries(e.payload)) if (v && typeof v === 'object' && 'dayOffset' in v) e.payload[k] = { dayOffset: (v as { dayOffset: number }).dayOffset - shift }
  }

  const fixture: Fixture = {
    ranch: { name: 'Dry Creek Ranch' },
    snapshotDay: today,
    people: [...people.values()],
    lots: keepLots.map(l => ({ id: remint(l.id), class: l.class, name: l.name ?? '', head_count: l.head_count, avg_weight: l.avg_weight == null ? null : Number(l.avg_weight), weight_unit: l.weight_unit, frame: l.frame, weaned: l.weaned, purpose: l.purpose ?? null, place_id: l.place_id && placeIds.has(l.place_id) ? remint(l.place_id) : null, createdDayOffset: offset(l.created_at).off - shift })),
    places: keepPlaces.map(p => ({ id: remint(p.id), name: p.name, kind: p.kind, parent_id: p.parent_id && placeIds.has(p.parent_id) ? remint(p.parent_id) : null, acres: typeof p.acres === 'number' ? p.acres : null })),
    events,
    // The owner last checked the day before the hand's newest records were
    // made: "Recorded since you checked" has the hand's work to show.
    lastSeenDayOffset: (() => { const handId = hand ? people.get(hand.user_id)!.id : null; const made = events.filter(e => e.user === handId).map(e => e.madeDayOffset); return made.length ? Math.max(...made) + 1 : 2 })(),
  }
  writeFileSync(OUT, JSON.stringify(fixture, null, 1) + '\n')
  const byType: Record<string, number> = {}
  for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1
  console.log(`wrote ${OUT}`)
  console.log(`  ${fixture.lots.length} bunches · ${fixture.places.length} places · ${events.length} records ${JSON.stringify(byType)} · people ${fixture.people.map(p => p.name).join(', ')}`)
  console.log(`  dropped ${(lotsRes.data ?? []).length - keepLots.length} planted bunches, ${(placesRes.data ?? []).length - keepPlaces.length} planted places, ${(eventsRes.data ?? []).length - events.length} records`)
}
main().catch(e => { console.error('snapshot failed:', e instanceof Error ? e.message : e); process.exit(1) })
