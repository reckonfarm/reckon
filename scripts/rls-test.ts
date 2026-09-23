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

import { guardWorktree, suiteIdentity } from './lib/suite-guard'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { validateRing, polygonAreaAcres, storableAcres } from '../lib/places/geo'
import { buildProgramAlerts } from '../lib/program-alerts'

function loadEnv() {
  // e2e/.env.e2e too, like every other suite: VERCEL_BYPASS lives only there,
  // and without it every API call here stops at Vercel's protection page and
  // reads as sixty isolation failures that never reached the app.
  for (const f of ['.env', '.env.local', 'e2e/.env.e2e']) {
    const path = resolve(process.cwd(), f)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
    }
  }
}
loadEnv()
guardWorktree('rls-test')

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const BASE = process.env.BASE ?? 'https://www.dryline.farm'
if (!URL_ || !ANON || !SERVICE) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY missing (.env.local)')

const PREFIX = 'RLS-TEST-'
const USERS = {
  A: { email: 'rls-test-a@dryline.farm', password: `${PREFIX}${randomBytes(12).toString('hex')}` },
  B: { email: 'rls-test-b@dryline.farm', password: `${PREFIX}${randomBytes(12).toString('hex')}` },
  // C: the invited person (Phase A2) — starts with NO ranch, joins A by invitation.
  C: { email: 'rls-test-c@dryline.farm', password: `${PREFIX}${randomBytes(12).toString('hex')}` },
  // D: a second member of ranch A (Block 4A) — the hand who must see the ranch's lots.
  D: { email: 'rls-test-d@dryline.farm', password: `${PREFIX}${randomBytes(12).toString('hex')}` },
  // E (Block 7E): belongs to NO ranch and never joins one. C used to be the
  // ranchless case, but C is created by the invitation checks and joins ranch A
  // there — so a test that needs a ranchless person either has to run before C
  // exists (it did, and crashed on a user that had not been made yet) or own
  // its own. E owns its own, and cannot be made ranch-ful by reordering.
  E: { email: 'rls-test-e@dryline.farm', password: `${PREFIX}${randomBytes(12).toString('hex')}` },
}
type Side = 'A' | 'B'
type Who = Side | 'C' | 'D' | 'E'
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
  lotId: string      // Block 4A — the ranch's one seeded cattle lot
  lotName: string
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
    .filter(u => u.email === USERS.A.email || u.email === USERS.B.email || u.email === USERS.C.email || u.email === USERS.D.email || u.email === USERS.E.email)
    .map(u => u.id)
  let n = 0
  if (ids.length) {
    n += (await admin.from('events').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('devices').delete().in('user_id', ids).select('id')).data?.length ?? 0
    // Block 28 (074): bunches before places, and places in passes (a parent is refused while a child lives).
    n += (await admin.from('herd_lots').delete().in('created_by', ids).select('id')).data?.length ?? 0
    for (let pass = 0; pass < 4; pass++) { const gone = (await admin.from('places').delete().in('user_id', ids).select('id')).data?.length ?? 0; n += gone; if (!gone) break }
    n += (await admin.from('ranch_members').delete().in('user_id', ids).select('user_id')).data?.length ?? 0
    n += (await admin.from('operation_profiles').delete().in('user_id', ids).select('id')).data?.length ?? 0
  }
  n += (await admin.from('devices').delete().like('hardware_id', `${PREFIX}%`).select('id')).data?.length ?? 0
  n += (await admin.from('herd_lots').delete().like('name', `${PREFIX}%`).select('id')).data?.length ?? 0
  for (let pass = 0; pass < 4; pass++) { const gone = (await admin.from('places').delete().like('name', `${PREFIX}%`).select('id')).data?.length ?? 0; n += gone; if (!gone) break }
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

  // Block 4B — the ranch's herd: one lot ROW on herd_lots (051), plus the ranch's profile row (050).
  const lotId = randomUUID(), lotName = `${PREFIX}${side}-lot`
  const { error: pErr2 } = await admin.from('operation_profiles').insert({ user_id: userId, ranch_id: ranchId, county_fips: '30069' })
  if (pErr2) throw new Error(`profile ${side}: ${pErr2.message}`)
  const { error: hErr } = await admin.from('herd_lots').insert({ id: lotId, ranch_id: ranchId, class: 'steers', name: lotName, head_count: 40, avg_weight: 550, weight_unit: 'lb', frame: 'Medium and Large', weaned: true, sale_windows: [], created_by: userId, updated_by: userId })
  if (hErr) throw new Error(`herd ${side}: ${hErr.message}`)

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
  return { userId, ranchId, lotId, lotName, placeId: place.id as string, deviceId: device.id as string, hardwareId, token, eventIds }
}

