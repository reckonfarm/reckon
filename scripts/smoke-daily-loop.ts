// ─── Daily-loop smoke (Block 2) — the invariant smoke + the 2A save-state proof ─
//
// Runs against a deployed build (preview or prod) as a SYNTHETIC MEMBER: the
// service role creates smoke-daily-loop@dryline.farm, its own SMOKE-* ranch,
// membership, a place, and a home county, so every write lands in a ranch
// nobody else can see (the scratch account has no membership since Block 1
// and cannot write). Teardown before and after removes everything SMOKE-*.
//
//   npx tsx scripts/smoke-daily-loop.ts                       # BASE=https://www.dryline.farm
//   BASE=https://<preview>.vercel.app VERCEL_BYPASS=… npx tsx scripts/smoke-daily-loop.ts
//
// Checks (PASS/FAIL table, exit 1 on any FAIL):
//   invariant — signed in; /home lands on the home county with the Today
//   stack; /dashboard renders for 30069 and 30027; county search responds;
//   a feed event saves through the Log it sheet.
//   2A — the four states show in order (Saved on this phone → Waiting to
//   sync → Synced to ranch); exactly one row, under the client-minted id;
//   airplane mode: saved on the phone, waits, syncs on reconnect; a replay
//   of the same body is answered duplicate with no second row; force-quit
//   mid-save (page killed while offline) → reopened → exactly one row;
//   double-tap Save → one row; a half-typed sheet survives a reload.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium, type Page, type BrowserContext } from '@playwright/test'

function loadEnv() {
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

const BASE = process.env.BASE ?? 'https://www.dryline.farm'
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!URL_ || !SERVICE) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
const BYPASS = BASE.includes('vercel.app') ? process.env.VERCEL_BYPASS : undefined

const EMAIL = 'smoke-daily-loop@dryline.farm'
const PREFIX = 'SMOKE-DAILY-LOOP'
const HOME_FIPS = '30069'

const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
const results: { check: string; pass: boolean; detail: string }[] = []
const record = (check: string, pass: boolean, detail = '') => { results.push({ check, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${check}${detail ? ` — ${detail}` : ''}`) }

let userId = ''
let ranchId = ''

async function teardown(label: string) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const ids = (users?.users ?? []).filter(u => u.email === EMAIL).map(u => u.id)
  let n = 0
  if (ids.length) {
    n += (await admin.from('events').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('devices').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('places').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('operation_profiles').delete().in('user_id', ids).select('user_id')).data?.length ?? 0
    n += (await admin.from('ranch_members').delete().in('user_id', ids).select('user_id')).data?.length ?? 0
  }
  n += (await admin.from('ranches').delete().like('name', `${PREFIX}%`).select('id')).data?.length ?? 0
  for (const id of ids) { await admin.auth.admin.deleteUser(id); n++ }
  console.log(`teardown (${label}): removed ${n}`)
}

async function seed() {
  const { data: created, error } = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true, user_metadata: { smoke: true } })
  if (error || !created.user) throw new Error(`createUser: ${error?.message}`)
  userId = created.user.id
  const { data: ranch, error: rErr } = await admin.from('ranches').insert({ name: `${PREFIX} ranch` }).select('id').single()
  if (rErr) throw new Error(`ranch: ${rErr.message}`)
  ranchId = ranch.id as string
  const { error: mErr } = await admin.from('ranch_members').insert({ ranch_id: ranchId, user_id: userId, role: 'owner' })
  if (mErr) throw new Error(`member: ${mErr.message}`)
  const { error: pErr } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} West stack`, kind: 'stackyard' })
  if (pErr) throw new Error(`place: ${pErr.message}`)
  const { error: oErr } = await admin.from('operation_profiles').insert({ user_id: userId, county_fips: HOME_FIPS })
  if (oErr) throw new Error(`operation_profile: ${oErr.message}`)
}

