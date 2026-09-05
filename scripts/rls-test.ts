// ─── Two-ranch isolation test (Block 1C, step 4) ───────────────────────────────
//
// Proves, against the LIVE database, that one ranch cannot read or write
// another ranch's ledger. Two synthetic users / ranches / places / devices and
// three events per ranch are created with the SERVICE ROLE, every name
// prefixed RLS-TEST- so it is obvious and deletable. Every assertion then runs
// through the ANON KEY + each user's own session JWT — the same path the app
// takes — never the service role. Teardown (start AND finish) deletes
// everything named RLS-TEST-*, so a crashed run leaves nothing behind for the
// next run to trip on.
//
//   npx tsx scripts/rls-test.ts                        # BASE=https://www.dryline.farm
//   BASE=https://<preview>.vercel.app npx tsx scripts/rls-test.ts
//
// Needs .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY. Optional VERCEL_BYPASS for a protected preview.
// Exit 1 on any FAIL — a FAIL blocks the block.
//
// Writes only RLS-TEST-* rows under the two synthetic accounts (the smoke
// scratch-account rule: nothing here touches a real ranch's ledger).

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const BASE = process.env.BASE ?? 'https://www.dryline.farm'
if (!URL_ || !ANON || !SERVICE) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY missing (.env.local)')

const PREFIX = 'RLS-TEST-'
const USERS = {
  A: { email: 'rls-test-a@dryline.farm', password: `${PREFIX}${randomBytes(12).toString('hex')}` },
  B: { email: 'rls-test-b@dryline.farm', password: `${PREFIX}${randomBytes(12).toString('hex')}` },
}
type Side = 'A' | 'B'
const OTHER: Record<Side, Side> = { A: 'B', B: 'A' }

const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