// ─── Clients — anon key + the user's own session (never service role) ────────
async function userClient(side: Who): Promise<SupabaseClient> {
  const c = createClient(URL_!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email: USERS[side].email, password: USERS[side].password })
  if (error) throw new Error(`sign in ${side}: ${error.message}`)
  return c
}
function anonClient(): SupabaseClient {
  return createClient(URL_!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } })
}
// A route call as this person: the same session JWT as a Bearer (lib/auth-user).
async function api(c: SupabaseClient, path: string, body: unknown, method: 'POST' | 'PATCH' | 'DELETE' | 'GET' = 'POST'): Promise<{ status: number; json: Record<string, unknown> }> {
  const { data: { session } } = await c.auth.getSession()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}`, ...(process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {}) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  })
  const json = await res.json().catch(() => ({})) as Record<string, unknown>
  return { status: res.status, json }
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

// ─── Phase A2 — the invite flow, end to end, through the routes ───────────────
// ranch_members keeps NO client INSERT policy; membership is written only by
// POST /api/invitations/accept after the token and the email check out.
async function invitationChecks() {
  const a = fx.A!, b = fx.B!
  const { data: cu, error: cErr } = await admin.auth.admin.createUser({ email: USERS.C.email, password: USERS.C.password, email_confirm: true, user_metadata: { rls_test: true, name: `${PREFIX}C` } })
  if (cErr || !cu.user) throw new Error(`createUser C: ${cErr?.message}`)
  const cId = cu.user.id
  const A = await userClient('A'), B = await userClient('B'), C = await userClient('C')
  const membersOf = async (ranchId: string, userId: string) => (await admin.from('ranch_members').select('user_id', { count: 'exact', head: true }).eq('ranch_id', ranchId).eq('user_id', userId)).count ?? 0
  const tokenOf = (url: unknown) => (typeof url === 'string' ? url.split('/invite/')[1] ?? '' : '')

  // THE one that matters most: a valid session writing itself into ranch_members → rejected.
  {
    const { data, error } = await B.from('ranch_members').insert({ ranch_id: a.ranchId, user_id: b.userId, role: 'owner' }).select('user_id')
    const rows = await membersOf(a.ranchId, b.userId)
    record('user B (session)', `direct INSERT into ranch_members (ranch A) → rejected, 0 rows`, (!!error || (data?.length ?? 0) === 0) && rows === 0, error?.message ?? (rows ? 'INSERTED' : `${data?.length ?? 0} returned`))
  }
  {
    const { data, error } = await A.from('ranch_members').insert({ ranch_id: a.ranchId, user_id: cId, role: 'member' }).select('user_id')
    const rows = await membersOf(a.ranchId, cId)
    record('user A (owner)', `direct INSERT into ranch_members (own ranch, for C) → rejected, 0 rows`, (!!error || (data?.length ?? 0) === 0) && rows === 0, error?.message ?? (rows ? 'INSERTED' : `${data?.length ?? 0} returned`))
  }

  // Owner A invites C.
  const inv = await api(A, '/api/invitations', { email: USERS.C.email, role: 'member' })
  const token = tokenOf(inv.json.acceptUrl)
  record('user A (owner)', 'POST /api/invitations → 201 with an accept link', inv.status === 201 && token.length > 20, `${inv.status} ${String(inv.json.error ?? '')}`.trim())

  // Wrong email accepts → rejected, no membership.
  {
    const r = await api(B, '/api/invitations/accept', { token })
    record('user B (wrong email)', 'accept A\'s invitation for C → 403, no membership', r.status === 403 && (await membersOf(a.ranchId, b.userId)) === 0, `${r.status} ${String(r.json.code ?? r.json.error ?? '')}`)
  }
  // Invited user accepts → sees exactly that ranch, nothing else.
  {
    const r = await api(C, '/api/invitations/accept', { token })
    const { data: ranches } = await C.from('ranches').select('id')
    const { data: bEvents } = await C.from('events').select('id').in('id', b.eventIds)
    record('user C (invited)', 'accept → 200 joined; sees exactly ranch A and none of ranch B', r.status === 200 && r.json.status === 'joined' && (ranches?.length ?? 0) === 1 && ranches?.[0]?.id === a.ranchId && (bEvents?.length ?? 0) === 0,
      `${r.status} ${String(r.json.status ?? r.json.error ?? '')} · ranches ${ranches?.length ?? 0} · B events ${bEvents?.length ?? 0}`)
  }
  // Reused token → no second membership.
  {
    const r = await api(C, '/api/invitations/accept', { token })
    record('user C (invited)', 'accept the same token again → still exactly one membership', r.status === 200 && r.json.status === 'already_member' && (await membersOf(a.ranchId, cId)) === 1, `${r.status} ${String(r.json.status ?? r.json.error ?? '')} · memberships ${await membersOf(a.ranchId, cId)}`)
  }
  // Non-owner attempts to invite / remove → rejected.
  {
    const r = await api(C, '/api/invitations', { email: 'rls-test-nobody@dryline.farm', role: 'member' })
    record('user C (member)', 'POST /api/invitations → 403', r.status === 403, `${r.status} ${String(r.json.error ?? '')}`)
  }
  {
    const r = await api(C, '/api/members/remove', { user_id: a.userId })
    record('user C (member)', 'POST /api/members/remove (owner A) → 403, A still an owner', r.status === 403 && (await membersOf(a.ranchId, a.userId)) === 1, `${r.status} ${String(r.json.error ?? '')}`)
  }
  // Last owner attempts self-removal → rejected.
  {
    const r = await api(A, '/api/members/remove', { user_id: a.userId })
    record('user A (owner)', 'remove self as the last owner → 409, still a member', r.status === 409 && (await membersOf(a.ranchId, a.userId)) === 1, `${r.status} ${String(r.json.error ?? '')}`)
  }
  // Invitations are readable only by members of that ranch.
  {
    const { data: mine } = await C.from('invitations').select('id').eq('ranch_id', a.ranchId)
    const { data: theirs } = await C.from('invitations').select('id').eq('ranch_id', b.ranchId)
    const { data: anonRows, error: anonErr } = await anonClient().from('invitations').select('id').limit(5)
    record('user C (member)', 'read own ranch\'s invitations → ≥1 row; other ranch\'s → 0; anonymous → 0', (mine?.length ?? 0) >= 1 && (theirs?.length ?? 0) === 0 && (!!anonErr || (anonRows?.length ?? 0) === 0), `own ${mine?.length ?? 0} · other ${theirs?.length ?? 0} · anon ${anonRows?.length ?? 0}`)
  }
  // Revoked token → rejected (B invites C, revokes, C tries).
  {
    const made = await api(B, '/api/invitations', { email: USERS.C.email, role: 'member' })
    const t2 = tokenOf(made.json.acceptUrl)
    const rev = await api(B, '/api/invitations/revoke', { id: (made.json.invite as { id?: string } | undefined)?.id ?? '' })
    const r = await api(C, '/api/invitations/accept', { token: t2 })
    record('user C (invited)', 'revoked token → 410, no membership on ranch B', made.status === 201 && rev.status === 200 && r.status === 410 && (await membersOf(b.ranchId, cId)) === 0, `${made.status}/${rev.status}/${r.status} ${String(r.json.code ?? '')}`)
  }
  // Expired token → rejected (seeded with the service role, already past its expiry).
  {
    const t3 = `${PREFIX}expired-${randomBytes(16).toString('hex')}`
    const { error } = await admin.from('invitations').insert({ ranch_id: b.ranchId, invited_email: USERS.C.email, role: 'member', token_hash: createHash('sha256').update(t3).digest('hex'), created_by: b.userId, expires_at: new Date(Date.now() - 3_600_000).toISOString() })
    const r = await api(C, '/api/invitations/accept', { token: t3 })
    record('user C (invited)', 'expired token → 410, no membership on ranch B', !error && r.status === 410 && r.json.code === 'expired' && (await membersOf(b.ranchId, cId)) === 0, `${error?.message ?? r.status} ${String(r.json.code ?? '')}`)
  }
  // Removed member → loses reads on everything, including rows they authored.
  {
    const { data: own, error: insErr } = await C.from('events').insert({ user_id: cId, ranch_id: a.ranchId, type: 'rls_test', ts: new Date().toISOString(), payload: { rls_test: true, by: 'C' }, schema_version: 1, dedup_key: `${PREFIX}C:${Date.now()}` }).select('id').single()
    const rm = await api(A, '/api/members/remove', { user_id: cId })
    const { data: after } = await C.from('events').select('id').eq('id', own?.id ?? '')
    const { data: ranchesAfter } = await C.from('ranches').select('id')
    record('user A (owner)', 'POST /api/members/remove (member C) → 200', rm.status === 200 && (await membersOf(a.ranchId, cId)) === 0, `${rm.status} ${String(rm.json.error ?? '')}`)
    record('removed member C', 'reads its own authored event and the ranch → 0 rows', !insErr && !!own?.id && (after?.length ?? 0) === 0 && (ranchesAfter?.length ?? 0) === 0, insErr?.message ?? `event ${after?.length ?? 0} · ranches ${ranchesAfter?.length ?? 0}`)
  }
}

// ─── Block 4A — cattle lots belong to the ranch (050) ─────────────────────────
// A member sees the ranch's lots, a second ranch's lots stay invisible, a member
// can edit the ranch's herd and the owner sees the edit, and a removed member
// loses the lots. All through the USER-SCOPED client — the membership policy is
// the gate.
async function lotsChecks() {
  const a = fx.A!, b = fx.B!
  // Block 4B — lots are rows on herd_lots; "no row" = the ranch is invisible to this session.
  const lotsOf = async (c: SupabaseClient, ranchId: string) => {
    const { data, error } = await c.from('herd_lots').select('id, name, head_count, updated_at').eq('ranch_id', ranchId).is('retired_at', null).order('created_at')
    return { error, lots: data && data.length ? (data as { id: string; name?: string; head_count: number; updated_at: string }[]) : null }
  }
  const A = await userClient('A'), B = await userClient('B')
  {
    const r = await lotsOf(A, a.ranchId)
    record('user A (owner)', 'reads the ranch\'s lots', !r.error && r.lots?.length === 1 && r.lots[0].name === a.lotName, r.error?.message ?? `${r.lots?.length ?? 'no row'} lot(s)`)
  }
  {
    const r = await lotsOf(A, b.ranchId)
    record('user A (owner)', 'reads ranch B\'s lots → no row', !r.error && r.lots === null, r.error?.message ?? (r.lots ? `${r.lots.length} lot(s) VISIBLE` : 'no row'))
  }
  // D joins ranch A as a member (service role — the invite flow's write, Phase A2).
  const { data: du, error: dErr } = await admin.auth.admin.createUser({ email: USERS.D.email, password: USERS.D.password, email_confirm: true, user_metadata: { rls_test: true, name: `${PREFIX}D` } })
  if (dErr || !du.user) throw new Error(`createUser D: ${dErr?.message}`)
  const { error: mErr } = await admin.from('ranch_members').insert({ ranch_id: a.ranchId, user_id: du.user.id, role: 'member' })
  if (mErr) throw new Error(`member D: ${mErr.message}`)
  const D = await userClient('D')
  {
    const r = await lotsOf(D, a.ranchId)
    record('member D (hand)', 'sees the ranch\'s lots — the Fed-to control has something to show', !r.error && r.lots?.length === 1 && r.lots[0].name === a.lotName, r.error?.message ?? `${r.lots?.length ?? 'no row'} lot(s)`)
  }
  {
    const r = await lotsOf(D, b.ranchId)
    record('member D (hand)', 'reads ranch B\'s lots → no row', !r.error && r.lots === null, r.error?.message ?? (r.lots ? 'VISIBLE' : 'no row'))
  }
  // ── Block 4B — the whole reason for rows: two members editing DIFFERENT lots never
  //    overwrite each other; a same-lot edit that lost the race is refused, not applied. ──
  {
    const made = await api(D, '/api/herd/lots', { class: 'heifers', name: `${PREFIX}A-lot2-by-D`, head_count: 12, avg_weight: 600, weight_unit: 'lb' }, 'POST')
    const first = (await lotsOf(A, a.ranchId)).lots?.find(l => l.id === a.lotId)
    const edit = await api(A, `/api/herd/lots/${a.lotId}`, { class: 'steers', name: `${a.lotName}-renamed-by-A`, head_count: 41, avg_weight: 550, weight_unit: 'lb', expected_updated_at: first?.updated_at ?? null }, 'PATCH')
    const after = (await lotsOf(A, a.ranchId)).lots ?? []
    const lot1 = after.find(l => l.id === a.lotId), lot2 = after.find(l => l.name === `${PREFIX}A-lot2-by-D`)
    record('members A + D', 'edit DIFFERENT lots: both changes persist, neither overwrote the other', made.status === 201 && edit.status === 200 && lot1?.name === `${a.lotName}-renamed-by-A` && lot1?.head_count === 41 && !!lot2 && lot2.head_count === 12, `${made.status}/${edit.status} · ${after.length} lots · lot1 "${lot1?.name}" ${lot1?.head_count} · lot2 ${lot2 ? 'present' : 'MISSING'}`)
    const stale = await api(D, `/api/herd/lots/${a.lotId}`, { class: 'steers', name: `${a.lotName}-stale-by-D`, head_count: 99, avg_weight: 550, weight_unit: 'lb', expected_updated_at: first?.updated_at ?? null }, 'PATCH')
    const still = (await lotsOf(A, a.ranchId)).lots?.find(l => l.id === a.lotId)
    record('member D (hand)', 'same-lot edit with a stale updated_at → 409, the other edit stands', stale.status === 409 && still?.name === `${a.lotName}-renamed-by-A` && still?.head_count === 41, `${stale.status} ${String(stale.json.code ?? stale.json.error ?? '')} · "${still?.name}" ${still?.head_count}`)
    const fresh = await api(D, `/api/herd/lots/${a.lotId}`, { class: 'steers', name: `${a.lotName}-then-by-D`, head_count: 42, avg_weight: 550, weight_unit: 'lb', expected_updated_at: still?.updated_at ?? null }, 'PATCH')
    record('member D (hand)', 'the same edit with the CURRENT updated_at → 200 and the owner reads it', fresh.status === 200 && (await lotsOf(A, a.ranchId)).lots?.find(l => l.id === a.lotId)?.name === `${a.lotName}-then-by-D`, `${fresh.status}`)
    // Block 12 (12.4): Archive and Delete are two acts with two doors. Retire is
    // POST …/retire — out of the pickers, row kept, name still resolving.
    // DELETE is the trash — row kept with deleted_at, out of every live read.
    const gone = await api(A, `/api/herd/lots/${lot2?.id ?? ''}/retire`, {}, 'POST')
    const live = (await lotsOf(A, a.ranchId)).lots ?? []
    const { data: retired } = await admin.from('herd_lots').select('retired_at, deleted_at').eq('id', lot2?.id ?? '').maybeSingle()
    record('user A (owner)', '12.4: retiring a lot (POST …/retire) — gone from the live list, row kept with retired_at, not in the trash', gone.status === 200 && live.length === 1 && !!(retired as { retired_at?: string | null } | null)?.retired_at && !(retired as { deleted_at?: string | null } | null)?.deleted_at, `${gone.status} · live ${live.length} · retired_at ${(retired as { retired_at?: string | null } | null)?.retired_at ? 'set' : 'NULL'}`)
    const trashed = await api(A, `/api/herd/lots/${lot2?.id ?? ''}`, {}, 'DELETE')
    const { data: inTrash } = await admin.from('herd_lots').select('deleted_at').eq('id', lot2?.id ?? '').maybeSingle()
    const trashList = await api(A, '/api/trash', null, 'GET')
    const listed = ((trashList.json.items ?? []) as { id: string }[]).some(i => i.id === lot2?.id)
    record('user A (owner)', '12.4: deleting a lot (DELETE) — row kept with deleted_at, and listed in the ranch\'s trash', trashed.status === 200 && (trashed.json as { trashed?: boolean }).trashed === true && !!(inTrash as { deleted_at?: string | null } | null)?.deleted_at && listed, `${trashed.status} · deleted_at ${(inTrash as { deleted_at?: string | null } | null)?.deleted_at ? 'set' : 'NULL'} · in /api/trash ${listed}`)
  }
  {
    const { data, error } = await B.from('herd_lots').update({ head_count: 1 }).eq('ranch_id', a.ranchId).select('id')
    const { data: ins, error: insErr } = await B.from('herd_lots').insert({ ranch_id: a.ranchId, class: 'cows', head_count: 5, avg_weight: 1200, weight_unit: 'lb', created_by: b.userId }).select('id')
    const r = await lotsOf(A, a.ranchId)
    record('user B (other ranch)', 'update or insert on ranch A\'s lots → rejected, lots intact', (!!error || (data?.length ?? 0) === 0) && (!!insErr || (ins?.length ?? 0) === 0) && (r.lots?.length ?? 0) >= 1 && r.lots!.every(l => l.head_count !== 1), `${error?.message ?? `${data?.length ?? 0} updated`} · ${insErr?.message ?? `${ins?.length ?? 0} inserted`}`)
  }
  {
    const { error } = await admin.from('ranch_members').delete().eq('ranch_id', a.ranchId).eq('user_id', du.user.id)
    if (error) throw new Error(`remove D: ${error.message}`)
    const r = await lotsOf(D, a.ranchId)
    record('removed member D', 'reads the former ranch\'s lots → no row', !r.error && r.lots === null, r.error?.message ?? (r.lots ? 'STILL VISIBLE' : 'no row'))
  }
}

// ─── Block 5A — the record's routes never cross the ranch boundary ────────────
// /api/activity/options reads ranch_members with the SERVICE ROLE (a member's
// own row is all the client policy shows), so the ranch scoping lives in the
// route: the ranch comes from the caller's own membership row and nothing else.
// These checks hit the API directly, never the page.
async function activityChecks() {
  const a = fx.A!, b = fx.B!
  const A = await userClient('A'), B = await userClient('B')
  const membersOf = async (ranchId: string) => new Set(((await admin.from('ranch_members').select('user_id').eq('ranch_id', ranchId)).data ?? []).map(m => m.user_id as string))
  const [membersA, membersB] = [await membersOf(a.ranchId), await membersOf(b.ranchId)]
  const people = (j: Record<string, unknown>) => ((j.people ?? []) as { id: string; name: string }[])
  {
    const r = await api(A, '/api/activity/options', undefined, 'GET')
    const ids = people(r.json).map(p => p.id)
    const names = people(r.json).map(p => p.name)
    record('user A (owner)', 'GET /api/activity/options lists only ranch A\'s people', r.status === 200 && ids.length === membersA.size && ids.every(id => membersA.has(id)), `${r.status} · ${ids.length} listed vs ${membersA.size} member(s)`)
    record('user A (owner)', 'no person from ranch B in A\'s people list', r.status === 200 && !ids.some(id => membersB.has(id)) && !names.some(n => n.includes(`${PREFIX}B`)), names.join(', ') || 'empty')
    const places = ((r.json.places ?? []) as { id: string }[]).map(p => p.id)
    record('user A (owner)', 'no place from ranch B in A\'s place list', r.status === 200 && places.includes(a.placeId) && !places.includes(b.placeId), `${places.length} place(s)`)
  }
  {
    const r = await api(B, '/api/activity/options', undefined, 'GET')
    const ids = people(r.json).map(p => p.id)
    record('user B (owner)', 'GET /api/activity/options lists only ranch B\'s people', r.status === 200 && ids.length === membersB.size && ids.every(id => membersB.has(id)) && !ids.some(id => membersA.has(id)), `${r.status} · ${ids.length} listed vs ${membersB.size} member(s)`)
  }
  {
    const r = await api(A, `/api/activity/${b.eventIds[0]}`, undefined, 'GET')
    record('user A (owner)', 'GET /api/activity/<ranch B event> → 404', r.status === 404 && !r.json.event, `${r.status}`)
  }
  {
    const r = await api(A, `/api/activity/${a.eventIds[0]}`, undefined, 'GET')
    const e = (r.json.event ?? {}) as Record<string, unknown>
    record('user A (owner)', 'GET /api/activity/<own event> → the event with actor + role', r.status === 200 && e.actor_id === a.userId && e.actor_role === 'owner' && typeof e.work_time === 'string' && typeof e.recorded_at === 'string', `${r.status} · ${String(e.actor)} · ${String(e.actor_role)}`)
  }
  {
    const res = await fetch(`${BASE}/api/activity/options`, { headers: process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {} })
    record('anonymous', 'GET /api/activity/options → 401', res.status === 401, `${res.status}`)
  }
}

// ─── Block 5B — corrections through the API, and the balance through the chain ──
// The rule the order calls out (and a rancher catches in December): a correction
// dated BEFORE a physical count must not shift that count's consumption; one
// dated AFTER it must. Ranch A gets a counted baseline (Sep 1, 40 bales), one
// feeding before it (Aug 30, 6) and one after (Sep 3, 6) — Kiehl's 1-before /
// 8-after and Test Ranch's 21-before / 3-after are the same shape. The balance
// is read the way the phone reads it: the consequence line the correct / void
// routes return, from lib/hay/queries through the effective filter.
// Needs migration 054 on BASE's database; skips (never fails) without it.
async function correctionChecks() {
  const a = fx.A!
  const probe = await admin.from('events').select('superseded_by').limit(1)
  if (probe.error) { record('(skipped)', 'Block 5B correction checks — migration 054 not applied', true, probe.error.message.slice(0, 70)); return }
  const A = await userClient('A'), B = await userClient('B')
  const seed = async (type: string, ts: string, payload: Record<string, unknown>) => {
    const { data, error } = await admin.from('events').insert({ user_id: a.userId, ranch_id: a.ranchId, type, ts, payload: { source: 'manual', schema_version: 1, place_id: null, ...payload }, schema_version: 1 }).select('id').single()
    if (error) throw new Error(`seed ${type}: ${error.message}`)
    a.eventIds.push(data.id as string)
    return data.id as string
  }
  await seed('hay_inventory', '2026-09-01T18:00:00Z', { bales: 40, as_of: '2026-09-01' })
  const before = await seed('hay_fed', '2026-08-30T18:00:00Z', { bales: 6, herd_lot_id: null })
  const after = await seed('hay_fed', '2026-09-03T18:00:00Z', { bales: 6, herd_lot_id: null })
  const onHandOf = (j: Record<string, unknown>) => {
    const lines = ((j.consequence as { lines?: string[] } | undefined)?.lines ?? [])
    // 6C: the receipt states the complete equation "N counted <day> + A added − F fed = X bales on hand, …"
    const m = lines.map(l => l.match(/^([\d,]+) counted [^+]+ \+ [\d,]+ added \u2212 [\d,]+ fed = (-?[\d,]+) bales? on hand/)).find(Boolean)
    return m ? { onHand: parseInt(m[2].replace(/,/g, ''), 10), counted: parseInt(m[1].replace(/,/g, ''), 10), lines } : { onHand: NaN, counted: NaN, lines }
  }
  const ev = (j: Record<string, unknown>) => (j.event ?? {}) as Record<string, unknown>

  // 1) Correct the feeding BEFORE the count 6 → 4: on hand stays 34 (40 − the 6 after).
  const c1 = await api(A, `/api/activity/${before}/correct`, { bales: 4, reason: 'was 4, typed 6' })
  const b1 = onHandOf(c1.json)
  record('user A (owner)', 'correct a feeding BEFORE the count (6→4): balance does not shift pre-count consumption past the count (34)', c1.status === 201 && b1.onHand === 34 && b1.counted === 40, `${c1.status} · ${b1.lines.join(' | ') || (c1.json.error as string)}`)
  {
    const orig = await api(A, `/api/activity/${before}`, undefined, 'GET')
    const head = await api(A, `/api/activity/${String(ev(c1.json).id)}`, undefined, 'GET')
    record('user A (owner)', 'original → superseded_by = correction; correction → supersedes = original; both readable', orig.status === 200 && head.status === 200 && ev(orig.json).superseded_by === ev(c1.json).id && ev(head.json).supersedes_event_id === before, `${orig.status}/${head.status}`)
  }
  // 2) Correct the feeding AFTER the count 6 → 4: on hand adjusts 34 → 36.
  const c2 = await api(A, `/api/activity/${after}/correct`, { bales: 4, reason: 'was 4' })
  const b2 = onHandOf(c2.json)
  record('user A (owner)', 'correct a feeding AFTER the count (6→4): balance adjusts 34 → 36', c2.status === 201 && b2.onHand === 36, `${c2.status} · ${b2.lines[1] ?? (c2.json.error as string)}`)
  // 3) A second correction of the same original is refused; correct the current entry instead.
  const again = await api(A, `/api/activity/${after}/correct`, { bales: 5, reason: 'again' })
  record('user A (owner)', 'a correction never applies twice: correcting the superseded original → 409', again.status === 409, `${again.status} ${String(again.json.error ?? '')}`)
  // 4) Wrong date: the after-count feeding (now 4 bales) really happened Aug 29 — before the count. On hand 36 → 40.
  const head2 = String(ev(c2.json).id)
  const c3 = await api(A, `/api/activity/${head2}/correct`, { ts: '2026-08-29T18:00:00Z', reason: 'wrong day' })
  const b3 = onHandOf(c3.json)
  record('user A (owner)', 'wrong date: re-dating the post-count feeding to before the count lifts it out of that count\'s consumption (36 → 40)', c3.status === 201 && b3.onHand === 40 && ev(c3.json).ts === '2026-08-29T18:00:00+00:00', `${c3.status} · on hand ${b3.onHand} · ts ${String(ev(c3.json).ts)}`)
  // 5) Wrong lot and wrong place on the current entry, one at a time; the balance is unmoved (40).
  const c4 = await api(A, `/api/activity/${String(ev(c3.json).id)}/correct`, { herd_lot_id: a.lotId, reason: 'wrong lot' })
  record('user A (owner)', 'wrong lot: the correction carries the lot; balance unmoved', c4.status === 201 && (ev(c4.json).payload as Record<string, unknown>).herd_lot_id === a.lotId && onHandOf(c4.json).onHand === 40, `${c4.status} · lot ${String((ev(c4.json).payload as Record<string, unknown> | undefined)?.herd_lot_id)}`)
  const c5 = await api(A, `/api/activity/${String(ev(c4.json).id)}/correct`, { place_id: a.placeId, reason: 'wrong place' })
  record('user A (owner)', 'wrong place: the correction carries the place; balance unmoved', c5.status === 201 && (ev(c5.json).payload as Record<string, unknown>).place_id === a.placeId && onHandOf(c5.json).onHand === 40, `${c5.status} · place ${String((ev(c5.json).payload as Record<string, unknown> | undefined)?.place_id)}`)
  // 6) Void: reverse the pre-count feeding's current entry (4 bales, Aug 30). Both stay; on hand still 40 (it was before the count).
  const v1 = await api(A, `/api/activity/${String(ev(c1.json).id)}/void`, { reason: 'never happened' })
  record('user A (owner)', 'void the pre-count entry: a reversal row with voided_at; balance unmoved (40)', v1.status === 201 && typeof ev(v1.json).voided_at === 'string' && ev(v1.json).supersedes_event_id === ev(c1.json).id && onHandOf(v1.json).onHand === 40, `${v1.status} · ${(onHandOf(v1.json).lines[0] ?? (v1.json.error as string))}`)
  const vAgain = await api(A, `/api/activity/${String(ev(v1.json).id)}/correct`, { bales: 9, reason: 'x' })
  record('user A (owner)', 'a void cannot be corrected → 409', vAgain.status === 409, `${vAgain.status}`)
  // 7) A void of a feeding AFTER the count moves the balance: seed one more after-count feeding (5 bales) then void it.
  const extra = await seed('hay_fed', '2026-09-04T18:00:00Z', { bales: 5, herd_lot_id: null })
  const v2 = await api(A, `/api/activity/${extra}/void`, { reason: 'double-logged' })
  record('user A (owner)', 'void a feeding AFTER the count: the reversal lifts it out of the balance (35 → 40)', v2.status === 201 && onHandOf(v2.json).onHand === 40, `${v2.status} · on hand ${onHandOf(v2.json).onHand}`)
  // 8) The record still shows every row: original, corrections, voids — nothing deleted.
  {
    const { count } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('ranch_id', a.ranchId).eq('type', 'hay_fed')
    record('user A (owner)', 'nothing deleted: every hay_fed row of the chain is still on the record', count === 10, `${count} hay_fed rows (2 seeds + 5 corrections + 2 voids + 1 extra)`)
  }
  // 9) Ranch B cannot touch A's chain: correcting A's event → 404 (invisible), voiding → 404.
  const cross = await api(B, `/api/activity/${after}/correct`, { bales: 1, reason: 'not mine' })
  const crossV = await api(B, `/api/activity/${String(ev(c5.json).id)}/void`, { reason: 'not mine' })
  record('user B (owner)', 'cannot correct or void ranch A\'s entries → 404 / 404', cross.status === 404 && crossV.status === 404, `${cross.status} / ${crossV.status}`)
  // 10) Idempotent on client id: the same correction id twice → 200 duplicate, one row.
  const cid = randomUUID()
  const first = await api(A, `/api/activity/${String(ev(c5.json).id)}/correct`, { id: cid, bales: 3, reason: 'retry test' })
  const second = await api(A, `/api/activity/${String(ev(c5.json).id)}/correct`, { id: cid, bales: 3, reason: 'retry test' })
  record('user A (owner)', 'a retried correction with the same client id lands once (201 then 200 duplicate)', first.status === 201 && second.status === 200 && second.json.duplicate === true && ev(second.json).id === cid, `${first.status} / ${second.status}`)
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

// ── Block 31 (075): create_ranch is the one door into a ranch ─────────────────
// A new user F (E stays ranchless for 7E) makes a ranch and owns it; a second
// call is refused; an existing owner is refused and their ranch is untouched;
// anon cannot call it; and F's first record then lands on F's own ranch.
async function setupChecks() {
  const a = fx.A!
  const A = await userClient('A')
  const probe = await admin.rpc('create_ranch', { p_name: 'probe', p_county_fips: null })
  if (probe.error?.code === '42883') { record('(gap)', '31: create_ranch — CAPABILITY GAP: migration 075 is not applied on this database', false, 'six setup checks cannot be read until 075 is run'); return }
  const fEmail = `rls-test-f@dryline.farm`, fPass = `${PREFIX}pass-F-${Date.now()}`
  const { data: fu } = await admin.auth.admin.createUser({ email: fEmail, password: fPass, email_confirm: true, user_metadata: { rls_test: true, name: `${PREFIX}F` } })
  const F = createClient(URL_!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: fErr } = await F.auth.signInWithPassword({ email: fEmail, password: fPass })
  if (fErr || !fu?.user) { record('user F (new)', '31: user F could not sign in', false, fErr?.message ?? 'no user'); return }
  const fId = fu.user.id
  const before = await admin.from('ranch_members').select('ranch_id', { count: 'exact', head: true }).eq('user_id', fId)
  const made = await F.rpc('create_ranch', { p_name: `${PREFIX} F ranch`, p_county_fips: '30027' })
  const r1 = made.data as { ok?: boolean; ranch_id?: string; reason?: string } | null
  const { data: fm } = await admin.from('ranch_members').select('ranch_id, role').eq('user_id', fId)
  const { data: fr } = r1?.ranch_id ? await admin.from('ranches').select('name, home_county_fips').eq('id', r1.ranch_id).maybeSingle() : { data: null }
  record('user F (new)', '31: a brand-new account makes a ranch through create_ranch and owns it, county set', (before.count ?? 0) === 0 && !made.error && r1?.ok === true && (fm ?? []).length === 1 && fm![0].role === 'owner' && fm![0].ranch_id === r1.ranch_id && (fr as { home_county_fips?: string } | null)?.home_county_fips === '30027',
    `${made.error?.message ?? (r1?.ok ? 'ok' : r1?.reason)} · memberships ${(fm ?? []).length} · role ${fm?.[0]?.role} · county ${(fr as { home_county_fips?: string } | null)?.home_county_fips}`)
  const again = await F.rpc('create_ranch', { p_name: 'Another', p_county_fips: null })
  const r2 = again.data as { ok?: boolean; reason?: string } | null
  const { count: fRanches } = await admin.from('ranch_members').select('ranch_id', { count: 'exact', head: true }).eq('user_id', fId)
  record('user F (new)', '31: the same account again is refused, and still owns exactly one ranch', r2?.ok === false && r2?.reason === 'already_on_a_ranch' && fRanches === 1, `${r2?.reason ?? again.error?.message} · memberships ${fRanches}`)
  const aBefore = await admin.from('ranch_members').select('user_id, role').eq('ranch_id', a.ranchId)
  const asOwner = await A.rpc('create_ranch', { p_name: 'A second ranch', p_county_fips: null })
  const r3 = asOwner.data as { ok?: boolean; reason?: string } | null
  const aAfter = await admin.from('ranch_members').select('user_id, role').eq('ranch_id', a.ranchId)
  const { count: aOwns } = await admin.from('ranch_members').select('ranch_id', { count: 'exact', head: true }).eq('user_id', a.userId)
  record('user A (owner)', '31: a member of an existing ranch is refused, and nothing changes on that ranch', r3?.ok === false && r3?.reason === 'already_on_a_ranch' && JSON.stringify(aBefore.data) === JSON.stringify(aAfter.data) && aOwns === 1, `${r3?.reason ?? asOwner.error?.message} · A's ranch members ${aBefore.data?.length} → ${aAfter.data?.length} · A on ${aOwns} ranch(es)`)
  const anon = await anonClient().rpc('create_ranch', { p_name: 'Anon ranch', p_county_fips: null })
  record('anonymous (no JWT)', '31: anon cannot call create_ranch', !!anon.error || (anon.data as { ok?: boolean } | null)?.ok === false, anon.error ? `${anon.error.code ?? ''} ${anon.error.message.slice(0, 60)}` : JSON.stringify(anon.data).slice(0, 80))
  const wrote = await api(F, '/api/log', { type: 'rain', inches: 0.2 })
  const ev = (wrote.json.event ?? {}) as { ranch_id?: string }
  record('user F (new)', '31: F\'s first record lands, on F\'s own ranch', wrote.status === 201 && ev.ranch_id === r1?.ranch_id, `${wrote.status} · ranch ${ev.ranch_id === r1?.ranch_id ? 'F\'s' : ev.ranch_id ?? 'none'}`)
  // Tidy: F's ranch (cascades the membership), F's rows, F.
  if (r1?.ranch_id) { await admin.from('events').delete().eq('user_id', fId); await admin.from('ranches').delete().eq('id', r1.ranch_id) }
  await admin.auth.admin.deleteUser(fId)
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


