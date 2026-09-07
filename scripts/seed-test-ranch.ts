// ─── Durable test ranch on PRODUCTION (PK's instruction, 2026-09-06) ─────────
//
// Seeds "Test Ranch" once and leaves it there: a dedicated owner, a second
// member for the two-person path, Petroleum County as home, two cattle lots, a
// stackyard and a pasture, a hay count, three weeks of feed events (some logged
// by the hand) and two rain readings — enough for season totals, place history,
// and "since you last checked" to show something real.
//
// NO TEARDOWN. The two accounts are excluded from every smoke teardown by
// construction: those key on their own exact emails and PREFIX-named ranches.
// Rows are written the way the app writes them (lib/manual-log payload shapes),
// so nothing here is a fixture the app would not have produced itself.
//
// ranch_members has NO client INSERT policy (membership is the RLS gate, 043),
// so the second member can only be added with the service role — the same
// reason the invite flow is a blocker for any ranch we do not seed by hand.
//
// Refuses to run if either account already exists (re-run = delete them first
// by hand). Prints the credentials ONCE; they are not stored anywhere.
//
//   npx tsx scripts/seed-test-ranch.ts

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

function loadEnv() {
  for (const f of ['.env', '.env.local']) {
    const path = resolve(process.cwd(), f)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
    }
  }
}
loadEnv()