// ─── Result table ─────────────────────────────────────────────────────────────
const results: { who: string; check: string; pass: boolean; detail: string }[] = []
function record(who: string, check: string, pass: boolean, detail = '') {
  results.push({ who, check, pass, detail })
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
interface Fixture {
  userId: string
  ranchId: string
  placeId: string
  deviceId: string
  hardwareId: string
  token: string
  eventIds: string[]
}
const fx: Partial<Record<Side, Fixture>> = {}

async function teardown(label: string) {
  // Order respects FKs: events → devices → places → members → ranches → users.
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const ids = (users?.users ?? [])
    .filter(u => u.email === USERS.A.email || u.email === USERS.B.email)
    .map(u => u.id)
  let n = 0
  if (ids.length) {
    n += (await admin.from('events').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('devices').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('places').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('ranch_members').delete().in('user_id', ids).select('user_id')).data?.length ?? 0
  }
  n += (await admin.from('devices').delete().like('hardware_id', `${PREFIX}%`).select('id')).data?.length ?? 0
  n += (await admin.from('places').delete().like('name', `${PREFIX}%`).select('id')).data?.length ?? 0
  n += (await admin.from('ranches').delete().like('name', `${PREFIX}%`).select('id')).data?.length ?? 0
  for (const id of ids) { await admin.auth.admin.deleteUser(id); n++ }
  console.log(`teardown (${label}): removed ${n} row(s)/user(s)`)
}

async function seed(side: Side): Promise<Fixture> {
  const u = USERS[side]
  const { data: created, error: uErr } = await admin.auth.admin.createUser({
    email: u.email, password: u.password, email_confirm: true,
    user_metadata: { rls_test: true, name: `${PREFIX}${side}` },
  })
  if (uErr || !created.user) throw new Error(`createUser ${side}: ${uErr?.message}`)
  const userId = created.user.id

  const { data: ranch, error: rErr } = await admin.from('ranches').insert({ name: `${PREFIX}${side}` }).select('id').single()
  if (rErr) throw new Error(`ranch ${side}: ${rErr.message}`)
  const ranchId = ranch.id as string

  const { error: mErr } = await admin.from('ranch_members').insert({ ranch_id: ranchId, user_id: userId, role: 'owner' })
  if (mErr) throw new Error(`member ${side}: ${mErr.message}`)

  const { data: place, error: pErr } = await admin.from('places')
    .insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX}${side}-place`, kind: 'field' })
    .select('id').single()
  if (pErr) throw new Error(`place ${side}: ${pErr.message}`)

  const token = `${PREFIX}${randomBytes(16).toString('hex')}`
  const hardwareId = `${PREFIX}${side}-hw`
  const { data: device, error: dErr } = await admin.from('devices')
    .insert({
      user_id: userId, ranch_id: ranchId, hardware_id: hardwareId, type: 'scout',
      name: `${PREFIX}${side}-device`, place_id: place.id,
      token_hash: createHash('sha256').update(token).digest('hex'),
    })
    .select('id').single()
  if (dErr) throw new Error(`device ${side}: ${dErr.message}`)

  const eventIds: string[] = []
  for (let i = 0; i < 3; i++) {
    const { data: ev, error: eErr } = await admin.from('events')
      .insert({
        user_id: userId, ranch_id: ranchId, device_id: device.id, type: 'rls_test',
        ts: new Date(Date.now() - i * 60_000).toISOString(),
        payload: { rls_test: true, side, i, name: `${PREFIX}${side}-event-${i}` },
        schema_version: 1, dedup_key: `${PREFIX}${side}:${i}:${Date.now()}`,
      })
      .select('id').single()
    if (eErr) throw new Error(`event ${side}/${i}: ${eErr.message}`)
    eventIds.push(ev.id as string)
  }
  return { userId, ranchId, placeId: place.id as string, deviceId: device.id as string, hardwareId, token, eventIds }
}

// ─── Clients — anon key + the user's own session (never service role) ────────
async function userClient(side: Side): Promise<SupabaseClient> {
  const c = createClient(URL_!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email: USERS[side].email, password: USERS[side].password })
  if (error) throw new Error(`sign in ${side}: ${error.message}`)
  return c
}
function anonClient(): SupabaseClient {
  return createClient(URL_!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } })
}

// ─── Assertions ───────────────────────────────────────────────────────────────
async function isolationChecks(side: Side, c: SupabaseClient) {
  const me = fx[side]!, them = fx[OTHER[side]]!
  const who = `user ${side}`

  // Own rows readable (must succeed).
  for (const [table, expected, idCol, ids] of [
    ['events', 3, 'id', me.eventIds],
    ['places', 1, 'id', [me.placeId]],
    ['devices', 1, 'id', [me.deviceId]],
  ] as const) {
    const { data, error } = await c.from(table).select(idCol).in(idCol, ids as string[])
    record(who, `read own ${table}`, !error && (data?.length ?? 0) === expected, error?.message ?? `${data?.length} row(s)`)
  }

  // Other ranch's rows: zero rows, by id AND by ranch_id.
  for (const [table, ids] of [
    ['events', them.eventIds], ['places', [them.placeId]], ['devices', [them.deviceId]],
  ] as const) {
    const byId = await c.from(table).select('id').in('id', ids as string[])
    const byRanch = await c.from(table).select('id').eq('ranch_id', them.ranchId)
    const n = (byId.data?.length ?? 0) + (byRanch.data?.length ?? 0)
    record(who, `read other ranch's ${table} → 0 rows`, !byId.error && !byRanch.error && n === 0,
      byId.error?.message ?? byRanch.error?.message ?? `${n} row(s) visible`)
  }

  // Insert an event carrying the OTHER ranch's ranch_id → must fail.
  {
    const { data, error } = await c.from('events').insert({
      user_id: me.userId, ranch_id: them.ranchId, device_id: null, type: 'rls_test',
      ts: new Date().toISOString(), payload: { rls_test: true, cross: true, name: `${PREFIX}${side}-cross-event` },
      schema_version: 1, dedup_key: `${PREFIX}${side}:cross:${Date.now()}`,
    }).select('id')
    const landed = !error && (data?.length ?? 0) > 0
    record(who, `insert event with other ranch's ranch_id → rejected`, !landed, landed ? 'INSERTED (cross-ranch write path open)' : (error?.message ?? 'rejected'))
  }
  // Insert an event under the other ranch with THEIR user_id → must fail.
  {
    const { data, error } = await c.from('events').insert({
      user_id: them.userId, ranch_id: them.ranchId, device_id: null, type: 'rls_test',
      ts: new Date().toISOString(), payload: { rls_test: true, spoof: true },
      schema_version: 1, dedup_key: `${PREFIX}${side}:spoof:${Date.now()}`,
    }).select('id')
    const landed = !error && (data?.length ?? 0) > 0
    record(who, `insert event as other user under other ranch → rejected`, !landed, landed ? 'INSERTED' : (error?.message ?? 'rejected'))
  }

  // Update / delete the other ranch's rows → zero rows affected.
  {
    const { data, error } = await c.from('places').update({ name: `${PREFIX}tampered` }).eq('id', them.placeId).select('id')
    record(who, `update other ranch's place → 0 rows`, !error && (data?.length ?? 0) === 0, error?.message ?? `${data?.length} row(s) updated`)
  }
  {
    const { data, error } = await c.from('devices').update({ name: `${PREFIX}tampered` }).eq('id', them.deviceId).select('id')
    record(who, `update other ranch's device → 0 rows`, !error && (data?.length ?? 0) === 0, error?.message ?? `${data?.length} row(s) updated`)
  }
  {
    const { data, error } = await c.from('events').delete().in('id', them.eventIds).select('id')
    record(who, `delete other ranch's events → 0 rows`, !error && (data?.length ?? 0) === 0, error?.message ?? `${data?.length} row(s) deleted`)
  }
  {
    const { data, error } = await c.from('places').delete().eq('id', them.placeId).select('id')
    record(who, `delete other ranch's place → 0 rows`, !error && (data?.length ?? 0) === 0, error?.message ?? `${data?.length} row(s) deleted`)
  }

  // Insert a place under the other ranch → must fail (both user_id variants).
  for (const [label, userId] of [['own user_id', me.userId], ['their user_id', them.userId]] as const) {
    const { data, error } = await c.from('places').insert({
      user_id: userId, ranch_id: them.ranchId, name: `${PREFIX}${side}-cross-place`, kind: 'field',
    }).select('id')
    const landed = !error && (data?.length ?? 0) > 0
    record(who, `insert place under other ranch (${label}) → rejected`, !landed, landed ? 'INSERTED' : (error?.message ?? 'rejected'))
  }

  // ranch_members for the other ranch → zero rows.
  {
    const { data, error } = await c.from('ranch_members').select('user_id').eq('ranch_id', them.ranchId)
    record(who, `read other ranch's ranch_members → 0 rows`, !error && (data?.length ?? 0) === 0, error?.message ?? `${data?.length} row(s)`)
  }
  {
    const { data, error } = await c.from('ranches').select('id').eq('id', them.ranchId)
    record(who, `read other ranch row → 0 rows`, !error && (data?.length ?? 0) === 0, error?.message ?? `${data?.length} row(s)`)
  }
}

