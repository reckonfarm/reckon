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
const EMAIL_B = 'smoke-daily-loop-b@dryline.farm'
const PREFIX = 'SMOKE-DAILY-LOOP'
const HOME_FIPS = '30069'

const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
const results: { check: string; pass: boolean; detail: string; skip?: boolean }[] = []
const record = (check: string, pass: boolean, detail = '') => { results.push({ check, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${check}${detail ? ` — ${detail}` : ''}`) }
const skip = (check: string, detail: string) => { results.push({ check, pass: true, detail, skip: true }); console.log(`SKIP  ${check} — ${detail}`) }

let userId = ''
let userIdB = ''
let ranchId = ''
let placeId = ''

async function teardown(label: string) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const ids = (users?.users ?? []).filter(u => u.email === EMAIL || u.email === EMAIL_B).map(u => u.id)
  let n = 0
  if (ids.length) {
    n += (await admin.from('events').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('devices').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('places').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('operation_profiles').delete().in('user_id', ids).select('user_id')).data?.length ?? 0
    n += (await admin.from('profiles').delete().in('id', ids).select('id')).data?.length ?? 0
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
  const { data: placeRow, error: pErr } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} West stack`, kind: 'stackyard' }).select('id').single()
  if (pErr) throw new Error(`place: ${pErr.message}`)
  placeId = placeRow.id as string
  // A counted baseline of 200 bales as of today, so the 2C answer can say what is left.
  const { error: bErr } = await admin.from('events').insert({
    user_id: userId, ranch_id: ranchId, device_id: null, type: 'hay_inventory', ts: new Date().toISOString(),
    payload: { source: 'manual', schema_version: 1, place_id: null, bales: 200, as_of: new Date().toISOString().slice(0, 10) }, schema_version: 1,
  })
  if (bErr) throw new Error(`baseline: ${bErr.message}`)
  // Member B on the same ranch (2E: the second person).
  const { data: b, error: uErr } = await admin.auth.admin.createUser({ email: EMAIL_B, email_confirm: true, user_metadata: { smoke: true } })
  if (uErr || !b.user) throw new Error(`createUser B: ${uErr?.message}`)
  userIdB = b.user.id
  const { error: mbErr } = await admin.from('ranch_members').insert({ ranch_id: ranchId, user_id: userIdB, role: 'member' })
  if (mbErr) throw new Error(`member B: ${mbErr.message}`)
  // B deliberately has NO home county (the November onboarding case): the ledger must still be there.
  await admin.from('profiles').upsert({ id: userIdB, email: EMAIL_B })
  const { error: oErr } = await admin.from('operation_profiles').insert({ user_id: userId, county_fips: HOME_FIPS })
  if (oErr) throw new Error(`operation_profile: ${oErr.message}`)
  // /home resolves the home county from profiles.home_county_fips (lib/concierge-service).
  const { error: hErr } = await admin.from('profiles').upsert({ id: userId, email: EMAIL, home_county_fips: HOME_FIPS, display_name: 'Smoke A' })
  if (hErr) throw new Error(`profile: ${hErr.message}`)
}