async function signIn(ctx: BrowserContext): Promise<Page> {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  const tokenHash = link.data?.properties?.hashed_token
  if (!tokenHash) throw new Error(`generateLink: ${link.error?.message}`)
  const page = await ctx.newPage()
  page.on('dialog', d => void d.accept())
  await page.goto(`/auth/callback?token_hash=${tokenHash}&type=magiclink&next=/dashboard`)
  await page.waitForURL(u => u.pathname.startsWith('/dashboard') && !u.searchParams.has('token_hash'), { timeout: 60_000 })
  return page
}

// Watch the SaveStatus strip and collect the distinct sequence of state
// labels it shows, until `until` appears or the time runs out.
const STATES = ['Saved on this phone', 'Waiting to sync', 'Synced to ranch', "Couldn't save — try again"]
async function watchStates(page: Page, until: string, timeoutMs: number): Promise<string[]> {
  const seen: string[] = []
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const text = await page.locator('[role="status"]').first().innerText().catch(() => '')
    const s = STATES.find(x => text.includes(x))
    if (s && seen[seen.length - 1] !== s) seen.push(s)
    if (s === until) break
    await page.waitForTimeout(50)
  }
  return seen
}

async function logFeed(page: Page, bales: number, opts: { doubleTap?: boolean } = {}) {
  await page.getByRole('button', { name: /^Log it/ }).click()
  await page.getByRole('button', { name: /Hay fed/ }).click()
  await page.getByLabel('Bales').fill(String(bales))
  const save = page.getByRole('button', { name: 'Save', exact: true })
  if (opts.doubleTap) { await Promise.all([save.click(), save.click({ force: true }).catch(() => {})]) }
  else await save.click()
}

async function outbox(page: Page): Promise<{ id: string; state: string; body: Record<string, unknown> }[]> {
  return page.evaluate(() => { try { return JSON.parse(localStorage.getItem('dryline_outbox_v1') ?? '[]') } catch { return [] } })
}

async function rowsFor(id: string): Promise<number> {
  const { count } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('id', id)
  return count ?? 0
}
async function feedRows(): Promise<number> {
  const { count } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('type', 'hay_fed')
  return count ?? 0
}