async function removedMemberChecks() {
  const me = fx.A!
  const { error } = await admin.from('ranch_members').delete().eq('ranch_id', me.ranchId).eq('user_id', me.userId)
  if (error) throw new Error(`remove membership A: ${error.message}`)
  const c = await userClient('A')
  for (const [table, ids] of [['events', me.eventIds], ['places', [me.placeId]], ['devices', [me.deviceId]]] as const) {
    const { data, error } = await c.from(table).select('id').in('id', ids as string[])
    record('removed member A', `read former ranch's ${table} → 0 rows`, !error && (data?.length ?? 0) === 0,
      error?.message ?? `${data?.length} row(s) still visible`)
  }
}

async function anonymousChecks() {
  const c = anonClient()
  for (const table of ['events', 'places', 'devices', 'ranch_members', 'ranches'] as const) {
    const { data, error } = await c.from(table).select(table === 'ranch_members' ? 'user_id' : 'id').limit(5)
    record('anonymous (no JWT)', `read ${table} → 0 rows or error`, !!error || (data?.length ?? 0) === 0, error?.message ?? `${data?.length} row(s)`)
  }
  const { data, error } = await c.from('events').insert({
    user_id: fx.A!.userId, ranch_id: fx.A!.ranchId, type: 'rls_test', ts: new Date().toISOString(),
    payload: { rls_test: true, anon: true }, schema_version: 1, dedup_key: `${PREFIX}anon:${Date.now()}`,
  }).select('id')
  record('anonymous (no JWT)', 'insert event → rejected', !!error || (data?.length ?? 0) === 0, error?.message ?? 'INSERTED')
}