// ─── Places, slice 1 — the shape, the acreage, and who may change them ────────
// Four things this proves, in the order they can go wrong:
//   1. The ring validator refuses what it must, as a PURE function — instant,
//      no database, no network. If this fails, nothing below is meaningful.
//   2. Acreage is computed SERVER-SIDE against a known synthetic rectangle. A
//      client that posts its own `acres` is ignored.
//   3. `kind` round-trips through POST and PATCH. Before slice 1 nothing could
//      set it and every place on production landed as 'field'.
//   4. PATCH is membership-gated: ranch A cannot reshape or rename ranch B's
//      ground. The 043 "member places updatable" policy is the whole gate —
//      the route uses the user-scoped client and no service role — so a
//      cross-ranch PATCH must match zero rows and 404.
// Needs migration 056 on BASE's database; skips (never fails) without it.
// ── Block 7E — /api/log, the route that writes every manual entry ─────────────
//
// It used the cookie-only createClient() until 7E, so this suite could not
// reach it: the one route that writes EVERY manual event in the app was the
// one route none of these checks could see, and its cross-ranch behaviour was
// asserted nowhere. sessionUser tries cookies first and Bearer second, so the
// browser path is unchanged and this door is now open.
//
// RUNS BEFORE invitationChecks ON PURPOSE. C is ranchless until an invitation
// joins it to A, and the ranchless branch is the state nobody has ever tested
// — the route documents that a person with no ranch_members row still gets
// their row, with ranch_id null. "Does not error" is not the claim worth
// making about that. The claim is that the row is INVISIBLE TO EVERY RANCH.
async function logRouteChecks() {
  const a = fx.A!, b = fx.B!
  const A = await userClient('A')
  // E is made here and joins no ranch, ever.
  await admin.auth.admin.createUser({ email: USERS.E.email, password: USERS.E.password, email_confirm: true, user_metadata: { rls_test: true, name: `${PREFIX}E` } })
  const C = await userClient('E')

  // The suite can reach it at all — the whole point of 7E.
  const mine = await api(A, '/api/log', { type: 'rain', inches: 0.31, place_id: a.placeId })
  const mineId = String(((mine.json.event ?? {}) as { id?: string }).id ?? '')
  record('user A (owner)', '7E: the isolation suite can reach /api/log at all — a Bearer token is accepted', mine.status === 201 && !!mineId, `${mine.status} · ${mineId ? 'event created' : 'NO EVENT — the route is still cookie-only'}`)

  // The row lands on the writer's ranch, never on anyone's say-so.
  const { data: row } = await admin.from('events').select('ranch_id, user_id').eq('id', mineId).maybeSingle()
  const r = row as { ranch_id: string | null; user_id: string } | null
  record('user A (owner)', '7E: the row is stamped with the writer\'s own ranch and the writer\'s own id', !!r && r.ranch_id === a.ranchId && r.user_id === a.userId, `ranch ${r?.ranch_id === a.ranchId ? 'A' : String(r?.ranch_id)} · user ${r?.user_id === a.userId ? 'A' : 'OTHER'}`)

  // A cannot write onto B's ground by naming B's place.
  const stolen = await api(A, '/api/log', { type: 'rain', inches: 0.44, place_id: b.placeId })
  const stolenId = String(((stolen.json.event ?? {}) as { id?: string }).id ?? '')
  const { data: srow } = stolenId ? await admin.from('events').select('ranch_id').eq('id', stolenId).maybeSingle() : { data: null }
  const sr = srow as { ranch_id: string | null } | null
  record('user A (owner)', '7E: naming ranch B\'s place does NOT put the entry on ranch B', sr === null || sr.ranch_id === a.ranchId, `landed on ${sr === null ? 'nothing' : sr.ranch_id === a.ranchId ? 'A (correct)' : 'RANCH B'}`)

  // B cannot see it.
  const Bc = await userClient('B')
  const bSees = await Bc.from('events').select('id').eq('id', mineId)
  record('user B (other ranch)', '7E: an entry written by A is invisible to B', (bSees.data ?? []).length === 0, `${(bSees.data ?? []).length} row(s) visible to B`)

  // ── The ranchless branch — the state nobody has ever tested ─────────────────
  {
    // E's id comes from the signed-in client — it is not one of the two seeded
    // ranches and has no Fixture row.
    const { data: { user: cUser } } = await C.auth.getUser()
    const { data: memberships } = await admin.from('ranch_members').select('ranch_id').eq('user_id', cUser?.id ?? '')
    const ranchless = !!cUser && (memberships ?? []).length === 0
    const wrote = await api(C, '/api/log', { type: 'rain', inches: 0.55 })

    // THE ROUTE'S DOCUMENTED CLAIM WAS FALSE, and this is what found it. It
    // said a ranchless write "still lands, owner-visible" — true under 034,
    // whose INSERT policy was user_id = auth.uid(). 043 made membership the
    // sole gate, so ranch_id NULL makes the policy's `in (…)` NULL, not TRUE,
    // and the insert is refused. The READ policy has the same shape, so a
    // landed row would have been invisible to its own writer too. The claim
    // outlived its truth by nine migrations because nothing asked.
    //
    // So the assertion is the true behaviour, and the bar is higher than "does
    // not error": the person must get an ACTIONABLE answer, never a 500
    // carrying a policy message, and no row may exist anywhere afterwards.
    record('user E (no ranch)', '7E: a ranchless person is told they have no ranch — 409 and a sentence they can act on, never a 500',
      ranchless && wrote.status === 409 && wrote.json.code === 'no_ranch' && /not on a ranch/i.test(String(wrote.json.error)),
      `${ranchless ? '' : 'E ALREADY HAS A RANCH — this proves nothing · '}${wrote.status} · ${String(wrote.json.error ?? '').slice(0, 60)}`)

    const { count: strays } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('user_id', cUser?.id ?? '')
    record('user E (no ranch)', '7E: and no row was written anywhere — not owner-visible, not orphaned, not at all',
      (strays ?? 0) === 0, `${strays ?? 0} row(s) exist for E`)

    const { count: nullRanch } = await admin.from('events').select('id', { count: 'exact', head: true }).is('ranch_id', null)
    record('user E (no ranch)', '7E: no ranchless event exists on this database at all — a row no ranch can see is a row nobody should hold',
      (nullRanch ?? 0) === 0, `${nullRanch ?? 0} event(s) with ranch_id NULL`)
  }
}