export const TEST_RANCH_NAME = 'Test Ranch'
export const TEST_OWNER_EMAIL = 'kiehl.preston+testranch@gmail.com'
export const TEST_HAND_EMAIL = 'kiehl.preston+testhand@gmail.com'
const HOME_FIPS = '30069'   // Petroleum County, MT

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
const pw = () => `tr-${randomBytes(9).toString('base64url')}`
const mtNoon = (day: string, hour = 8) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00-06:00`).toISOString()
const must = <T,>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => { if (r.error || r.data == null) throw new Error(`${what}: ${r.error?.message ?? 'no row'}`); return r.data as NonNullable<T> }

async function main() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const clash = (users?.users ?? []).filter(u => u.email === TEST_OWNER_EMAIL || u.email === TEST_HAND_EMAIL)
  if (clash.length) throw new Error(`refusing: ${clash.map(u => u.email).join(', ')} already exist — this seed runs once`)

  const ownerPw = pw(), handPw = pw()
  const mk = async (email: string, password: string, name: string) => {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { test_ranch: true, name } })
    if (error || !data.user) throw new Error(`create ${email}: ${error?.message ?? 'no user'}`)
    return data.user
  }
  const owner = await mk(TEST_OWNER_EMAIL, ownerPw, 'Test Owner')
  const hand = await mk(TEST_HAND_EMAIL, handPw, 'Test Hand')

  const ranch = must(await admin.from('ranches').insert({ name: TEST_RANCH_NAME }).select('id').single(), 'ranch') as { id: string }
  const ranchId = ranch.id
  // Service-role writes: ranch_members has no client INSERT policy.
  must(await admin.from('ranch_members').insert({ ranch_id: ranchId, user_id: owner.id, role: 'owner', last_seen_at: mtNoon('2026-09-03', 20) }).select('user_id'), 'owner membership')
  must(await admin.from('ranch_members').insert({ ranch_id: ranchId, user_id: hand.id, role: 'member' }).select('user_id'), 'hand membership')
  must(await admin.from('profiles').upsert({ id: owner.id, email: TEST_OWNER_EMAIL, home_county_fips: HOME_FIPS, display_name: 'Test Owner' }).select('id'), 'owner profile')
  must(await admin.from('profiles').upsert({ id: hand.id, email: TEST_HAND_EMAIL, home_county_fips: HOME_FIPS, display_name: 'Test Hand' }).select('id'), 'hand profile')

  const steers = randomUUID(), heifers = randomUUID()
  const stamp = { frame: 'Medium and Large', weaned: true, sale_windows: [], created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-10T00:00:00Z' }
  const lots = [
    { id: steers, class: 'steers', name: 'Steer calves', head_count: 180, avg_weight: 550, weight_unit: 'lb', ...stamp },
    { id: heifers, class: 'heifers', name: 'Replacement heifers', head_count: 40, avg_weight: 600, weight_unit: 'lb', ...stamp },
  ]
  // Block 4B: lots are rows on herd_lots; the profile row carries the county and the pin.
  must(await admin.from('operation_profiles').insert({ user_id: owner.id, ranch_id: ranchId, county_fips: HOME_FIPS }).select('id'), 'operation profile')
  must(await admin.from('herd_lots').insert(lots.map(l => ({ id: l.id, ranch_id: ranchId, class: l.class, name: l.name, head_count: l.head_count, avg_weight: l.avg_weight, weight_unit: l.weight_unit, frame: l.frame, weaned: l.weaned, sale_windows: l.sale_windows, created_by: owner.id, updated_by: owner.id }))).select('id'), 'herd lots')

  const stack = must(await admin.from('places').insert({ user_id: owner.id, ranch_id: ranchId, name: 'North stackyard', kind: 'stackyard' }).select('id').single(), 'stackyard') as { id: string }
  const pasture = must(await admin.from('places').insert({ user_id: owner.id, ranch_id: ranchId, name: 'Home pasture', kind: 'pasture' }).select('id').single(), 'pasture') as { id: string }

  const ev = (user_id: string, type: string, ts: string, payload: Record<string, unknown>) =>
    ({ user_id, ranch_id: ranchId, device_id: null, type, ts, lat: null, lng: null, payload: { source: 'manual', schema_version: 1, ...payload }, schema_version: 1, dedup_key: null })
  const rows: ReturnType<typeof ev>[] = []
  // The counted baseline: 420 bales in the North stackyard as of Aug 10.
  rows.push(ev(owner.id, 'hay_inventory', mtNoon('2026-08-10', 18), { place_id: stack.id, bales: 420, as_of: '2026-08-10' }))
  // Three weeks of feeding at the Home pasture, most days, 4–6 bales to the steer lot;
  // the hand logs the last stretch so the owner's "since you last checked" has news.
  const feedDays: [string, number, 'owner' | 'hand'][] = [
    ['2026-08-15', 4, 'owner'], ['2026-08-16', 4, 'owner'], ['2026-08-18', 5, 'owner'], ['2026-08-19', 4, 'owner'], ['2026-08-20', 5, 'owner'],
    ['2026-08-22', 5, 'owner'], ['2026-08-23', 4, 'owner'], ['2026-08-25', 6, 'owner'], ['2026-08-26', 5, 'owner'], ['2026-08-27', 5, 'owner'],
    ['2026-08-29', 5, 'owner'], ['2026-08-30', 4, 'owner'], ['2026-09-01', 5, 'owner'], ['2026-09-02', 5, 'owner'], ['2026-09-03', 6, 'owner'],
    ['2026-09-04', 5, 'hand'], ['2026-09-05', 5, 'hand'], ['2026-09-06', 6, 'hand'],
  ]
  for (const [day, bales, who] of feedDays) rows.push(ev(who === 'owner' ? owner.id : hand.id, 'hay_fed', mtNoon(day, 7), { place_id: pasture.id, bales, herd_lot_id: steers }))
  // Two rain readings at the Home pasture gauge.
  rows.push(ev(owner.id, 'rain', mtNoon('2026-08-22', 19), { place_id: pasture.id, inches: 0.35 }))
  rows.push(ev(hand.id, 'rain', mtNoon('2026-09-02', 19), { place_id: pasture.id, inches: 0.8 }))
  const inserted = must(await admin.from('events').insert(rows).select('id'), 'events') as { id: string }[]

  console.log(`\nTest Ranch seeded on ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
  console.log(`  ranch_id  ${ranchId}`)
  console.log(`  owner     ${TEST_OWNER_EMAIL}  (uid ${owner.id})  password: ${ownerPw}`)
  console.log(`  hand      ${TEST_HAND_EMAIL}   (uid ${hand.id})  password: ${handPw}`)
  console.log(`  places    North stackyard ${stack.id} · Home pasture ${pasture.id}`)
  console.log(`  lots      Steer calves 180 @ 550 lb (${steers}) · Replacement heifers 40 @ 600 lb (${heifers})`)
  console.log(`  events    ${inserted.length}: 1 hay count (420 bales, Aug 10) · ${feedDays.length} hay_fed (${feedDays.reduce((s, f) => s + f[1], 0)} bales, Aug 15 – Sep 6, last 3 by the hand) · 2 rain (0.35 in Aug 22, 0.80 in Sep 2)`)
  console.log(`  owner last_seen_at Sep 3 20:00 MT → the hand's Sep 4–6 entries are "since you last checked"\n`)
}
main().catch(e => { console.error('seed failed:', e.message); process.exit(1) })
