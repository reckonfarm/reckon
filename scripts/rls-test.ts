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

import { createHash, randomBytes, randomUUID } from 'node:crypto'
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
async function api(c: SupabaseClient, path: string, body: unknown, method: 'POST' | 'PATCH' | 'DELETE' = 'POST'): Promise<{ status: number; json: Record<string, unknown> }> {
  const { data: { session } } = await c.auth.getSession()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}`, ...(process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {}) },
    body: JSON.stringify(body),
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