// ── Block 9 — /api/ranch/turnout, the date the hay is planned against ─────────
//
// A turnout date is an ordinary events row (no migration; events.type is text
// by design). That means it inherits 043's membership gate for free — and
// "inherits it for free" is exactly the kind of claim that has to be PROVEN
// rather than reasoned about, because the cost of being wrong is one ranch
// reading another ranch's plans.
//
// On sessionUser, so this suite can reach it with a Bearer token — the 7E
// rule. Three things are asserted: the write lands on the writer's own ranch;
// the other ranch cannot see it through the API or through the table; and
// changing it supersedes rather than accumulates, so the planning surface
// cannot be handed two live answers.
// ── Block 10 — the group action, where a preg check moves head counts ─────────
//
// This is the first thing in the app whose write CHANGES ANOTHER TABLE. Every
// other ledger entry is an insert; a group action moves a source lot's count
// and creates or increments a destination in the same breath. Two failures
// would matter more than anything these suites have caught: a working on one
// ranch touching another ranch's cattle, and a retry decrementing twice.
//
// Both are asserted here against the real 063 function. Its guarantees are in
// SQL, not in the route — SECURITY INVOKER, so another ranch's lot is not
// rejected, it does not exist to the function — and RLS is therefore the thing
// under test, not a code path that could be edited around.
async function groupActionChecks() {
  const a = fx.A!, b = fx.B!
  const A = await userClient('A')

  const headOf = async (id: string) => {
    const { data } = await admin.from('herd_lots').select('head_count').eq('id', id).maybeSingle()
    return (data as { head_count?: number } | null)?.head_count ?? null
  }
  const aBefore = await headOf(a.lotId)
  const bBefore = await headOf(b.lotId)
  if (aBefore == null || bBefore == null) { record('(skipped)', '10: group-action checks — the seeded lots are gone', true, 'nothing to work'); return }

  // Capability, not existence: a working the function cannot possibly apply.
  // 404 proves 063 is deployed AND looked for the lot; 503 is the route saying
  // the function is not there at all, which is a different morning's problem.
  const probeId = randomUUID()
  const probe = await api(A, '/api/log', {
    id: probeId, type: 'group_action', action: 'preg_check',
    source_lot_id: '00000000-0000-0000-0000-0000000000fe',
    expected_head: null, counted: 1, stay: 1, results: [],
  })
  if (probe.status === 503) { record('(skipped)', '10/14: group-action checks — migration 063 or 069 not applied', true, String(probe.json.error ?? '').slice(0, 70)); return }
  record('user A (owner)', '10: a working against a bunch that does not exist is refused by name, never a database error',
    probe.status === 404 && /not on your ranch/i.test(String(probe.json.error)), `${probe.status} · ${String(probe.json.error ?? '').slice(0, 60)}`)

  // ── A cannot move B's cattle. The whole reason this suite exists. ───────────
  // Block 14: a preg check cannot carry a result group any more (069 refuses
  // the split before it looks anything up), so the theft is tried as a SORT —
  // the working that CAN move cattle — and must still find no bunch to move.
  const steal = await api(A, '/api/log', {
    id: randomUUID(), type: 'group_action', action: 'sort',
    source_lot_id: b.lotId, expected_head: bBefore, counted: bBefore, stay: 0,
    results: [{ lot_id: null, name: 'STOLEN', head: bBefore }],
  })
  const bAfterSteal = await headOf(b.lotId)
  record('user A (owner)', '10/14: a working can never move another ranch\'s bunch — refused, and B\'s head count untouched',
    steal.status === 404 && bAfterSteal === bBefore,
    `${steal.status} · B was ${bBefore}, is ${bAfterSteal}`)
  const { count: stolenLots } = await admin.from('herd_lots').select('id', { count: 'exact', head: true }).eq('name', 'STOLEN')
  record('user A (owner)', '10: and no group was created anywhere by the attempt', (stolenLots ?? 0) === 0, `${stolenLots ?? 0} lot(s) named STOLEN`)

  // ── The real working, and the chute count beating the stored number ────────
  // Block 15 (070): a preg check CARRIES its opens group — one record, one
  // Undo. The checked bunch ends at what is bred; the opens become a bunch of
  // the class named; bred and open are numbers on the row.
  const counted = aBefore + 2, open = 4, bred = counted - open, stay = bred
  const workingId = randomUUID()
  const body = {
    id: workingId, type: 'group_action', action: 'preg_check',
    source_lot_id: a.lotId, expected_head: aBefore, counted, stay,
    results: [{ lot_id: null, name: 'RLS-TEST opens', class: 'old_cows', head: open }], detail: { bred, open },
  }
  const done = await api(A, '/api/log', body)
  if (done.status === 503) { record('(skipped)', '15: preg-check checks — migration 069/070 not applied', true, String(done.json.error ?? '').slice(0, 70)); return }
  if (done.status === 400 && /Make a bunch from the opens afterward/.test(String(done.json.error))) { record('(skipped)', '15: preg-check checks — migration 070 not applied (069 still refuses the split)', true, String(done.json.error ?? '').slice(0, 70)); return }
  const aAfter = await headOf(a.lotId)
  const { data: madeRows } = await admin.from('herd_lots').select('id, ranch_id, head_count, class, place_id, deleted_at').eq('name', 'RLS-TEST opens')
  const made = ((madeRows ?? []) as { id: string; ranch_id: string; head_count: number; class: string; place_id: string | null; deleted_at: string | null }[])[0] ?? null
  record('user A (owner)', '15: a preg check lands as ONE record — the checked bunch ends at the bred, the opens become a new bunch of the class named, on this ranch',
    done.status === 201 && aAfter === bred && !!made && made.head_count === open && made.class === 'old_cows' && made.ranch_id === a.ranchId,
    `${done.status} · source ${aBefore} → ${aAfter} (bred ${bred}) · new bunch ${made ? `${made.head_count} head, ${made.class}, on ${made.ranch_id === a.ranchId ? 'A' : 'ELSEWHERE'}` : 'MISSING'}`)

  const { data: ev } = await admin.from('events').select('ranch_id, type, payload').eq('id', workingId).maybeSingle()
  const evRow = ev as { ranch_id: string; type: string; payload: Record<string, unknown> } | null
  record('user A (owner)', '15: the row carries what was counted, what the bunch said before, and bred and open as numbers',
    !!evRow && evRow.type === 'group_action' && evRow.ranch_id === a.ranchId
      && evRow.payload.counted === counted && evRow.payload.source_head_before === aBefore && evRow.payload.bred === bred && evRow.payload.open === open,
    evRow ? `counted ${String(evRow.payload.counted)} · said ${String(evRow.payload.source_head_before)} · bred ${String(evRow.payload.bred)} · open ${String(evRow.payload.open)}` : 'NO EVENT')

  // The bred stay: a preg check whose stay is not the bred is refused in a sentence.
  const wrongStay = await api(A, '/api/log', {
    id: randomUUID(), type: 'group_action', action: 'preg_check',
    source_lot_id: a.lotId, expected_head: bred, counted: 10, stay: 3, results: [], detail: { bred: 8, open: 2 },
  })
  record('user A (owner)', '15: the bred are the ones that stay — a check where they differ is refused, and nothing moves',
    wrongStay.status === 400 && /bred ones are the ones that stay/i.test(String(wrongStay.json.error)) && (await headOf(a.lotId)) === bred,
    `${wrongStay.status} · "${String(wrongStay.json.error ?? '').slice(0, 60)}" · head ${await headOf(a.lotId)}`)

  // ONE Undo: deleting the working puts the head back and takes the bunch it made to the trash; restore brings both back.
  const undo = await api(A, `/api/activity/${workingId}/delete`, undefined, 'DELETE')
  const { data: madeGone } = made ? await admin.from('herd_lots').select('deleted_at, head_count').eq('id', made.id).maybeSingle() : { data: null }
  const headUndone = await headOf(a.lotId)
  const back = await api(A, '/api/trash', { table: 'events', id: workingId })
  const { data: madeBack } = made ? await admin.from('herd_lots').select('deleted_at, head_count').eq('id', made.id).maybeSingle() : { data: null }
  const headBack = await headOf(a.lotId)
  record('user A (owner)', '15 (ruling 3): one Undo — deleting the check puts the head back and trashes the bunch it made; putting it back restores both',
    undo.status === 200 && headUndone === aBefore && !!(madeGone as { deleted_at?: string | null } | null)?.deleted_at
      && back.status === 200 && headBack === bred && (madeBack as { deleted_at?: string | null; head_count?: number } | null)?.deleted_at === null && (madeBack as { head_count?: number } | null)?.head_count === open,
    `delete ${undo.status} · head ${headUndone} (was ${aBefore}) · bunch trashed ${!!(madeGone as { deleted_at?: string | null } | null)?.deleted_at} · restore ${back.status} · head ${headBack} · bunch back at ${String((madeBack as { head_count?: number } | null)?.head_count)}`)
  const aSorted = headBack

  // ── A RETRY MUST NEVER DECREMENT TWICE. The outbox resends on any transient
  // failure, so this is not a theoretical case — it is the normal one on a
  // bad signal.
  const retry = await api(A, '/api/log', { ...body })
  const aAfterRetry = await headOf(a.lotId)
  const { count: madeTwice } = await admin.from('herd_lots').select('id', { count: 'exact', head: true }).eq('name', 'RLS-TEST opens').is('deleted_at', null)
  const { count: eventsForId } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('id', workingId)
  record('user A (owner)', '10: the same working sent twice moves nothing the second time — one event, one bunch, the count where it was',
    retry.status === 200 && retry.json.duplicate === true && aAfterRetry === aSorted && (madeTwice ?? 0) === 1 && (eventsForId ?? 0) === 1,
    `${retry.status} duplicate=${retry.json.duplicate} · source ${aAfterRetry} (was ${aSorted}) · bunches ${madeTwice ?? 0} · events ${eventsForId ?? 0}`)

  // ── The rules are in the database, so a caller that skips the screen still
  // meets them. These bodies would pass any client-side check that was only
  // in the browser.
  const nowHead = aAfterRetry ?? aSorted
  const badSum = await api(A, '/api/log', {
    id: randomUUID(), type: 'group_action', action: 'sort',
    source_lot_id: a.lotId, expected_head: nowHead, counted: 100, stay: 90,
    results: [{ lot_id: null, name: 'RLS-TEST badsum', head: 5 }],
  })
  const stale = await api(A, '/api/log', {
    id: randomUUID(), type: 'group_action', action: 'preg_check',
    source_lot_id: a.lotId, expected_head: (nowHead ?? 0) + 999, counted: 1, stay: 1, results: [],
  })
  const aUnmoved = await headOf(a.lotId)
  record('user A (owner)', '10: numbers that do not add up are refused, in those words, and nothing moves',
    badSum.status === 400 && /do not add up/i.test(String(badSum.json.error)) && aUnmoved === nowHead,
    `${badSum.status} · "${String(badSum.json.error ?? '').slice(0, 60)}" · source ${aUnmoved}`)
  record('user A (owner)', '10: a count someone else has already changed is refused rather than clobbered',
    stale.status === 409 && aUnmoved === nowHead,
    `${stale.status} · "${String(stale.json.error ?? '').slice(0, 70)}"`)

  // ── B sees none of it: not the working, not the group it made. ─────────────
  const Bc = await userClient('B')
  const bSeesEvent = await Bc.from('events').select('id').eq('id', workingId)
  const bSeesLot = made ? await Bc.from('herd_lots').select('id').eq('id', made.id) : { data: [] }
  record('user B (other ranch)', '10: the working and the bunch it created are both invisible to the other ranch',
    (bSeesEvent.data ?? []).length === 0 && (bSeesLot.data ?? []).length === 0,
    `event ${(bSeesEvent.data ?? []).length} · group ${(bSeesLot.data ?? []).length}`)

  const anon = await fetch(`${BASE}/api/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {}) },
    body: JSON.stringify({ id: randomUUID(), type: 'group_action', action: 'preg_check', source_lot_id: a.lotId, expected_head: null, counted: 1, stay: 1, results: [] }),
  })
  record('anonymous', '10: a signed-out caller cannot record a working', anon.status === 401, `${anon.status}`)
}

// ── Block 14 — count cattle; bunches made on the spot ─────────────────────────
async function countChecks() {
  const a = fx.A!, b = fx.B!
  const A = await userClient('A')
  const headOf = async (id: string) => ((await admin.from('herd_lots').select('head_count').eq('id', id).maybeSingle()).data as { head_count?: number } | null)?.head_count ?? null

  // 069 by capability: a bunch with no weight, of class pairs, at a place.
  const spot = await api(A, '/api/herd/lots', { name: `${PREFIX}spot`, class: 'pairs', head_count: 7, place_id: a.placeId })
  if (spot.status === 500 || (spot.status === 400 && /avg_weight|class must|update 069/.test(String(spot.json.error)))) {
    record('(skipped)', '14: bunch checks — migration 069 not applied', true, `${spot.status} ${String(spot.json.error ?? '').slice(0, 60)}`); return
  }
  const spotLot = (spot.json.lot ?? null) as { id: string; class: string; avg_weight: number | null; place_id?: string | null } | null
  record('user A (owner)', '14/069: a bunch made on the spot — name, head, class pairs, a place, NO weight — is accepted as it is',
    spot.status === 201 && !!spotLot && spotLot.class === 'pairs' && spotLot.avg_weight === null && spotLot.place_id === a.placeId,
    `${spot.status} · class ${String(spotLot?.class)} · weight ${String(spotLot?.avg_weight)} · place ${spotLot?.place_id === a.placeId ? 'A\'s' : String(spotLot?.place_id)}`)

  const foreign = await api(A, '/api/herd/lots', { name: `${PREFIX}foreign-place`, class: 'cows', head_count: 3, place_id: b.placeId })
  const { count: foreignRows } = await admin.from('herd_lots').select('id', { count: 'exact', head: true }).eq('name', `${PREFIX}foreign-place`)
  record('user A (owner)', '14: a bunch cannot be put at another ranch\'s place — refused as "no such place", no row',
    foreign.status === 400 && /No such place/.test(String(foreign.json.error)) && (foreignRows ?? 0) === 0, `${foreign.status} · "${String(foreign.json.error ?? '').slice(0, 50)}" · rows ${foreignRows ?? 0}`)

  // A count: its own row, expected read from the bunch, the head count untouched.
  const before = await headOf(a.lotId)
  if (before == null) { record('(skipped)', '14: count checks — seeded lot gone', true, ''); return }
  const c1 = randomUUID()
  const count1 = await api(A, '/api/log', { id: c1, type: 'cattle_counted', herd_lot_id: a.lotId, counted: before - 1, expected: 12345 })
  const { data: row1 } = await admin.from('events').select('payload').eq('id', c1).maybeSingle()
  const p1 = (row1 as { payload?: Record<string, unknown> } | null)?.payload ?? {}
  const after1 = await headOf(a.lotId)
  const fu = count1.json.follow_up as { kind?: string; head?: number; label?: string } | undefined
  const line1 = ((count1.json.consequence as { lines?: string[] } | undefined)?.lines ?? [])[0] ?? ''
  record('user A (owner)', '14: a count is its own row — counted, expected read from the bunch (never from the phone), who — and the bunch\'s head count does not move',
    count1.status === 201 && p1.counted === before - 1 && p1.expected === before && after1 === before,
    `${count1.status} · counted ${String(p1.counted)} · expected ${String(p1.expected)} (phone sent 12345) · head ${before} → ${after1}`)
  record('user A (owner)', '14: the answer is "counted · expected · difference", and offers "Change bunch to N?" only when they differ',
    new RegExp(`${before - 1} counted · ${before} expected · −1`).test(line1) && fu?.kind === 'set_head' && fu.head === before - 1 && /Change bunch to/.test(String(fu.label)),
    `"${line1}" · follow-up ${fu ? `${fu.kind} → ${fu.head}` : 'none'}`)

  const c2 = randomUUID()
  const count2 = await api(A, '/api/log', { id: c2, type: 'cattle_counted', herd_lot_id: a.lotId, counted: before })
  const line2 = ((count2.json.consequence as { lines?: string[] } | undefined)?.lines ?? [])[0] ?? ''
  const { count: bothRows } = await admin.from('events').select('id', { count: 'exact', head: true }).in('id', [c1, c2]).is('deleted_at', null)
  record('user A (owner)', '14: a second count is a second row — both survive — and an equal count offers no change',
    count2.status === 201 && (bothRows ?? 0) === 2 && /same$/.test(line2) && count2.json.follow_up === undefined,
    `${count2.status} · rows ${bothRows ?? 0} · "${line2}" · follow-up ${count2.json.follow_up === undefined ? 'none' : 'PRESENT'}`)

  // Counting another ranch's bunch: refused, nothing written.
  const cross = await api(A, '/api/log', { id: randomUUID(), type: 'cattle_counted', herd_lot_id: b.lotId, counted: 1 })
  record('user A (owner)', '14: a count of another ranch\'s bunch is refused as "not on your ranch", and nothing lands',
    cross.status === 400 && /not on your ranch/.test(String(cross.json.error)), `${cross.status} · "${String(cross.json.error ?? '').slice(0, 50)}"`)

  // "Change bunch to N?" — through the bunch's own PATCH, writing a head_count_set row.
  const { data: lotRow } = await admin.from('herd_lots').select('id, class, name, head_count, avg_weight, weight_unit, frame, weaned, sale_windows, updated_at').eq('id', a.lotId).maybeSingle()
  const lot = lotRow as Record<string, unknown> | null
  const change = await api(A, `/api/herd/lots/${a.lotId}`, { ...lot, head_count: before - 1, expected_updated_at: lot?.updated_at }, 'PATCH')
  const afterChange = await headOf(a.lotId)
  const { count: sets } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('type', 'head_count_set').eq('payload->>lot_id', a.lotId).eq('payload->>head_after', String(before - 1))
  record('user A (owner)', '14: taking "Change bunch to N?" sets the head count through the bunch\'s own save, with a head_count_set row like any edit',
    change.status === 200 && afterChange === before - 1 && (sets ?? 0) >= 1, `${change.status} · head ${before} → ${afterChange} · head_count_set rows ${sets ?? 0}`)
  // put it back for the checks after this one
  const { data: lotNow } = await admin.from('herd_lots').select('updated_at').eq('id', a.lotId).maybeSingle()
  await api(A, `/api/herd/lots/${a.lotId}`, { ...lot, head_count: before, expected_updated_at: (lotNow as { updated_at?: string } | null)?.updated_at }, 'PATCH')
  if (spotLot) await admin.from('herd_lots').delete().eq('id', spotLot.id)
}

// ── Block 12 (12.4) — the trash is ranch-scoped, restore included ─────────────
// A trashed row is still a row; restore is an UPDATE through the service role
// after the caller's own client has proved the row exists to them. The thing
// worth proving is the other direction: a member of ranch B, handed the id of
// a place ranch A deleted, gets nothing — not a restore, not a 500, not a
// hint that the row exists. Skips, saying so, until 065 is applied.
async function trashChecks() {
  const a = fx.A!
  const A = await userClient('A')
  const B = await userClient('B')

  const probe = await api(A, '/api/trash', null, 'GET')
  if (probe.status !== 200) { record('(skipped)', '12.4: trash checks — /api/trash not answering', true, `${probe.status}`); return }

  const { data: tp } = await admin.from('places').insert({ ranch_id: a.ranchId, user_id: a.userId, name: `${PREFIX}A trash place`, kind: 'field' }).select('id').single()
  if (!tp) { record('(skipped)', '12.4: trash checks — could not seed a place', true, ''); return }
  const del = await api(A, `/api/places/${tp.id}`, null, 'DELETE')
  if (del.status === 503 || (del.json as { trashed?: boolean }).trashed !== true) {
    await admin.from('places').delete().eq('id', tp.id)
    record('(skipped)', '12.4: trash checks — migration 065 not applied', true, `${del.status} · ${String(del.json.error ?? 'hard-deleted, no trash')}`)
    return
  }

  const bList = await api(B, '/api/trash', null, 'GET')
  const bSees = ((bList.json.items ?? []) as { id: string }[]).some(i => i.id === tp.id)
  record('user B (other ranch)', '12.4: ranch A\'s trash does not appear in ranch B\'s', bList.status === 200 && !bSees, `${bList.status} · B sees A's row ${bSees}`)

  const steal = await api(B, '/api/trash', { table: 'places', id: tp.id })
  const { data: after } = await admin.from('places').select('deleted_at').eq('id', tp.id).maybeSingle()
  const stillTrashed = !!(after as { deleted_at: string | null } | null)?.deleted_at
  record('user B (other ranch)', '12.4: B cannot restore A\'s deleted place — refused as not-in-your-trash, and the row stays where A put it',
    steal.status === 404 && stillTrashed, `${steal.status} · still in trash ${stillTrashed}`)

  const mine = await api(A, '/api/trash', { table: 'places', id: tp.id })
  const { data: back } = await admin.from('places').select('deleted_at').eq('id', tp.id).maybeSingle()
  record('user A (owner)', '12.4: A restores it with one call, and it is live again', mine.status === 200 && (back as { deleted_at: string | null } | null)?.deleted_at === null, `${mine.status}`)

  await admin.from('places').delete().eq('id', tp.id)
}

// ── Block 12 (12.6) — the head-count projection cannot be steered across ranches ─
//
// 066 made herd_lots.head_count a projection rebuilt by a SECURITY DEFINER
// trigger. PK asked whether the trigger function could be called directly to
// rebuild a count on a ranch the caller does not belong to. It cannot — a
// RETURNS TRIGGER function is refused outside a trigger — but the question
// found the real door beside it: a member of B may write a ledger row on B
// whose PAYLOAD names A's lot, and 066's rebuild believed it. 067 makes the
// projection believe only rows on the lot's own ranch. This is the proof, and
// it is RED on any database with 066 and not 067.
async function projectionChecks() {
  const a = fx.A!, b = fx.B!
  const B = await userClient('B')

  // Capability, not existence: 42883 = the function is not there (066 unrun).
  // Anything else (42501 permission denied, or a row) = 066 is applied.
  const probe = await admin.rpc('rebuild_lot_head', { p_lot: '00000000-0000-0000-0000-000000000000' })
  if (probe.error?.code === '42883') { record('(skipped)', '12.6: projection checks — migration 066 not applied', true, ''); return }

  const headOf = async (id: string) => ((await admin.from('herd_lots').select('head_count').eq('id', id).maybeSingle()).data as { head_count?: number } | null)?.head_count ?? null
  const aBefore = await headOf(a.lotId)
  if (aBefore == null) { record('(skipped)', '12.6: projection checks — seeded lot gone', true, ''); return }

  // B writes a count for A's lot — on B's OWN ranch, which 043 permits.
  const set = await B.from('events').insert({ user_id: b.userId, ranch_id: b.ranchId, device_id: null, type: 'head_count_set', ts: new Date().toISOString(), schema_version: 1,
    payload: { source: 'manual', schema_version: 1, lot_id: a.lotId, head_before: aBefore, head_after: 999, reason: 'edit' } }).select('id').single()
  const afterSet = await headOf(a.lotId)
  record('user B (other ranch)', '12.6/067: a count B writes on B\'s ranch naming A\'s lot moves nothing on A — the projection believes only the lot\'s own ranch',
    afterSet === aBefore, `B\'s row ${set.error ? `refused (${set.error.code})` : 'landed on B'} · A ${aBefore} → ${afterSet}`)

  // B writes a working on B naming A's lot as a result.
  const ga = await B.from('events').insert({ user_id: b.userId, ranch_id: b.ranchId, device_id: null, type: 'group_action', ts: new Date().toISOString(), schema_version: 1,
    payload: { source: 'manual', schema_version: 1, action: 'sort', counted: 50, stayed: 0, moved: 50, source_lot_id: b.lotId, source_head_before: 40, source_head_after: 0,
      results: [{ lot_id: a.lotId, head: 50, created: false, head_before: aBefore, head_after: aBefore + 50 }] } }).select('id').single()
  const afterGa = await headOf(a.lotId)
  record('user B (other ranch)', '12.6/067: a working B writes on B naming A\'s lot as a result moves nothing on A',
    afterGa === aBefore, `B\'s row ${ga.error ? `refused (${ga.error.code})` : 'landed on B'} · A ${aBefore} → ${afterGa}`)

  // Direct calls: neither function is a client's to call.
  const direct = await B.rpc('rebuild_lot_head', { p_lot: a.lotId })
  const afterDirect = await headOf(a.lotId)
  record('user B (other ranch)', '12.6: B cannot call rebuild_lot_head on A\'s lot — refused, and A unmoved',
    !!direct.error && afterDirect === aBefore, `${direct.error?.code ?? 'ALLOWED'} · A ${afterDirect}`)
  const trig = await B.rpc('events_project_head_counts')
  record('user B (other ranch)', '12.6: the trigger function cannot be called directly by a client', !!trig.error, `${trig.error?.code ?? 'ALLOWED'} ${(trig.error?.message ?? '').slice(0, 60)}`)

  // Tidy: B's probe rows.
  if (set.data) await admin.from('events').delete().eq('id', set.data.id)
  if (ga.data) await admin.from('events').delete().eq('id', ga.data.id)
  // And A's own count must still be what it was after those deletes fire the trigger.
  record('user A (owner)', '12.6/067: after B\'s rows are gone, A\'s count still stands where A left it', (await headOf(a.lotId)) === aBefore, `A ${await headOf(a.lotId)} (was ${aBefore})`)
}

// ── Block 25b (072): where a bunch is cannot be steered across ranches ────────
// The place projection is SECURITY DEFINER, like the head count's, so it gets
// 067's proof: a move B writes on B's ranch naming A's bunch — or naming A's
// place for B's own bunch — puts nothing anywhere on A, and B's bunch nowhere
// on A's ground.
async function placeProjectionChecks() {
  const a = fx.A!, b = fx.B!
  const B = await userClient('B')
  // Capability, not existence: 42883 = the function is not there (072 unrun).
  const probe = await admin.rpc('rebuild_lot_place', { p_lot: '00000000-0000-0000-0000-000000000000' })
  // A capability gap, named and RED — never a skip to reach green.
  if (probe.error?.code === '42883') { record('(gap)', '25b: place projection checks — CAPABILITY GAP: migration 072 is not applied on this database', false, 'five cross-ranch place checks cannot be read until 072 is run'); return }

  const placeOf = async (id: string) => ((await admin.from('herd_lots').select('place_id').eq('id', id).maybeSingle()).data as { place_id?: string | null } | null)?.place_id ?? null
  const aBefore = await placeOf(a.lotId), bBefore = await placeOf(b.lotId)
  const move = (lot: string, to: string) => B.from('events').insert({ user_id: b.userId, ranch_id: b.ranchId, device_id: null, type: 'cattle_moved', ts: new Date().toISOString(), schema_version: 1,
    payload: { source: 'manual', schema_version: 1, head: 5, herd_lot_id: lot, from_place_id: null, to_place_id: to, place_id: to } }).select('id').single()

  const m1 = await move(a.lotId, b.placeId)
  record('user B (other ranch)', '25b/072: a move B writes on B\'s ranch naming A\'s bunch puts A\'s bunch nowhere — the projection believes only the bunch\'s own ranch',
    (await placeOf(a.lotId)) === aBefore, `B\'s row ${m1.error ? `refused (${m1.error.code})` : 'landed on B'} · A\'s bunch ${aBefore ?? 'no place'} → ${(await placeOf(a.lotId)) ?? 'no place'}`)

  const m2 = await move(b.lotId, a.placeId)
  const bAfter = await placeOf(b.lotId)
  record('user B (other ranch)', '25b/072: B\'s own bunch cannot be put on A\'s place — a place on another ranch is no place',
    bAfter !== a.placeId, `B\'s row ${m2.error ? `refused (${m2.error.code})` : 'landed on B'} · B\'s bunch → ${bAfter === a.placeId ? 'A\'S PLACE' : bAfter ?? 'no place'}`)

  const viaRoute = await api(B, '/api/log', { id: randomUUID(), type: 'cattle_moved', head: 5, herd_lot_id: a.lotId, to_place_id: b.placeId, place_id: b.placeId })
  // Block 30: a sighting the same — B cannot say A's bunch was seen anywhere.
  const seenId = randomUUID()
  const viaSeen = await api(B, '/api/log', { id: seenId, type: 'bunch_seen', herd_lot_id: a.lotId, place_id: b.placeId })
  const { count: seenLanded } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('id', seenId)
  record('user B (other ranch)', '30: the record route refuses a sighting naming another ranch\'s bunch, and nothing lands', viaSeen.status === 400 && /not on your ranch/i.test(String(viaSeen.json.error ?? '')) && (seenLanded ?? 0) === 0, `${viaSeen.status} "${String(viaSeen.json.error ?? '').slice(0, 50)}" · rows ${seenLanded ?? 0}`)
  record('user B (other ranch)', '25: the record route refuses a move naming another ranch\'s bunch, and A\'s bunch is unmoved',
    viaRoute.status === 400 && (await placeOf(a.lotId)) === aBefore, `${viaRoute.status} "${String(viaRoute.json.error ?? '').slice(0, 50)}"`)

  for (const fn of ['rebuild_lot_place', 'lot_place_from_moves'] as const) {
    const direct = await B.rpc(fn, { p_lot: a.lotId })
    record('user B (other ranch)', `25b: B cannot call ${fn} on A\'s bunch — refused`, !!direct.error && (await placeOf(a.lotId)) === aBefore, `${direct.error?.code ?? 'ALLOWED'}`)
  }
  const trig = await B.rpc('events_project_bunch_place')
  record('user B (other ranch)', '25b: the place trigger function cannot be called directly by a client', !!trig.error, `${trig.error?.code ?? 'ALLOWED'}`)

  // Tidy B's probe rows; both bunches must read as they did before any of this.
  for (const m of [m1, m2]) if (m.data) await admin.from('events').delete().eq('id', m.data.id)
  record('user A (owner)', '25b/072: after B\'s rows are gone, both bunches are where they were', (await placeOf(a.lotId)) === aBefore && (await placeOf(b.lotId)) === bBefore,
    `A ${(await placeOf(a.lotId)) ?? 'no place'} (was ${aBefore ?? 'no place'}) · B ${(await placeOf(b.lotId)) ?? 'no place'} (was ${bBefore ?? 'no place'})`)
}

async function turnoutChecks() {
  const a = fx.A!, b = fx.B!
  const A = await userClient('A')
  const B = await userClient('B')

  const year = new Date().getUTCFullYear() + 1
  const first = `${year}-05-15`, second = `${year}-05-22`

  const set = await api(A, '/api/ranch/turnout', { date: first })
  const setId = String((((set.json.upcoming ?? {}) as { id?: string }).id) ?? '')
  record('user A (owner)', '9: the isolation suite can reach /api/ranch/turnout — a Bearer token is accepted and a date is stored',
    set.status === 200 && !!setId, `${set.status} · ${setId ? 'stored' : `NO ROW — ${String(set.json.error ?? '').slice(0, 60)}`}`)
  if (!setId) return

  const { data: row } = await admin.from('events').select('ranch_id, user_id, type').eq('id', setId).maybeSingle()
  const r = row as { ranch_id: string | null; user_id: string; type: string } | null
  record('user A (owner)', '9: the turnout lands on the writer\'s own ranch, under its own type — never on the record as work',
    !!r && r.ranch_id === a.ranchId && r.user_id === a.userId && r.type === 'turnout',
    `ranch ${r?.ranch_id === a.ranchId ? 'A' : String(r?.ranch_id)} · user ${r?.user_id === a.userId ? 'A' : 'OTHER'} · type ${r?.type}`)

  // B cannot read it — through the API, and through the table underneath it.
  const bApi = await api(B, '/api/ranch/turnout', null, 'GET')
  const bUpcoming = (bApi.json.upcoming ?? null) as { date?: string } | null
  record('user B (other ranch)', '9: ranch A\'s turnout date does not appear in ranch B\'s answer',
    bApi.status === 200 && (bUpcoming === null || bUpcoming.date !== first),
    `${bApi.status} · B sees ${bUpcoming?.date ?? 'nothing'}`)
  const bSees = await B.from('events').select('id').eq('id', setId)
  record('user B (other ranch)', '9: and not through the table either — membership is the only gate there is',
    (bSees.data ?? []).length === 0, `${(bSees.data ?? []).length} row(s) visible to B`)

  // B setting their own must not touch A's.
  const bSet = await api(B, '/api/ranch/turnout', { date: `${year}-04-30` })
  const bId = String((((bSet.json.upcoming ?? {}) as { id?: string }).id) ?? '')
  const { data: bRow } = bId ? await admin.from('events').select('ranch_id').eq('id', bId).maybeSingle() : { data: null }
  const { data: aStill } = await admin.from('events').select('payload, superseded_by').eq('id', setId).maybeSingle()
  const aPayload = ((aStill as { payload?: Record<string, unknown> } | null)?.payload ?? {}) as { date?: string }
  record('user B (other ranch)', '9: B setting their own turnout lands on B and leaves A\'s date exactly where it was',
    (bRow as { ranch_id?: string } | null)?.ranch_id === b.ranchId && aPayload.date === first && !(aStill as { superseded_by?: string } | null)?.superseded_by,
    `B landed on ${(bRow as { ranch_id?: string } | null)?.ranch_id === b.ranchId ? 'B' : 'ELSEWHERE'} · A still ${aPayload.date ?? 'GONE'}`)

  // Changing it supersedes rather than accumulates: exactly one live turnout.
  const changed = await api(A, '/api/ranch/turnout', { date: second })
  const { data: old } = await admin.from('events').select('superseded_by').eq('id', setId).maybeSingle()
  const live = await A.from('events').select('id, payload').eq('type', 'turnout').is('superseded_by', null).is('voided_at', null).is('deleted_at', null)
  const liveDates = ((live.data ?? []) as { payload: { date?: string } }[]).map(x => x.payload?.date)
  record('user A (owner)', '9: changing the date supersedes the old one — the planning surface is never handed two live answers',
    changed.status === 200 && !!(old as { superseded_by?: string } | null)?.superseded_by && liveDates.length === 1 && liveDates[0] === second,
    `${changed.status} · old superseded ${!!(old as { superseded_by?: string } | null)?.superseded_by} · live [${liveDates.join(', ')}]`)

  // A date in the past is a typo, not a plan — and a fat-fingered year is the
  // one mistake that would make every planning number absurd in silence.
  const past = await api(A, '/api/ranch/turnout', { date: '2020-05-15' })
  const farOut = await api(A, '/api/ranch/turnout', { date: `${year + 5}-05-15` })
  const junk = await api(A, '/api/ranch/turnout', { date: 'next spring' })
  record('user A (owner)', '9: a past date, a year five out and a phrase are all refused with a sentence — never stored, never a 500',
    past.status === 400 && farOut.status === 400 && junk.status === 400 &&
    [past, farOut, junk].every(x => typeof x.json.error === 'string' && String(x.json.error).length > 10),
    `past ${past.status} · far ${farOut.status} · junk ${junk.status}`)

  const anon = await fetch(`${BASE}/api/ranch/turnout`, { headers: process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {} })
  record('anonymous', '9: a signed-out reader is turned away from the turnout date', anon.status === 401, `${anon.status}`)
}

async function placesChecks() {
  const a = fx.A!, b = fx.B!
  const A = await userClient('A')

  // ── 1. The validator, as a pure function ────────────────────────────────────
  // A closed, simple, plausible rectangle near Petroleum County: 0.01° of
  // latitude by 0.01° of longitude.
  const LAT = 47.0, LNG = -108.2, D = 0.01
  const rect = (close = true) => {
    const r = [
      { lat: LAT, lng: LNG },
      { lat: LAT, lng: LNG + D },
      { lat: LAT + D, lng: LNG + D },
      { lat: LAT + D, lng: LNG },
    ]
    return close ? [...r, r[0]] : r
  }
  const cases: [string, unknown, boolean][] = [
    ['a closed simple rectangle', rect(), true],
    ['an OPEN ring (last corner does not meet the first)', rect(false), false],
    ['fewer than 4 points', [{ lat: LAT, lng: LNG }, { lat: LAT + D, lng: LNG }, { lat: LAT, lng: LNG }], false],
    ['a corner outside the plausible window', [{ lat: LAT, lng: LNG }, { lat: LAT, lng: LNG + D }, { lat: 12.3, lng: 4.5 }, { lat: LAT, lng: LNG }], false],
    ['lat and lng swapped', [{ lat: LNG, lng: LAT }, { lat: LNG + D, lng: LAT }, { lat: LNG + D, lng: LAT + D }, { lat: LNG, lng: LAT }], false],
    ['raw 1e-7 degrees, unconverted', [{ lat: 470000000, lng: -1082000000 }, { lat: 470100000, lng: -1082000000 }, { lat: 470100000, lng: -1081900000 }, { lat: 470000000, lng: -1082000000 }], false],
    // A bow tie: the two diagonals cross.
    ['a self-intersecting bow tie', [{ lat: LAT, lng: LNG }, { lat: LAT + D, lng: LNG + D }, { lat: LAT + D, lng: LNG }, { lat: LAT, lng: LNG + D }, { lat: LAT, lng: LNG }], false],
    ['three collinear taps (no ground enclosed)', [{ lat: LAT, lng: LNG }, { lat: LAT, lng: LNG + D }, { lat: LAT, lng: LNG + 2 * D }, { lat: LAT, lng: LNG }], false],
  ]
  for (const [label, ring, shouldPass] of cases) {
    const v = validateRing(ring)
    record('validator', `${shouldPass ? 'accepts' : 'rejects'} ${label}`, v.ok === shouldPass, v.ok ? `${v.acres.toFixed(2)} ac` : v.error)
  }

  // ── 2. Acreage against a known synthetic rectangle ──────────────────────────
  // 0.01° lat = 1111.32 m (M_PER_LAT). 0.01° lng at 47.005° = 1113.20·cos(lat).
  // The expected value is computed from the SAME constants the code uses, so
  // this checks the arithmetic, not the constants — a projection change moves
  // both sides and is caught by scripts/field-report.ts, which owns that.
  const midLat = LAT + D / 2
  const expectedM2 = (D * 111_132) * (D * 111_320 * Math.cos((midLat * Math.PI) / 180))
  const localAcres = polygonAreaAcres(rect())
  record('validator', 'acreage of a known rectangle matches the shoelace', Math.abs(localAcres * 4046.8564224 - expectedM2) / expectedM2 < 0.001, `${localAcres.toFixed(3)} ac vs ${(expectedM2 / 4046.8564224).toFixed(3)} ac expected`)

  // A non-finite acreage must never become a stored number. NaN and Infinity
  // both survive JSON as `null`, which in this column is indistinguishable
  // from "not drawn yet" — so the guard refuses instead of writing.
  for (const [label, v] of [['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['zero', 0], ['negative', -3]] as const) {
    record('validator', `a ${label} acreage is refused, never stored`, storableAcres(v) === null, `storableAcres(${label}) = ${String(storableAcres(v))}`)
  }
  record('validator', 'a real acreage stores rounded to two decimals', storableAcres(12.3456) === 12.35, String(storableAcres(12.3456)))

  // ── 7.9: an alert fires on a CHANGE, and a dismissal is of that change ──────
  // Pure, no database: the whole promise of the design lives in the key, and a
  // key is computable without a table. What must hold — an unchanged weekly
  // publication is silent; a change alerts; a LATER, DIFFERENT change produces
  // a DIFFERENT key so dismissing the first cannot silence the second.
  {
    const wk = (week: string, d2: number, d3: number) => ({ week_date: week, d0: 100, d1: 100, d2, d3, d4: 0 })
    const base = { fips: '30069', countyName: 'Petroleum County', lfpTier: null, priorLfpTier: null, deadlines: { status: 'none' } as const }
    const same = buildProgramAlerts({ ...base, latest: wk('2026-09-08', 40, 0), prior: wk('2026-09-01', 40, 0) })
    record('alerts', 'an unchanged weekly publication raises nothing', same.length === 0, `${same.length} alert(s)`)
    const worse = buildProgramAlerts({ ...base, latest: wk('2026-09-08', 60, 30), prior: wk('2026-09-01', 40, 0) })
    record('alerts', 'a drought designation change raises exactly one alert', worse.length === 1 && worse[0].kind === 'drought', worse.map(a => a.headline).join(' | '))
    // The SAME transition, a fortnight later, is a different fact and must be a
    // different key — this is the case a timestamp cursor gets wrong.
    const later = buildProgramAlerts({ ...base, latest: wk('2026-09-22', 70, 60), prior: wk('2026-09-15', 60, 0) })
    record('alerts', 'a LATER change has a DIFFERENT key — dismissing the first cannot silence it', later.length === 1 && later[0].key !== worse[0].key, `${worse[0]?.key} vs ${later[0]?.key}`)
    const first = buildProgramAlerts({ ...base, latest: wk('2026-09-08', 60, 30), prior: null })
    record('alerts', 'a first observation is not a change', first.length === 0, `${first.length} alert(s)`)
    const tier = buildProgramAlerts({ ...base, latest: wk('2026-09-08', 60, 0), prior: wk('2026-09-01', 60, 0), lfpTier: 2, priorLfpTier: 1 })
    record('alerts', 'an LFP tier move alerts, and says FSA decides', tier.length === 1 && tier[0].kind === 'lfp' && /FSA makes the final determination/.test(tier[0].detail), tier[0]?.headline ?? '')
    const dl = (days: number) => buildProgramAlerts({ ...base, latest: null, prior: null, deadlines: { status: 'ok', deadlines: [{ crop_or_program: 'prf', deadline_type: 'sales_closing', deadline_date: '2026-12-01', daysUntil: days, source: 'x', as_of: null }] } })
    record('alerts', 'a deadline alerts at 30, 7 and 1 days and is silent between', dl(30).length === 1 && dl(7).length === 1 && dl(1).length === 1 && dl(29).length === 0 && dl(14).length === 0, `30/7/1 = ${dl(30).length}/${dl(7).length}/${dl(1).length} · 29/14 = ${dl(29).length}/${dl(14).length}`)
    record('alerts', 'each deadline window is its own key — 30 days cannot silence tomorrow', dl(30)[0].key !== dl(1)[0].key, `${dl(30)[0].key} vs ${dl(1)[0].key}`)
    record('alerts', 'a deadline alert NAMES its program, never a bare date', /prf/i.test(dl(7)[0].headline) && /sales closing/i.test(dl(7)[0].headline), dl(7)[0].headline)
  }

  // ── ONE gate for every route check below ────────────────────────────────────
  // 056 gave the route `acres` / `geometry_provenance`; 057 gave it
  // `updated_by` / `retired_at`. The route writes both on every PATCH, so on a
  // database missing either it fails loudly and correctly — and seven red lines
  // saying "500" tell you far less than one line naming the migration. Same
  // lesson as the route-up probe: collapse a knowable cause into one sentence.
  const probe = await admin.from('places').select('acres, geometry_provenance, parent_id, updated_by, retired_at, revision').limit(1)
  if (probe.error) { record('(skipped)', 'places route checks — migration 056/057 not applied', true, probe.error.message.slice(0, 70)); return }

  const geometry = { type: 'Polygon', coordinates: [rect().map(p => [p.lng, p.lat])] }

  // ── Is BASE running the code these checks are written against? ──────────────
  // This probe has now been wrong twice, in two different ways, and the second
  // way is the interesting one.
  //
  //   v1 asked nothing, and a host WITHOUT the route answered 404 to
  //   everything under it — so "cross-ranch PATCH → 404" PASSED for entirely
  //   the wrong reason while the anonymous 401 check failed.
  //
  //   v2 asked "does GET answer 200?" That catches an ABSENT route and nothing
  //   else. Production then hit the state neither version anticipated: the
  //   route file present but at an OLDER BUILD. GET answered 200, the probe
  //   was happy, and ten checks failed one at a time — a missing DELETE is
  //   405, not 404, and an older PATCH is a perfectly healthy 200 that simply
  //   ignores fields it has never heard of.
  //
  // So stop asking whether the file is there and ask whether it can do what
  // these checks require. The response SHAPE is that contract: this build's
  // SELECT returns updated_by / retired_at / revision and no earlier one does.
  // Existence is not capability, and a suite that cannot tell them apart
  // reports ten symptoms instead of one cause.
  const up = await api(A, `/api/places/${a.placeId}`, undefined, 'GET')
  const shape = (up.json.place ?? {}) as Record<string, unknown>
  const missing = ['updated_by', 'retired_at', 'revision'].filter(k => !(k in shape))
  const routeUp = up.status === 200 && missing.length === 0
  record('user A (owner)', 'GET /api/places/<own> answers, and BASE is running this slice\'s build', routeUp,
    up.status !== 200
      ? `${up.status} — /api/places/[id] is not reachable here, or will not take a Bearer session`
      : missing.length
        ? `200 but the reply is missing ${missing.join(', ')} — BASE is on an older build; deploy this branch and re-run`
        : '200 · current')
  if (!routeUp) {
    record('(skipped)', 'places route checks — BASE is not running this build (see the line above)', true, 'one cause, not ten symptoms')
    return
  }

  // ── 3. POST persists kind + geometry, and computes acres itself ─────────────
  let createdId: string | null = null
  {
    // `acres` is posted deliberately wrong: the server must ignore it.
    const r = await api(A, '/api/places', { name: `${PREFIX}drawn`, kind: 'pasture', geometry, acres: 99999 })
    const place = (r.json.place ?? {}) as Record<string, unknown>
    // Teardown sweeps places by the RLS-TEST- name prefix, so nothing to track.
    createdId = typeof place.id === 'string' ? place.id : null
    const acres = typeof place.acres === 'number' ? place.acres : null
    record('user A (owner)', 'POST /api/places persists kind (not the old "field" default)', r.status === 201 && place.kind === 'pasture', `${r.status} · kind=${String(place.kind)}`)
    // Detail says "(absent)" when the route returned nothing. It used to print
    // NaN, which reads like a value that reached the column and sent PK
    // hunting for a stored NaN that never existed. A check that fails must
    // describe what happened, not hand back its own placeholder.
    record('user A (owner)', 'POST /api/places computes acres server-side, ignoring the client', acres != null && Math.abs(acres - localAcres) < 0.02, `${r.status} · stored ${acres == null ? '(absent — the route returned no place)' : acres} vs ${localAcres.toFixed(2)} expected · posted 99999`)
  }

  // ── The validator is wired into the route, not just unit-tested ─────────────
  {
    const open = { type: 'Polygon', coordinates: [rect(false).map(p => [p.lng, p.lat])] }
    const r = await api(A, '/api/places', { name: `${PREFIX}open`, geometry: open })
    record('user A (owner)', 'POST /api/places rejects an open ring → 400', r.status === 400 && typeof r.json.error === 'string', `${r.status} · ${String(r.json.error).slice(0, 48)}`)
  }
  {
    const bow = { type: 'Polygon', coordinates: [[[LNG, LAT], [LNG + D, LAT + D], [LNG, LAT + D], [LNG + D, LAT], [LNG, LAT]]] }
    const r = await api(A, '/api/places', { name: `${PREFIX}bow`, geometry: bow })
    record('user A (owner)', 'POST /api/places rejects a self-intersecting ring → 400', r.status === 400, `${r.status} · ${String(r.json.error).slice(0, 48)}`)
  }

  // ── 4. PATCH: own place yes, another ranch's place never ────────────────────
  if (createdId) {
    const r = await api(A, `/api/places/${createdId}`, { kind: 'stackyard', name: `${PREFIX}renamed` }, 'PATCH')
    const place = (r.json.place ?? {}) as Record<string, unknown>
    record('user A (owner)', 'PATCH /api/places/<own> round-trips kind and name', r.status === 200 && place.kind === 'stackyard' && place.name === `${PREFIX}renamed`, `${r.status} · ${String(place.kind)} · ${String(place.name)}`)
    // The shape survives a name-only PATCH — a partial write must not blank it.
    const r2 = await api(A, `/api/places/${createdId}`, { name: `${PREFIX}renamed2` }, 'PATCH')
    const p2 = (r2.json.place ?? {}) as Record<string, unknown>
    record('user A (owner)', 'a name-only PATCH leaves the drawn shape alone', r2.status === 200 && p2.geometry != null && typeof p2.acres === 'number', `${r2.status} · geometry ${p2.geometry == null ? 'LOST' : 'kept'}`)
  }
  // ── Geometry is SET-ONCE: a drawn shape is never silently overwritten ───────
  if (createdId) {
    // A second, different polygon over the same place.
    const L2 = LNG + 0.05
    const moved = { type: 'Polygon', coordinates: [[[L2, LAT], [L2 + D, LAT], [L2 + D, LAT + D], [L2, LAT + D], [L2, LAT]]] }
    const before = (await admin.from('places').select('geometry, acres').eq('id', createdId).maybeSingle()).data
    const r = await api(A, `/api/places/${createdId}`, { geometry: moved }, 'PATCH')
    const after = (await admin.from('places').select('geometry, acres').eq('id', createdId).maybeSingle()).data
    record('user A (owner)', 'PATCH cannot overwrite a shape that is already drawn → 409', r.status === 409, `${r.status} · ${String(r.json.error).slice(0, 52)}`)
    record('user A (owner)', 'the refused overwrite left the original shape and acreage exactly as they were', JSON.stringify(after?.geometry) === JSON.stringify(before?.geometry) && after?.acres === before?.acres, `acres ${String(before?.acres)} → ${String(after?.acres)}`)
    // Clearing is the same act by another route, and is refused too.
    const rc = await api(A, `/api/places/${createdId}`, { geometry: null }, 'PATCH')
    const afterClear = (await admin.from('places').select('geometry').eq('id', createdId).maybeSingle()).data
    record('user A (owner)', 'PATCH cannot clear a drawn shape either → 400, shape still there', rc.status === 400 && afterClear?.geometry != null, `${rc.status} · geometry ${afterClear?.geometry == null ? 'LOST' : 'kept'}`)
    // …but set-once locks the SHAPE, not the row: the name still moves, and a
    // rejected geometry in the same body must not smuggle a name change past it.
    const rn = await api(A, `/api/places/${createdId}`, { name: `${PREFIX}named-after-lock` }, 'PATCH')
    record('user A (owner)', 'set-once locks the shape, not the row — name still changes on a drawn place', rn.status === 200 && ((rn.json.place ?? {}) as Record<string, unknown>).name === `${PREFIX}named-after-lock`, `${rn.status}`)
    const rboth = await api(A, `/api/places/${createdId}`, { name: `${PREFIX}smuggled`, geometry: moved }, 'PATCH')
    const afterBoth = (await admin.from('places').select('name').eq('id', createdId).maybeSingle()).data
    record('user A (owner)', 'a rejected geometry takes the whole patch with it — no name slips through', rboth.status === 409 && afterBoth?.name === `${PREFIX}named-after-lock`, `${rboth.status} · name "${String(afterBoth?.name).slice(-18)}"`)
  }

  {
    const r = await api(A, `/api/places/${b.placeId}`, { name: `${PREFIX}tampered`, geometry }, 'PATCH')
    record('user A (owner)', 'PATCH /api/places/<ranch B place> → 404, shape untouched', r.status === 404, `${r.status}`)
    const { data: after } = await admin.from('places').select('name, geometry').eq('id', b.placeId).maybeSingle()
    record('user A (owner)', 'ranch B\'s place kept its name and stayed undrawn', after?.name !== `${PREFIX}tampered` && after?.geometry == null, `name=${String(after?.name)} · geometry=${after?.geometry == null ? 'null' : 'SET'}`)
  }
  {
    const res = await fetch(`${BASE}/api/places/${a.placeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {}) },
      body: JSON.stringify({ name: `${PREFIX}anon` }),
    })
    record('anonymous', 'PATCH /api/places/<any> → 401', res.status === 401, `${res.status}`)
  }
  {
    const res = await fetch(`${BASE}/api/places/${a.placeId}`, { method: 'DELETE', headers: process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {} })
    record('anonymous', 'DELETE /api/places/<any> → 401', res.status === 401, `${res.status}`)
  }

  // ── 057: a place can be corrected, with who, when, and a real token ─────────
  if (!createdId) return

  const readPlace = async (id: string) => (await admin.from('places').select('name, kind, geometry, acres, geometry_provenance, updated_at, updated_by, retired_at, retired_by, revision').eq('id', id).maybeSingle()).data as Record<string, unknown> | null

  // Rename + re-kind, and authorship is stamped.
  {
    const before = await readPlace(createdId)
    const r = await api(A, `/api/places/${createdId}`, { name: `${PREFIX}corrected`, kind: 'yard', expected_updated_at: before!.updated_at }, 'PATCH')
    const after = await readPlace(createdId)
    record('user A (owner)', 'PATCH renames and re-kinds a place', r.status === 200 && after!.name === `${PREFIX}corrected` && after!.kind === 'yard', `${r.status} · ${String(after!.name).slice(-10)} · ${String(after!.kind)}`)
    record('user A (owner)', 'the correction stamps updated_by with the person who made it', after!.updated_by === a.userId, `${String(after!.updated_by).slice(0, 8)} vs ${a.userId.slice(0, 8)}`)
    record('user A (owner)', 'the DATABASE moved updated_at — the token is not the app\'s to forget', after!.updated_at !== before!.updated_at, `${String(before!.updated_at).slice(11, 23)} → ${String(after!.updated_at).slice(11, 23)}`)
    // The rename must not disturb the shape it was drawn with.
    record('user A (owner)', 'a rename leaves geometry, acres and provenance byte-identical', JSON.stringify(after!.geometry) === JSON.stringify(before!.geometry) && after!.acres === before!.acres && JSON.stringify(after!.geometry_provenance) === JSON.stringify(before!.geometry_provenance), `acres ${String(before!.acres)} → ${String(after!.acres)}`)
  }

  // A stale token loses, and is told who won.
  {
    const stale = (await readPlace(createdId))!.updated_at as string
    const win = await api(A, `/api/places/${createdId}`, { name: `${PREFIX}first-in`, expected_updated_at: stale }, 'PATCH')
    const lose = await api(A, `/api/places/${createdId}`, { name: `${PREFIX}second-in`, expected_updated_at: stale }, 'PATCH')
    const after = await readPlace(createdId)
    record('user A (owner)', 'a stale expected_updated_at → 409 and the first edit stands', win.status === 200 && lose.status === 409 && after!.name === `${PREFIX}first-in`, `${win.status} then ${lose.status} · "${String(after!.name).slice(-9)}"`)
    record('user A (owner)', 'the 409 names who changed it and when, in the herd_lots words', lose.json.code === 'stale' && typeof lose.json.changed_by === 'string' && /while you had it open/.test(String(lose.json.error)) && /your entries are still in the form/.test(String(lose.json.error)), `${String(lose.json.changed_by)} · "${String(lose.json.error).slice(0, 46)}…"`)
    const fresh = await api(A, `/api/places/${createdId}`, { name: `${PREFIX}retry-wins`, expected_updated_at: after!.updated_at }, 'PATCH')
    record('user A (owner)', 'the CURRENT token saves — "save yours again" is true', fresh.status === 200 && ((await readPlace(createdId))!.name === `${PREFIX}retry-wins`), `${fresh.status}`)
  }

  // Geometry is still set-once after all of this.
  {
    const g = { type: 'Polygon', coordinates: [rect().map(p => [p.lng, p.lat])] }
    const over = await api(A, `/api/places/${createdId}`, { geometry: g }, 'PATCH')
    const clear = await api(A, `/api/places/${createdId}`, { geometry: null }, 'PATCH')
    record('user A (owner)', 'geometry is still set-once once a place is correctable', over.status === 409 && clear.status === 400 && (await readPlace(createdId))!.geometry != null, `${over.status} / ${clear.status}`)
  }

  // Retire: off the picker, still naming its history, and reversible.
  // 7D.3 — the VERB CHANGED. DELETE used to mean retire because there was no
  // reference check; now it deletes, and retire is PATCH { retired: true }.
  {
    const del = await api(A, `/api/places/${createdId}`, { retired: true }, 'PATCH')
    const after = await readPlace(createdId)
    record('user A (owner)', 'PATCH { retired: true } retires — the row stays, with who retired it', del.status === 200 && after !== null && after.retired_at != null && after.retired_by === a.userId, `${del.status} · retired_at ${after?.retired_at ? 'set' : 'NULL'}`)
    const picker = await api(A, '/api/places', undefined, 'GET')
    const ids = ((picker.json.places ?? []) as { id: string }[]).map(p => p.id)
    record('user A (owner)', 'a retired place is gone from the logging picker', !ids.includes(createdId) && ids.includes(a.placeId), `${ids.length} live place(s)`)
    const opts = await api(A, '/api/activity/options', undefined, 'GET')
    const opt = ((opts.json.places ?? []) as { id: string; name: string; retired?: boolean }[]).find(p => p.id === createdId)
    record('user A (owner)', 'but the correction picker still names it, flagged retired', !!opt && opt.retired === true && !!opt.name, `${opt ? `"${opt.name.slice(-10)}" retired=${opt.retired}` : 'ABSENT — history would lose its where'}`)
    // Every other edit is refused while it is retired.
    const blocked = await api(A, `/api/places/${createdId}`, { name: `${PREFIX}while-retired` }, 'PATCH')
    record('user A (owner)', 'a retired place refuses every edit but the way back', blocked.status === 404 && /taken off the list while you had it open/.test(String(blocked.json.error)), `${blocked.status} · ${String(blocked.json.error).slice(0, 40)}`)
    const back = await api(A, `/api/places/${createdId}`, { retired: false }, 'PATCH')
    const live = await readPlace(createdId)
    record('user A (owner)', 'PATCH { retired: false } puts it back and it is never gone', back.status === 200 && live!.retired_at === null, `${back.status}`)
  }

  // Cross-ranch: neither verb reaches another outfit's ground.
  {
    const beforeB = await readPlace(b.placeId)
    const patch = await api(A, `/api/places/${b.placeId}`, { name: `${PREFIX}stolen` }, 'PATCH')
    const del = await api(A, `/api/places/${b.placeId}`, undefined, 'DELETE')
    const afterB = await readPlace(b.placeId)
    record('user A (owner)', 'PATCH and DELETE on ranch B\'s place → 404, untouched', patch.status === 404 && del.status === 404 && afterB !== null && afterB.name === beforeB!.name && afterB.retired_at === null, `${patch.status} / ${del.status} · "${String(afterB?.name)}"`)
  }

  // ── Block 8 — a captured place, and the track it carries ────────────────────
  // 8.6 says the track is the evidence behind ONE polygon and never a record
  // of where a person went. That is a claim about visibility, so it is checked
  // the way every other visibility claim here is: from the other ranch.
  {
    const ring = rect()
    const made = await api(A, '/api/places', {
      name: `${PREFIX}ridden`, kind: 'pasture',
      geometry: { type: 'Polygon', coordinates: [ring.map(p => [p.lng, p.lat])] },
      capture: {
        source: 'ridden', status: 'estimate', snapped: true, rejected: 2,
        gaps: [{ seconds: 48 }],
        track: [{ t: 1, lat: LAT, lng: LNG, a: 2.1 }, { t: 2, lat: LAT + 0.001, lng: LNG, a: 2.4 }],
      },
    })
    const capturedId = String(((made.json.place ?? {}) as { id?: string }).id ?? '')
    record('user A (owner)', '8: a ridden place saves with its geometry', made.status === 201 && !!capturedId, `${made.status}`)

    const { data: prov } = await admin.from('places').select('geometry_provenance').eq('id', capturedId).maybeSingle()
    const gp = (prov as { geometry_provenance: Record<string, unknown> } | null)?.geometry_provenance ?? {}
    record('user A (owner)', '8.6: the track rides in provenance, with the grade that produced it — source, snapped, gaps, rejected',
      gp.source === 'ridden' && gp.snapped === true && Array.isArray(gp.track) && (gp.track as unknown[]).length === 2 && gp.rejected_fixes === 2 && Array.isArray(gp.gaps),
      `source ${String(gp.source)} · snapped ${String(gp.snapped)} · track ${Array.isArray(gp.track) ? (gp.track as unknown[]).length : 'ABSENT'} · rejected ${String(gp.rejected_fixes)}`)

    // THE CLAIM THAT MATTERS. A track is a sequence of positions with times —
    // the most sensitive thing this app has ever stored — so "ranch-scoped" is
    // asserted, not assumed.
    const Bc2 = await userClient('B')
    const bSeesPlace = await Bc2.from('places').select('id, geometry_provenance').eq('id', capturedId)
    record('user B (other ranch)', '8.6: the track is invisible to another ranch — not the place, not the provenance, not one fix',
      (bSeesPlace.data ?? []).length === 0, `${(bSeesPlace.data ?? []).length} row(s) visible to B`)

    // And it does not travel on the list read, which every picker hits.
    const list = await api(A, '/api/places', undefined, 'GET')
    const listed = ((list.json.places ?? []) as Record<string, unknown>[])
    record('user A (owner)', '8.6: the track never travels on the places list — pickers read name and kind, not a ride',
      listed.length > 0 && listed.every(pl => pl.geometry_provenance === undefined && pl.track === undefined),
      `${listed.length} place(s), ${listed.filter(pl => pl.geometry_provenance !== undefined).length} carrying provenance`)

    // A dropped point is the same kind of row (8.5).
    const dropped = await api(A, '/api/places', {
      name: `${PREFIX}dropped`, kind: 'stack',
      geometry: { type: 'Polygon', coordinates: [rect().map(p => [p.lng, p.lat])] },
      capture: { source: 'dropped', accuracyM: 3.2, track: [{ t: 1, lat: LAT, lng: LNG, a: 3.2 }] },
    })
    const dropId = String(((dropped.json.place ?? {}) as { id?: string }).id ?? '')
    const { data: dprov } = await admin.from('places').select('kind, geometry, geometry_provenance').eq('id', dropId).maybeSingle()
    const d = dprov as { kind: string; geometry: unknown; geometry_provenance: Record<string, unknown> } | null
    record('user A (owner)', '8.5: a dropped point is the same kind of row as a ride — a polygon, with its accuracy recorded',
      dropped.status === 201 && !!d?.geometry && d?.geometry_provenance?.source === 'dropped' && d?.geometry_provenance?.accuracy_m === 3.2 && d?.kind === 'stack',
      `${dropped.status} · source ${String(d?.geometry_provenance?.source)} · ±${String(d?.geometry_provenance?.accuracy_m)} m · kind ${String(d?.kind)}`)

    // A capture cannot plant a place on another ranch by naming one. Block 7A
    // TIGHTENED this: the old form only asserted that the child landed on A
    // (it did — with B's place as its parent, which is the gap). The parent
    // must be REFUSED, in the same words as a parent that does not exist, and
    // no row may land at all.
    const crossParent = await api(A, '/api/places', {
      name: `${PREFIX}crossparent`, kind: 'field', parent_id: b.placeId,
      geometry: { type: 'Polygon', coordinates: [rect().map(p => [p.lng, p.lat])] },
      capture: { source: 'ridden', track: [] },
    })
    const cpId = String(((crossParent.json.place ?? {}) as { id?: string }).id ?? '')
    const { count: cpRows } = await admin.from('places').select('id', { count: 'exact', head: true }).eq('name', `${PREFIX}crossparent`)
    record('user A (owner)', '7A: naming ranch B\'s place as a parent is refused — 400, "no such place", no row lands anywhere',
      crossParent.status === 400 && cpId === '' && (cpRows ?? 0) === 0 && /No such place to sit inside/.test(String(crossParent.json.error)),
      `${crossParent.status} · "${String(crossParent.json.error).slice(0, 50)}" · rows ${cpRows ?? 0}`)
  }

  // ── Block 7A — the hierarchy: the kind table, loops, and 068's guard ────────
  {
    const idOf = (r: { json: Record<string, unknown> }) => String(((r.json.place ?? {}) as { id?: string }).id ?? '')
    const mk = (name: string, kind: string, parent_id?: string | null) =>
      api(A, '/api/places', { name: `${PREFIX}${name}`, kind, ...(parent_id ? { parent_id } : {}) })

    // pasture → field → stack, each accepted with its parent, and the answer
    // names the parent and counts what is in it.
    const pasture = await mk('7a-pasture', 'pasture'); const pastureId = idOf(pasture)
    const field = await mk('7a-field', 'field', pastureId); const fieldId = idOf(field)
    const stack = await mk('7a-stack', 'stack', fieldId); const stackId = idOf(stack)
    const { data: chain } = await admin.from('places').select('id, parent_id').in('id', [pastureId, fieldId, stackId].filter(Boolean))
    const parentOf = new Map(((chain ?? []) as { id: string; parent_id: string | null }[]).map(r => [r.id, r.parent_id]))
    const stackAnswer = (stack.json.consequence as { lines?: string[] } | undefined)?.lines?.[0] ?? ''
    record('user A (owner)', '7A: pasture → field → stack are accepted with their parents, and the answer counts what is in the parent',
      pasture.status === 201 && field.status === 201 && stack.status === 201
        && parentOf.get(fieldId) === pastureId && parentOf.get(stackId) === fieldId
        && (stack.json.parent as { id?: string } | null)?.id === fieldId && /1 place in .*7a-field now/.test(stackAnswer),
      `${pasture.status}/${field.status}/${stack.status} · field→${parentOf.get(fieldId) === pastureId ? 'pasture' : '?'} · stack→${parentOf.get(stackId) === fieldId ? 'field' : '?'} · "${stackAnswer}"`)

    // Nonsense: a pasture inside a stack. Refused with the rule, no row.
    const nonsense = await mk('7a-nonsense', 'pasture', stackId)
    const { count: nonsenseRows } = await admin.from('places').select('id', { count: 'exact', head: true }).eq('name', `${PREFIX}7a-nonsense`)
    record('user A (owner)', '7A: a pasture inside a stack is refused with the rule, and no row lands',
      nonsense.status === 400 && /never inside another place/.test(String(nonsense.json.error)) && (nonsenseRows ?? 0) === 0,
      `${nonsense.status} · "${String(nonsense.json.error).slice(0, 60)}" · rows ${nonsenseRows ?? 0}`)

    // A kind change the children forbid: the field holds a stack, so it cannot
    // become a stack; it CAN become a stackyard (a stack sits in one).
    const toStack = await api(A, `/api/places/${fieldId}`, { kind: 'stack' }, 'PATCH')
    const toYard = await api(A, `/api/places/${fieldId}`, { kind: 'stackyard' }, 'PATCH')
    const { data: fieldNow } = await admin.from('places').select('kind').eq('id', fieldId).maybeSingle()
    record('user A (owner)', '7A: a kind change is judged against what is inside — field-with-a-stack cannot become a stack, can become a stackyard',
      toStack.status === 400 && /cannot sit inside a stack/.test(String(toStack.json.error)) && toYard.status === 200 && (fieldNow as { kind?: string } | null)?.kind === 'stackyard',
      `→stack ${toStack.status} "${String(toStack.json.error).slice(0, 50)}" · →stackyard ${toYard.status} · kind now ${String((fieldNow as { kind?: string } | null)?.kind)}`)

    // The route's own loop walk cannot be reached through the kind table (a
    // loop needs a kind that can hold its own ancestor, and the table is
    // strictly ordered), so the loop guard that matters is 068's, at the
    // database, against a direct write. Probed by capability: on a database
    // without 068 the write LANDS, which is reported as the migration missing
    // and put back — never as a pass.
    const loop = await A.from('places').update({ parent_id: stackId }).eq('id', pastureId).select('id, parent_id')
    const loopLanded = !loop.error && (loop.data ?? []).length > 0 && (loop.data as { parent_id: string | null }[])[0].parent_id === stackId
    if (loopLanded) {
      await admin.from('places').update({ parent_id: null }).eq('id', pastureId)
      record('(skipped)', '7A/068: a loop written straight to the table is refused — migration 068 not applied', true, 'the loop landed and was put back')
    } else {
      record('user A (owner)', '7A/068: a loop written straight to the table is refused by the guard',
        !!loop.error && /inside one of its own places/.test(loop.error.message), `${loop.error ? loop.error.message.slice(0, 60) : 'no error'}`)
    }

    // 068 from the other side: a direct insert naming B's place as parent.
    // Under RLS the parent is invisible; the guard says "no such place" and
    // the row never lands. Same capability probe.
    const direct = await A.from('places').insert({ user_id: a.userId, ranch_id: a.ranchId, name: `${PREFIX}7a-direct-cross`, kind: 'field', parent_id: b.placeId }).select('id')
    const directLanded = !direct.error && (direct.data ?? []).length > 0
    if (directLanded) {
      await admin.from('places').delete().eq('name', `${PREFIX}7a-direct-cross`)
      record('(skipped)', '7A/068: a cross-ranch parent written straight to the table is refused — migration 068 not applied', true, 'the row landed and was removed')
    } else {
      record('user A (owner)', '7A/068: a cross-ranch parent written straight to the table is refused by the guard, in words that confirm nothing',
        !!direct.error && /No such place to sit inside/.test(direct.error.message), `${direct.error ? direct.error.message.slice(0, 60) : 'no error'}`)
    }

    // A replayed client id — a retry after a save that landed but timed out on
    // the way back — is answered 200 with the same row, and there is one row.
    const cid = randomUUID()
    const first = await api(A, '/api/places', { id: cid, name: `${PREFIX}7a-replay`, kind: 'stack', parent_id: fieldId })
    const again = await api(A, '/api/places', { id: cid, name: `${PREFIX}7a-replay`, kind: 'stack', parent_id: fieldId })
    const { count: replayRows } = await admin.from('places').select('id', { count: 'exact', head: true }).eq('name', `${PREFIX}7a-replay`)
    record('user A (owner)', '7A: a replayed client id is answered 200 · duplicate, with the row that landed, and there is one row',
      first.status === 201 && idOf(first) === cid && again.status === 200 && again.json.duplicate === true && idOf(again) === cid && replayRows === 1,
      `${first.status} then ${again.status} duplicate=${String(again.json.duplicate)} · rows ${replayRows}`)

    // The client id is never accepted from B's ranch onto A's place: B posting
    // A's id is a fresh insert on B's ranch that collides on the primary key
    // and is answered with… nothing of A's. RLS makes the re-read see no row,
    // so B gets a 500 and never A's place.
    const Bc = await userClient('B')
    const steal = await api(Bc, '/api/places', { id: cid, name: `${PREFIX}7a-steal`, kind: 'stack' })
    record('user B (other ranch)', '7A: replaying another ranch\'s client id never returns their place',
      steal.status !== 200 && steal.status !== 201 && idOf(steal) === '', `${steal.status} · place ${idOf(steal) || 'none'}`)
  }

  // ── Block 7D.3 / 13 — delete means the trash, referenced or not ──
  {
    // A place nothing points at: gone.
    const made = await api(A, '/api/places', { name: `${PREFIX}deletable`, kind: 'field' })
    const freeId = String(((made.json.place ?? {}) as { id?: string }).id ?? '')
    const gone = await api(A, `/api/places/${freeId}`, undefined, 'DELETE')
    const { data: trashedPlace } = await admin.from('places').select('deleted_at').eq('id', freeId).maybeSingle()
    const { data: livePlace } = await admin.from('places').select('id').eq('id', freeId).is('deleted_at', null)
    const placeTrash = await api(A, '/api/trash', null, 'GET')
    const placeListed = ((placeTrash.json.items ?? []) as { id: string }[]).some(i => i.id === freeId)
    record('user A (owner)', '7D.3/12.4: an unreferenced place DELETEs to the trash — row kept with deleted_at, out of every live read, listed in the trash', gone.status === 200 && gone.json.deleted === true && !!(trashedPlace as { deleted_at?: string | null } | null)?.deleted_at && (livePlace ?? []).length === 0 && placeListed, `${gone.status} · deleted_at ${(trashedPlace as { deleted_at?: string | null } | null)?.deleted_at ? 'set' : 'NULL'} · live reads ${(livePlace ?? []).length} · in trash ${placeListed}`)

    // Block 13: a place the ranch's own entries name goes to the trash like any
    // other — no refusal, no count, no cascade. NEVER ORPHAN AN EVENT: every
    // entry keeps its place_id, nothing else is touched, and putting the place
    // back leaves every one of them pointing where it always did.
    const { count: namedBefore } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('payload->>place_id', a.placeId).is('deleted_at', null)
    const ref = await api(A, `/api/places/${a.placeId}`, undefined, 'DELETE')
    const stillThere = await readPlace(a.placeId)
    const { data: trashedRef } = await admin.from('places').select('deleted_at').eq('id', a.placeId).maybeSingle()
    const { count: namedAfter } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('payload->>place_id', a.placeId).is('deleted_at', null)
    const back = await api(A, '/api/trash', { table: 'places', id: a.placeId })
    const { data: restoredRef } = await admin.from('places').select('deleted_at').eq('id', a.placeId).maybeSingle()
    record('user A (owner)', '13: a referenced place goes to the trash — 200, row kept, every entry still names it — and comes back from the trash with them all still attached',
      ref.status === 200 && ref.json.trashed === true && stillThere !== null && !!(trashedRef as { deleted_at?: string | null } | null)?.deleted_at
        && (namedBefore ?? 0) > 0 && namedAfter === namedBefore && back.status === 200 && (restoredRef as { deleted_at?: string | null } | null)?.deleted_at === null,
      `${ref.status} trashed=${String(ref.json.trashed)} · entries naming it ${namedBefore ?? 0} → ${namedAfter ?? 0} · put back ${back.status}`)

    // The count is the CALLER's ranch only. B's entries against B's place must
    // never be counted for A, and A must not be told anything about them.
    const bRef = await api(A, `/api/places/${b.placeId}`, undefined, 'DELETE')
    record('user A (owner)', '7D.3/13: a cross-ranch delete says 404 and nothing else', bRef.status === 404 && bRef.json.refs === undefined && bRef.json.message === undefined, `${bRef.status} · refs ${bRef.json.refs === undefined ? 'absent' : 'LEAKED'}`)
  }

  // ── Block 7D.1/7D.2 — deleting an entry, and the deletion record ─────────────
  {
    const probe = await admin.from('events').select('deleted_at').limit(1)
    if (probe.error) {
      record('(skipped)', '7D delete checks — migration 061 not applied', true, probe.error.message.slice(0, 70))
    } else {
      // A's own fresh entry, unseen by B: hard delete, no row left.
      //
      // Inserted with the SERVICE ROLE, not through /api/log. That route uses
      // the cookie-only createClient(), so this suite's Bearer token cannot
      // reach it — the standing two-auth-patterns rule. Going through it here
      // produced an empty id and a 405 on a malformed URL, which read as "the
      // delete route is missing" when the route was fine. The subject of these
      // checks is the DELETE route's isolation, so the fixture is made
      // directly and precisely: A's user, A's ranch, landed just now.
      const mk = async (inches: number) => {
        const { data } = await admin.from('events').insert({
          user_id: a.userId, ranch_id: a.ranchId, type: 'rain', ts: new Date().toISOString(),
          payload: { source: 'manual', schema_version: 1, place_id: a.placeId, inches },
        }).select('id').single()
        return String((data as { id?: string } | null)?.id ?? '')
      }
      const ownId = await mk(0.11)
      const plan = await api(A, `/api/activity/${ownId}/delete`, undefined, 'GET')
      const mode = ((plan.json.plan ?? {}) as { mode?: string }).mode
      const killed = await api(A, `/api/activity/${ownId}/delete`, undefined, 'DELETE')
      const { data: goneRow } = await admin.from('events').select('id, deleted_at').eq('id', ownId).maybeSingle()
      const liveView = await A.from('events').select('id').eq('id', ownId).is('deleted_at', null)
      record('user A (owner)', '7D.1/12.4: my own unseen entry deletes by the hard path — no record note — and the row waits in the trash, out of every live read', !!ownId && mode === 'hard' && killed.status === 200 && killed.json.mode === 'hard' && !!(goneRow as { deleted_at?: string | null } | null)?.deleted_at && (liveView.data ?? []).length === 0, `${ownId ? `plan ${mode} · ${killed.status} · deleted_at ${(goneRow as { deleted_at?: string | null } | null)?.deleted_at ? 'set' : 'NULL'} · live reads ${(liveView.data ?? []).length}` : 'FIXTURE NOT CREATED — the check proved nothing'}`)

      // A cross-ranch delete reaches nothing and says nothing about the row.
      const { data: bEvent } = await admin.from('events').select('id').eq('ranch_id', b.ranchId).is('deleted_at', null).limit(1).maybeSingle()
      const bId = (bEvent as { id?: string } | null)?.id ?? ''
      if (bId) {
        const cross = await api(A, `/api/activity/${bId}/delete`, undefined, 'DELETE')
        const crossPlan = await api(A, `/api/activity/${bId}/delete`, undefined, 'GET')
        const { data: survived } = await admin.from('events').select('id, deleted_at').eq('id', bId).maybeSingle()
        const row = survived as { deleted_at: string | null } | null
        record('user A (owner)', '7D: a delete can never touch another ranch\'s row — 404, row untouched, nothing about it disclosed', cross.status === 404 && crossPlan.status === 404 && row !== null && row.deleted_at === null && crossPlan.json.plan === undefined, `${cross.status}/${crossPlan.status} · deleted_at ${row?.deleted_at ?? 'null'} · plan ${crossPlan.json.plan === undefined ? 'absent' : 'LEAKED'}`)
      }

      // The deletion record itself is ranch-scoped: A deletes one of its own
      // and B can read nothing about it — not the row, not who deleted it.
      const mineId = await mk(0.22)
      await api(A, `/api/activity/${mineId}/delete`, undefined, 'DELETE')
      const Bc = await userClient('B')
      const bSees = await Bc.from('events').select('id, deleted_at, deleted_by').eq('id', mineId)
      record('user B (other ranch)', '7D.2: a deletion record is invisible across ranches — no row, no who, no when', (bSees.data ?? []).length === 0, `${(bSees.data ?? []).length} row(s) visible to B`)
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
// A Ctrl-C or a kill mid-run still tears the fixture down (a hard kill cannot be
// caught; scripts/teardown-fixtures.ts sweeps whatever a hard kill leaves).
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { try { await teardown(`on ${sig}`) } catch {} ; process.exit(130) })

async function main() {
  console.log(`\nDryline — two-ranch isolation test  (db ${URL_}, ingest ${BASE})\n`)
  // IDENTITY FIRST. Every route check below is meaningless if BASE is answering
  // with Vercel's protection page instead of the app: that reads as dozens of
  // 401 "isolation failures" that never reached a route. Say it once, and stop.
  {
    const res = await fetch(`${BASE}/signin`, { headers: process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {} }).catch(() => null)
    const body = res ? await res.text().catch(() => '') : ''
    if (!res || res.status !== 200 || !/Dryline/i.test(body)) {
      console.error(`rls-test: ${BASE} is not serving the app (${res ? `HTTP ${res.status}` : 'no answer'})${BASE.includes('vercel.app') && !process.env.VERCEL_BYPASS ? ' — VERCEL_BYPASS is missing from e2e/.env.e2e' : ''}. Nothing was checked — this is NOT a pass.  —  ${suiteIdentity()}`)
      process.exit(2)
    }
  }
  await teardown('pre-run residue')
  try {
    fx.A = await seed('A')
    fx.B = await seed('B')
    console.log(`seeded: ranch A ${fx.A.ranchId}  ranch B ${fx.B.ranchId}\n`)

    await isolationChecks('A', await userClient('A'))
    await isolationChecks('B', await userClient('B'))
    await anonymousChecks()
    await logRouteChecks()      // Block 7E — /api/log; BEFORE invitations, while C is still ranchless
    await ingestChecks()
    await invitationChecks()    // Phase A2 — needs migration 049 and the routes on BASE
    await setupChecks()         // Block 31 — create_ranch, the one door; needs 075 (named RED without it)
    await lotsChecks()          // Block 4A — needs migration 050
    await activityChecks()      // Block 5A — the record's routes, ranch-scoped in the route
    await correctionChecks()    // Block 5B — needs migration 054 (skips without it)
    await placesChecks()        // Places slice 1 — needs migration 056 (route checks skip without it)
    await turnoutChecks()       // Block 9 — /api/ranch/turnout, an events row inheriting 043
    await groupActionChecks()   // Block 10 — the group action; needs 063 (skips without it)
    await countChecks()          // Block 14 — counts and bunches; needs 069 (skips without it)
    await trashChecks()         // Block 12 — the trash; needs 065 (skips without it)
    await placeProjectionChecks()   // Block 25b — a bunch's place cannot be steered across ranches; needs 072 (skips, named, without it)
    await projectionChecks()    // Block 12 — the head-count projection cannot be steered across ranches; needs 066 (skips without it); RED until 067
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
  console.log(`\n${results.length - fails} PASS · ${fails} FAIL${fails ? '  — BLOCKED' : ''}  —  ${suiteIdentity()}\n`)
  process.exit(fails ? 1 : 0)
}

main().catch(async err => {
  console.error('\nrls-test crashed:', err instanceof Error ? err.message : err)
  try { await teardown('after crash') } catch (e) { console.error('teardown failed:', e) }
  process.exit(2)
})