async function signIn(ctx: BrowserContext, email = EMAIL): Promise<Page> {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link.data?.properties?.hashed_token
  if (!tokenHash) throw new Error(`generateLink: ${link.error?.message}`)
  const page = await ctx.newPage()
  page.on('dialog', d => void d.accept())
  if (process.env.DEBUG_SIGNIN) {
    page.on('response', r => { if (r.request().isNavigationRequest() || /auth/.test(r.url()) || r.status() >= 400) console.log(`   ${r.status()} ${r.url().replace(BASE, '').slice(0, 110)}  set-cookie=${(r.headers()['set-cookie'] ?? '').split(';')[0].slice(0, 40)}`) })
    page.on('console', m => { if (m.type() === 'error') console.log(`   console.error ${m.text().slice(0, 140)}`) })
    page.on('pageerror', e => console.log(`   pageerror ${e.message.slice(0, 140)}`))
  }
  // The callback exchanges the token for a session cookie and hands off to
  // /dashboard client-side; on a cold preview that hand-off can be slow, so
  // give it a moment, then go there directly and check the header for the
  // signed-in email — the cookie is what matters, not the hand-off.
  await page.goto(`/auth/callback?token_hash=${tokenHash}&type=magiclink&next=/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL(u => u.pathname.startsWith('/dashboard'), { timeout: 15_000 }).catch(() => {})
  if (process.env.DEBUG_SIGNIN) {
    await page.waitForTimeout(6000)
    console.log('   after callback:', page.url().replace(BASE, ''), (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120))
    console.log('   cookies:', (await ctx.cookies()).map(c => `${c.name.slice(0, 28)}@${c.domain}${c.secure ? ' secure' : ''} ${c.sameSite}`).join(' | '))
  }
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  // The header paints "Sign in" first and swaps to the email once the browser
  // client has read the session — wait for the swap, not the first paint.
  await page.locator('header').getByText(email).waitFor({ timeout: 20_000 }).catch(async () => {
    const header = await page.locator('header').innerText().catch(() => '')
    throw new Error(`sign-in did not stick (header: ${header.replace(/\s+/g, ' ').slice(0, 120)})`)
  })
  return page
}

// Watch the SaveStatus strip and collect the distinct sequence of state
// labels it shows, until `until` appears or the time runs out.
const STATES = ['Saved on this phone', 'Waiting to sync', 'Synced to ranch', "Couldn't save — try again"]
let lastWatch: string[] = []   // raw strip texts seen by the last watch, for FAIL details
async function watchStates(page: Page, until: string, timeoutMs: number, label?: string): Promise<string[]> {
  const seen: string[] = []
  const raw: string[] = []
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const text = (await page.locator('[role="status"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    if (raw[raw.length - 1] !== text) raw.push(text)
    if (label && !text.includes(label)) { await page.waitForTimeout(50); continue }   // still showing the previous entry
    const s = STATES.find(x => text.includes(x))
    if (s && seen[seen.length - 1] !== s) seen.push(s)
    if (s === until) break
    await page.waitForTimeout(50)
  }
  lastWatch = raw
  return seen
}
const rawSeen = () => ` [strip: ${lastWatch.map(t => JSON.stringify(t.slice(0, 60))).join(' → ')}]`

async function logFeed(page: Page, bales: number, opts: { doubleTap?: boolean; place?: string } = {}) {
  await page.getByRole('button', { name: /^Log it/ }).click()
  await page.getByRole('button', { name: /Hay fed/ }).click()
  await page.getByLabel('Hay fed').fill(String(bales))
  if (opts.place) await page.getByLabel('Where').selectOption({ label: opts.place })
  const save = page.getByRole('button', { name: 'Save', exact: true })
  if (opts.doubleTap) {
    // Two clicks in the same tick, straight at the DOM — faster than a thumb.
    await save.evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click() })
  } else await save.click()
}

// innerText can throw mid-navigation (execution context destroyed) and the
// catch would read as an empty page; read until two consecutive reads agree.
async function stableText(page: Page, selector: string, timeoutMs = 10_000): Promise<string> {
  let last = ''
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const text = (await page.locator(selector).first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    if (text && text === last) return text
    last = text
    await page.waitForTimeout(250)
  }
  return last
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
    for (const [fips, county] of [['30069', 'Petroleum'], ['30027', 'Fergus']]) {
      await page.goto(`/dashboard?fips=${fips}`, { waitUntil: 'domcontentloaded' })
      const h1 = await page.locator('h1').first().innerText().catch(() => '')
      const body = await page.locator('body').innerText().catch(() => '')
      // h1 is the ranch name for a member (flow, Block 7); the county sits on the home-base line.
      record(`/dashboard?fips=${fips} renders`, h1.trim().length > 0 && body.includes(county), `h1 "${h1.slice(0, 30)}" · ${county}: ${body.includes(county)}`)
    }
    const t = Date.now()
    const r = await page.request.get('/api/counties?search=Fergus')
    const j = await r.json().catch(() => null)
    record('county search responds', r.status() === 200 && Array.isArray(j) && j.length > 0, `${r.status()} ${Date.now() - t} ms`)

    // ── 2A: online save, four states in order, one row under the client id ──
    await page.goto(`/dashboard?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
    await logFeed(page, 4)
    const seq1 = await watchStates(page, 'Synced to ranch', 20_000, 'Fed 4 bales')
    record('online save shows Saved → Waiting → Synced in order', JSON.stringify(seq1) === JSON.stringify(['Saved on this phone', 'Waiting to sync', 'Synced to ranch']), seq1.join(' → '))
    const strip1 = (await page.locator('[role="status"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    record('2C: the answer — recorded, remaining from the count, no invented runway',
      /4 bales recorded/.test(strip1) && /196 bales on hand \(from your count of 200/.test(strip1) && !/feeding day/.test(strip1), strip1.slice(0, 140))
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
    await page.waitForTimeout(2500)   // let the post-sync refresh settle
    await ctx.setOffline(true)
    await logFeed(page, 3)
    const seqOff = await watchStates(page, 'Synced to ranch', 4_000, 'Fed 3 bales')   // must NOT reach synced
    const stillLocal = (await page.locator('[role="status"]').first().innerText().catch(() => '')).includes('Saved on this phone')
    record('airplane mode: Saved on this phone, and stays there', seqOff[0] === 'Saved on this phone' && !seqOff.includes('Synced to ranch') && stillLocal, seqOff.join(' → ') + rawSeen())
    await ctx.setOffline(false)
    const seqOn = await watchStates(page, 'Synced to ranch', 45_000, 'Fed 3 bales')
    const ob2 = await outbox(page)
    const id2 = ob2.find(i => (i.body as { bales?: number }).bales === 3)?.id ?? ''
    record('reconnect → Synced to ranch, exactly one row', seqOn.includes('Synced to ranch') && !!id2 && (await rowsFor(id2)) === 1 && (await feedRows()) === 2, `${seqOn.join(' → ')} feeds=${await feedRows()}` + rawSeen())

    // ── force-quit mid-save: kill the page while offline, reopen ──
    await ctx.setOffline(true)
    await logFeed(page, 5)
    await watchStates(page, 'Saved on this phone', 8_000, 'Fed 5 bales')
    const ob3 = await outbox(page)
    const id3 = ob3.find(i => (i.body as { bales?: number }).bales === 5)?.id ?? ''
    await page.close()                               // the "force quit"
    await ctx.setOffline(false)
    page = await ctx.newPage()
    page.on('dialog', d => void d.accept())
    await page.goto(`/dashboard?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
    const seqFq = await watchStates(page, 'Synced to ranch', 45_000, 'Fed 5 bales')
    record('force-quit mid-save → reopen → exactly one row', !!id3 && seqFq.includes('Synced to ranch') && (await rowsFor(id3)) === 1 && (await feedRows()) === 3, `${seqFq.join(' → ')} feeds=${await feedRows()}`)

    // ── double-tap Save → one row ──
    const before = await feedRows()
    await logFeed(page, 6, { doubleTap: true })
    await watchStates(page, 'Synced to ranch', 20_000, 'Fed 6 bales')
    await page.waitForTimeout(1000)
    record('double-tap Save → one row', (await feedRows()) === before + 1, `feeds ${before} → ${await feedRows()}`)

    // ── half-typed sheet survives a reload ──
    await page.getByRole('button', { name: /^Log it/ }).click()
    await page.getByRole('button', { name: /Hay fed/ }).click()
    await page.getByLabel('Hay fed').fill('7')
    await page.reload({ waitUntil: 'domcontentloaded' })
    const btn = await page.getByRole('button', { name: /^Log it/ }).innerText().catch(() => '')
    await page.getByRole('button', { name: /^Log it/ }).click()
    const restored = await page.getByLabel('Hay fed').inputValue().catch(() => '')
    record('half-typed sheet survives a reload', /finish/.test(btn) && restored === '7', `button "${btn}" · bales "${restored}"`)
    await page.getByRole('button', { name: 'Cancel' }).click()

    // ── 2F: a feeding AT the place, then the place page answers ──
    const placeName = `${PREFIX} West stack`
    await logFeed(page, 2, { place: placeName })
    await watchStates(page, 'Synced to ranch', 20_000, 'Fed 2 bales')
    await page.goto('/places', { waitUntil: 'domcontentloaded' })
    const placeLink = page.locator(`main a[href="/places/${placeId}"]`)
    record('2F: /places lists the place', await placeLink.count() > 0, (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120))
    await page.goto(`/places/${placeId}`, { waitUntil: 'domcontentloaded' })
    const bodyP = await stableText(page, 'main')
    const h1p = await page.locator('h1').first().innerText().catch(() => '')
    record('2F: place page opens with its memory', h1p === placeName && /Last recorded feeding: today .*2 bales/.test(bodyP), `h1 "${h1p}" · ${(bodyP.match(/Last recorded feeding:[^·]*·[^L]{0,40}/) ?? [''])[0]}`)
    await page.getByRole('tab', { name: 'Last feeding' }).click()
    const chip = (await page.locator('[role="status"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    record('2F: "Last feeding" chip answers', /Last recorded feeding: today .*2 bales/.test(chip), chip.slice(0, 100))
    const feedHere = page.getByRole('button', { name: 'Log feed here' })
    await feedHere.click()
    // The place list loads when the sheet opens; the pre-filled value shows once its option exists.
    await page.getByLabel('Where').locator('option', { hasText: placeName }).waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
    const prefilled = await page.getByLabel('Where').inputValue().catch(() => '')
    record('2F: "Log feed here" opens the sheet with this place', prefilled === placeId, `Where=${prefilled.slice(0, 8)}…`)
    await page.getByRole('button', { name: 'Cancel' }).click()

    // ── 2B: repeat last — two taps from a cold open, undo, one row ──
    const beforeRepeat = await feedRows()
    await page.goto('/home', { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    const same = page.getByRole('button', { name: 'Same today' })
    await same.waitFor({ timeout: 20_000 }).catch(() => {})
    const cardText = (await page.getByText('Repeat last feeding').locator('xpath=ancestor::div[1]').innerText().catch(() => '')).replace(/\s+/g, ' ')
    record('2B: Repeat last feeding card shows the last feeding', await same.count() > 0 && /2 bales/.test(cardText) && cardText.includes(placeName), cardText.slice(0, 100))
    await same.click()                                                   // tap 2
    const undo = page.getByRole('button', { name: /^Undo/ })
    const sawUndo = await undo.waitFor({ timeout: 5_000 }).then(() => true).catch(() => false)
    const seqRepeat = await watchStates(page, 'Synced to ranch', 30_000, 'Fed 2 bales')
    record('2B: Same today → Saved on this phone with Undo, then Synced — one row', sawUndo && seqRepeat[0] === 'Saved on this phone' && seqRepeat.includes('Synced to ranch') && (await feedRows()) === beforeRepeat + 1, `${seqRepeat.join(' → ')} feeds ${beforeRepeat} → ${await feedRows()}`)
    // Undo within the window: nothing leaves the phone.
    const beforeUndo = await feedRows()
    await page.getByRole('button', { name: 'Same today' }).click()
    await page.getByRole('button', { name: /^Undo/ }).click()
    await page.waitForTimeout(13_000)
    record('2B: Undo inside 10 s → no row', (await feedRows()) === beforeUndo && await page.getByRole('button', { name: 'Same today' }).count() > 0, `feeds ${beforeUndo} → ${await feedRows()}`)
    await page.getByRole('button', { name: 'Change' }).click()
    const changed = await page.getByLabel('Hay fed').inputValue().catch(() => '')
    record('2B: Change opens the sheet pre-filled', changed === '2', `bales "${changed}"`)
    await page.getByRole('button', { name: 'Cancel' }).click()

    // ── a member with NO home county: /home must still put Log it in front of them, and a feeding must save ──
    const ctxB = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
    const pageB = await signIn(ctxB, EMAIL_B)
    await pageB.goto('/home', { waitUntil: 'domcontentloaded' })
    await pageB.waitForURL(/\/dashboard/, { timeout: 30_000 })
    const urlB = pageB.url().replace(BASE, '')
    const logItB = await pageB.getByRole('button', { name: /^Log it/ }).waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    record('no home county: /home lands on the ledger with Log it', !/fips=/.test(urlB) && logItB, `${urlB} · Log it: ${logItB}`)
    const beforeB = (await admin.from('events').select('id', { count: 'exact', head: true }).eq('user_id', userIdB).eq('type', 'hay_fed')).count ?? 0
    await logFeed(pageB, 1)
    const seqB = await watchStates(pageB, 'Synced to ranch', 20_000, 'Fed 1 bale')
    const afterB = (await admin.from('events').select('id', { count: 'exact', head: true }).eq('user_id', userIdB).eq('type', 'hay_fed')).count ?? 0
    record('no home county: a feed event saves and syncs', seqB.includes('Synced to ranch') && afterB === beforeB + 1, `${seqB.join(' → ')} rows ${beforeB} → ${afterB}`)

    // ── 2E: the second person sees what A did; a visit clears it; A never sees A ──
    const { error: colErr } = await admin.from('ranch_members').select('last_seen_at').limit(1)
    if (colErr) {
      skip('2E: since-you-were-here for member B', `migration 044 not applied (${colErr.message.slice(0, 60)})`)
      await ctxB.close()
    } else {
      const ownBlock = await page.getByText('Since you last checked').count() + await page.getByText('Since yesterday').count()
      record('2E: A does not see A\'s own entries as news', ownBlock === 0, `blocks on A's Today: ${ownBlock}`)
      await pageB.goto(`/dashboard?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await pageB.getByText('Since yesterday').waitFor({ timeout: 20_000 }).catch(() => {})
      const blockB = (await pageB.getByText('Since yesterday').locator('xpath=ancestor::div[1]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('2E: B sees "Since yesterday" with A\'s feedings by name', /Smoke A fed 2 bales/.test(blockB) && /Smoke A fed 4 bales/.test(blockB), blockB.slice(0, 140))
      const placeHref = await pageB.getByRole('link', { name: /Smoke A fed 2 bales/ }).first().getAttribute('href').catch(() => null)
      record('2E: a line taps through to its place', placeHref === `/places/${placeId}`, String(placeHref))
      await pageB.waitForTimeout(6_000)                                   // the visit is marked after 4 s in view
      await pageB.reload({ waitUntil: 'domcontentloaded' })
      await pageB.waitForTimeout(3_000)
      const after = await pageB.getByText('Since you last checked').count() + await pageB.getByText('Since yesterday').count()
      record('2E: after the visit, nothing new → no block', after === 0, `blocks: ${after}`)
      await ctxB.close()
    }

    // ── no page errors / 5xx during the run is not tracked here; the invariant smoke covers it ──
  } finally {
    await browser.close()
    await teardown('finish')
  }
  const fails = results.filter(r => !r.pass).length
  const skips = results.filter(r => r.skip).length
  console.log(`\n${results.length - fails - skips} PASS · ${fails} FAIL${skips ? ` · ${skips} SKIP` : ''}${fails ? '  — BLOCKED' : ''}\n`)
  process.exit(fails ? 1 : 0)
}

main().catch(async err => {
  console.error('\nsmoke crashed:', err instanceof Error ? err.message : err)
  try { await teardown('after crash') } catch (e) { console.error('teardown failed:', e) }
  process.exit(2)
})
