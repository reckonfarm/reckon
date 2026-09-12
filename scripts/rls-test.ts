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

import { guardWorktree } from './lib/suite-guard'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { validateRing, polygonAreaAcres, storableAcres } from '../lib/places/geo'
import { buildProgramAlerts } from '../lib/program-alerts'

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
}
type Side = 'A' | 'B'
type Who = Side | 'C' | 'D'
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
    .filter(u => u.email === USERS.A.email || u.email === USERS.B.email || u.email === USERS.C.email || u.email === USERS.D.email)
    .map(u => u.id)
  let n = 0
  if (ids.length) {
    n += (await admin.from('events').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('devices').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('places').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('ranch_members').delete().in('user_id', ids).select('user_id')).data?.length ?? 0
    n += (await admin.from('operation_profiles').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('herd_lots').delete().in('created_by', ids).select('id')).data?.length ?? 0
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
    const gone = await api(A, `/api/herd/lots/${lot2?.id ?? ''}`, {}, 'DELETE')
    const live = (await lotsOf(A, a.ranchId)).lots ?? []
    const { data: retired } = await admin.from('herd_lots').select('retired_at').eq('id', lot2?.id ?? '').maybeSingle()
    record('user A (owner)', 'retires a lot: gone from the live list, row kept with retired_at', gone.status === 200 && live.length === 1 && !!retired?.retired_at, `${gone.status} · live ${live.length} · retired_at ${retired?.retired_at ? 'set' : 'NULL'}`)
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
    record('user A (owner)', 'a retired place refuses every edit but the way back', blocked.status === 404 && /retired while you had it open/.test(String(blocked.json.error)), `${blocked.status} · ${String(blocked.json.error).slice(0, 40)}`)
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

  // ── Block 7D.3 — delete means delete, and a referenced place is not deleted ──
  {
    // A place nothing points at: gone.
    const made = await api(A, '/api/places', { name: `${PREFIX}deletable`, kind: 'field' })
    const freeId = String(((made.json.place ?? {}) as { id?: string }).id ?? '')
    const gone = await api(A, `/api/places/${freeId}`, undefined, 'DELETE')
    const after = freeId ? await readPlace(freeId) : null
    record('user A (owner)', '7D.3: an unreferenced place DELETEs outright — the row is gone', gone.status === 200 && gone.json.deleted === true && after === null, `${gone.status} · row ${after === null ? 'gone' : 'STILL THERE'}`)

    // A place the ranch's own entries name: refused, counted, untouched.
    const ref = await api(A, `/api/places/${a.placeId}`, undefined, 'DELETE')
    const stillThere = await readPlace(a.placeId)
    const refs = (ref.json.refs ?? {}) as { entries?: number; total?: number }
    record('user A (owner)', '7D.3: a referenced place is NOT deleted — 409, counted, row untouched', ref.status === 409 && (refs.total ?? 0) > 0 && stillThere !== null, `${ref.status} · ${String(ref.json.message ?? '').slice(0, 60)}`)

    // The count is the CALLER's ranch only. B's entries against B's place must
    // never be counted for A, and A must not be told anything about them.
    const bRef = await api(A, `/api/places/${b.placeId}`, undefined, 'DELETE')
    record('user A (owner)', '7D.3: a cross-ranch delete says 404 and leaks no reference count', bRef.status === 404 && bRef.json.refs === undefined && bRef.json.message === undefined, `${bRef.status} · refs ${bRef.json.refs === undefined ? 'absent' : 'LEAKED'}`)
  }

  // ── Block 7D.1/7D.2 — deleting an entry, and the deletion record ─────────────
  {
    const probe = await admin.from('events').select('deleted_at').limit(1)
    if (probe.error) {
      record('(skipped)', '7D delete checks — migration 061 not applied', true, probe.error.message.slice(0, 70))
    } else {
      // A's own fresh entry, unseen by B: hard delete, no row left.
      const own = await api(A, '/api/log', { type: 'rain', inches: 0.11, place_id: a.placeId })
      const ownId = String(((own.json.event ?? {}) as { id?: string }).id ?? '')
      const plan = await api(A, `/api/activity/${ownId}/delete`, undefined, 'GET')
      const mode = ((plan.json.plan ?? {}) as { mode?: string }).mode
      const killed = await api(A, `/api/activity/${ownId}/delete`, undefined, 'DELETE')
      const { data: goneRow } = await admin.from('events').select('id').eq('id', ownId).maybeSingle()
      record('user A (owner)', '7D.1: my own unseen entry hard-deletes — the row is gone, no tombstone', mode === 'hard' && killed.status === 200 && killed.json.mode === 'hard' && goneRow === null, `plan ${mode} · ${killed.status} · row ${goneRow === null ? 'gone' : 'STILL THERE'}`)

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
      const mine = await api(A, '/api/log', { type: 'rain', inches: 0.22, place_id: a.placeId })
      const mineId = String(((mine.json.event ?? {}) as { id?: string }).id ?? '')
      await admin.from('events').update({ superseded_by: null }).eq('id', mineId)   // no-op; keeps the row plain
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
  await teardown('pre-run residue')
  try {
    fx.A = await seed('A')
    fx.B = await seed('B')
    console.log(`seeded: ranch A ${fx.A.ranchId}  ranch B ${fx.B.ranchId}\n`)

    await isolationChecks('A', await userClient('A'))
    await isolationChecks('B', await userClient('B'))
    await anonymousChecks()
    await ingestChecks()
    await invitationChecks()    // Phase A2 — needs migration 049 and the routes on BASE
    await lotsChecks()          // Block 4A — needs migration 050
    await activityChecks()      // Block 5A — the record's routes, ranch-scoped in the route
    await correctionChecks()    // Block 5B — needs migration 054 (skips without it)
    await placesChecks()        // Places slice 1 — needs migration 056 (route checks skip without it)
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