async function main() {
  console.log(`\nDryline — daily-loop smoke  (${BASE})\n`)
  await teardown('pre-run')
  await seed()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    baseURL: BASE,
    extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {},
  })
  try {
    let page = await signIn(ctx)
    record('signed in', page.url().includes('/dashboard'), page.url().replace(BASE, ''))

    // ── invariant ──
    await page.goto('/home', { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    const homeUrl = page.url().replace(BASE, '')
    const hasLogIt = await page.getByRole('button', { name: /^Log it/ }).count() > 0
    record('/home renders the home county Today stack', homeUrl.includes(`fips=${HOME_FIPS}`) && hasLogIt, `${homeUrl} · Log it button: ${hasLogIt}`)
    for (const fips of ['30069', '30027']) {
      await page.goto(`/dashboard?fips=${fips}`, { waitUntil: 'domcontentloaded' })
      const h1 = await page.locator('h1').first().innerText().catch(() => '')
      record(`/dashboard?fips=${fips} renders`, /County/.test(h1), h1.slice(0, 40))
    }
    const t = Date.now()
    const r = await page.request.get('/api/counties?search=Fergus')
    const j = await r.json().catch(() => null)
    record('county search responds', r.status() === 200 && Array.isArray(j) && j.length > 0, `${r.status()} ${Date.now() - t} ms`)

    // ── 2A: online save, four states in order, one row under the client id ──
    await page.goto(`/dashboard?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
    await logFeed(page, 4)
    const seq1 = await watchStates(page, 'Synced to ranch', 20_000)
    record('online save shows Saved → Waiting → Synced in order', JSON.stringify(seq1) === JSON.stringify(['Saved on this phone', 'Waiting to sync', 'Synced to ranch']), seq1.join(' → '))
    const ob1 = await outbox(page)
    const id1 = ob1.find(i => (i.body as { bales?: number }).bales === 4)?.id ?? ''
    record('exactly one row under the client-minted id', !!id1 && (await rowsFor(id1)) === 1 && (await feedRows()) === 1, `id ${id1.slice(0, 8)}… rows=${id1 ? await rowsFor(id1) : '-'} feeds=${await feedRows()}`)

    // ── replay the same body → duplicate, no second row ──
    const body1 = ob1.find(i => i.id === id1)?.body
    if (body1) {
      const rep = await page.request.post('/api/log', { data: body1 })
      const rj = await rep.json().catch(() => ({}))
      record('replaying the same id is answered duplicate, no second row', rep.status() === 200 && rj.duplicate === true && (await feedRows()) === 1, `${rep.status()} duplicate=${rj.duplicate} feeds=${await feedRows()}`)
    } else record('replaying the same id is answered duplicate, no second row', false, 'outbox item not found')

    // ── airplane mode ──
    await ctx.setOffline(true)
    await logFeed(page, 3)
    const seqOff = await watchStates(page, 'Waiting to sync', 8_000)
    await page.waitForTimeout(1500)
    const stillWaiting = (await page.locator('[role="status"]').first().innerText().catch(() => '')).includes('Waiting to sync')
    record('offline save: Saved on this phone → Waiting to sync, and stays', seqOff[0] === 'Saved on this phone' && stillWaiting, seqOff.join(' → '))
    await ctx.setOffline(false)
    const seqOn = await watchStates(page, 'Synced to ranch', 45_000)
    const ob2 = await outbox(page)
    const id2 = ob2.find(i => (i.body as { bales?: number }).bales === 3)?.id ?? ''
    record('reconnect → Synced to ranch, exactly one row', seqOn.includes('Synced to ranch') && !!id2 && (await rowsFor(id2)) === 1 && (await feedRows()) === 2, `${seqOn.join(' → ')} feeds=${await feedRows()}`)

    // ── force-quit mid-save: kill the page while offline, reopen ──
    await ctx.setOffline(true)
    await logFeed(page, 5)
    await watchStates(page, 'Waiting to sync', 8_000)
    const ob3 = await outbox(page)
    const id3 = ob3.find(i => (i.body as { bales?: number }).bales === 5)?.id ?? ''
    await page.close()                               // the "force quit"
    await ctx.setOffline(false)
    page = await ctx.newPage()
    page.on('dialog', d => void d.accept())
    await page.goto(`/dashboard?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
    const seqFq = await watchStates(page, 'Synced to ranch', 45_000)
    record('force-quit mid-save → reopen → exactly one row', !!id3 && seqFq.includes('Synced to ranch') && (await rowsFor(id3)) === 1 && (await feedRows()) === 3, `${seqFq.join(' → ')} feeds=${await feedRows()}`)

    // ── double-tap Save → one row ──
    const before = await feedRows()
    await logFeed(page, 6, { doubleTap: true })
    await watchStates(page, 'Synced to ranch', 20_000)
    await page.waitForTimeout(1000)
    record('double-tap Save → one row', (await feedRows()) === before + 1, `feeds ${before} → ${await feedRows()}`)

    // ── half-typed sheet survives a reload ──
    await page.getByRole('button', { name: /^Log it/ }).click()
    await page.getByRole('button', { name: /Hay fed/ }).click()
    await page.getByLabel('Bales').fill('7')
    await page.reload({ waitUntil: 'domcontentloaded' })
    const btn = await page.getByRole('button', { name: /^Log it/ }).innerText().catch(() => '')
    await page.getByRole('button', { name: /^Log it/ }).click()
    const restored = await page.getByLabel('Bales').inputValue().catch(() => '')
    record('half-typed sheet survives a reload', /finish/.test(btn) && restored === '7', `button "${btn}" · bales "${restored}"`)
    await page.getByRole('button', { name: 'Cancel' }).click()

    // ── no page errors / 5xx during the run is not tracked here; the invariant smoke covers it ──
  } finally {
    await browser.close()
    await teardown('finish')
  }
  const fails = results.filter(r => !r.pass).length
  console.log(`\n${results.length - fails} PASS · ${fails} FAIL${fails ? '  — BLOCKED' : ''}\n`)
  process.exit(fails ? 1 : 0)
}

main().catch(async err => {
  console.error('\nsmoke crashed:', err instanceof Error ? err.message : err)
  try { await teardown('after crash') } catch (e) { console.error('teardown failed:', e) }
  process.exit(2)
})