async function ingestChecks() {
  // Device A's token, reporting for device B's hardware_id → 404, nothing inserted.
  const a = fx.A!, b = fx.B!
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${a.token}`,
    ...(process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {}),
  }
  const before = (await admin.from('events').select('id', { count: 'exact', head: true }).eq('device_id', b.deviceId)).count ?? 0
  let status = 0, text = ''
  try {
    const res = await fetch(`${BASE}/api/ingest`, {
      method: 'POST', headers,
      body: JSON.stringify({ hardware_id: b.hardwareId, type: 'rls_test_ingest', payload: { rls_test: true, cross: true } }),
    })
    status = res.status; text = (await res.text()).slice(0, 120)
  } catch (err) {
    text = err instanceof Error ? err.message : String(err)
  }
  const after = (await admin.from('events').select('id', { count: 'exact', head: true }).eq('device_id', b.deviceId)).count ?? 0
  record('ingest (token A → hw B)', `POST /api/ingest → 404`, status === 404, `${status} ${text}`)
  record('ingest (token A → hw B)', `no event inserted for device B`, after === before, `${before} → ${after}`)

  // Control: token A reporting for its OWN hardware → 201 (proves the token path works at all).
  let ownStatus = 0
  try {
    const res = await fetch(`${BASE}/api/ingest`, {
      method: 'POST', headers,
      body: JSON.stringify({ hardware_id: a.hardwareId, type: 'rls_test_ingest', payload: { rls_test: true } }),
    })
    ownStatus = res.status
  } catch { /* recorded below */ }
  record('ingest (token A → hw A)', `POST /api/ingest → 201 (control)`, ownStatus === 201, String(ownStatus))
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nDryline — two-ranch isolation test  (db ${URL_}, ingest ${BASE})\n`)
  await teardown('pre-run residue')
  try {
    fx.A = await seed('A')
    fx.B = await seed('B')
    console.log(`seeded: ranch A ${fx.A.ranchId}  ranch B ${fx.B.ranchId}\n`)

    await isolationChecks('A', await userClient('A'))
    await isolationChecks('B', await userClient('B'))
    await anonymousChecks()
    await ingestChecks()
    await removedMemberChecks() // last — it removes A's membership
  } finally {
    await teardown('finish')
  }

  const w = Math.max(...results.map(r => r.who.length))
  const cw = Math.max(...results.map(r => r.check.length))
  console.log('\n' + 'RESULT'.padEnd(6) + '  ' + 'WHO'.padEnd(w) + '  ' + 'CHECK'.padEnd(cw) + '  DETAIL')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}    ${r.who.padEnd(w)}  ${r.check.padEnd(cw)}  ${r.detail}`)
  }
  const fails = results.filter(r => !r.pass).length
  console.log(`\n${results.length - fails} PASS · ${fails} FAIL${fails ? '  — BLOCKED' : ''}\n`)
  process.exit(fails ? 1 : 0)
}

main().catch(async err => {
  console.error('\nrls-test crashed:', err instanceof Error ? err.message : err)
  try { await teardown('after crash') } catch (e) { console.error('teardown failed:', e) }
  process.exit(2)
})
