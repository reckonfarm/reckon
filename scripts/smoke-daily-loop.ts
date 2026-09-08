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
import { randomUUID } from 'node:crypto'
import { chromium, type Page, type BrowserContext } from '@playwright/test'
import { TEXT_AUDIT, type TextAudit } from './lib/text-audit'

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

// The ranch day, not the UTC day: between 00:00 and 06:00 UTC the two differ, and a count
// stamped 'tomorrow' would make today's feeding read as before the count (seen 2026-09-07 05:10 UTC).
const ranchDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
let userId = ''
let userIdB = ''
let ranchId = ''
let placeId = ''
let lotId = ''
const LOT_NAME = 'Smoke steers'

async function teardown(label: string) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const ids = (users?.users ?? []).filter(u => u.email === EMAIL || u.email === EMAIL_B).map(u => u.id)
  let n = 0
  if (ids.length) {
    n += (await admin.from('events').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('devices').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('places').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('operation_profiles').delete().in('user_id', ids).select('user_id')).data?.length ?? 0
    n += (await admin.from('herd_lots').delete().in('created_by', ids).select('id')).data?.length ?? 0
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
    payload: { source: 'manual', schema_version: 1, place_id: null, bales: 200, as_of: ranchDay() }, schema_version: 1,
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
  // Block 4A — the RANCH's herd (050): one lot, so the hand's Fed-to control has something to show.
  lotId = randomUUID()
  const { error: oErr } = await admin.from('operation_profiles').insert({ user_id: userId, ranch_id: ranchId, county_fips: HOME_FIPS })
  if (oErr) throw new Error(`operation_profile: ${oErr.message}`)
  const { error: lErr } = await admin.from('herd_lots').insert({ id: lotId, ranch_id: ranchId, class: 'steers', name: LOT_NAME, head_count: 60, avg_weight: 550, weight_unit: 'lb', created_by: userId, updated_by: userId })
  if (lErr) throw new Error(`herd lot: ${lErr.message}`)
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
  await page.waitForURL(u => u.pathname.startsWith('/today') || u.pathname.startsWith('/dashboard'), { timeout: 15_000 }).catch(() => {})
  if (process.env.DEBUG_SIGNIN) {
    await page.waitForTimeout(6000)
    console.log('   after callback:', page.url().replace(BASE, ''), (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120))
    console.log('   cookies:', (await ctx.cookies()).map(c => `${c.name.slice(0, 28)}@${c.domain}${c.secure ? ' secure' : ''} ${c.sameSite}`).join(' | '))
  }
  await page.goto('/today', { waitUntil: 'domcontentloaded' })   // Block 6A: the signed-in home
  // The header paints "Sign in" first and swaps to the Account button once the
  // browser client has read the session (Block 6A: the email lives on /account
  // now) — wait for the swap, not the first paint.
  await page.locator('header [data-audit="account-button"]').waitFor({ timeout: 20_000 }).catch(async () => {
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

async function logFeed(page: Page, bales: number, opts: { doubleTap?: boolean; place?: string; lot?: string } = {}) {
  await page.getByRole('button', { name: /^Log it/ }).click()
  await page.getByRole('button', { name: /Hay fed/ }).click()
  await page.getByLabel('Hay fed').fill(String(bales))
  if (opts.place) await page.getByLabel('Where').selectOption({ label: opts.place })
  if (opts.lot) await page.getByLabel('Fed to').selectOption({ label: opts.lot })
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

// A Ctrl-C or a kill mid-run still tears the fixture down (a hard kill cannot be
// caught; scripts/teardown-fixtures.ts sweeps whatever a hard kill leaves).
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { try { await teardown(`on ${sig}`) } catch {} ; process.exit(130) })

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
    record('signed in', page.url().includes('/today'), page.url().replace(BASE, ''))

    // ── invariant ──
    await page.goto('/home', { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/(today|dashboard)/, { timeout: 30_000 })
    const homeUrl = page.url().replace(BASE, '')
    const hasLogIt = await page.getByRole('button', { name: /^Log it/ }).count() > 0
    // Block 6A: /home lands on /today (the county is public context, not part of the home URL); the private stack is there.
    record('/home renders the home county Today stack', homeUrl.startsWith('/today') && hasLogIt, `${homeUrl} · Log it button: ${hasLogIt}`)
    // Phase A1 — measured from the painted page, signed in: no text under 14 px, no pair under
    // 4.5:1, navigation / answers at 7:1 — main and header both.
    for (const root of ['main', 'header'] as const) {
      const ta = await page.evaluate(`${TEXT_AUDIT}(${JSON.stringify({ minPx: 14, minRatio: 4.5, essentialRatio: 7, root })})`) as TextAudit & { tinyCount: number; lowCount: number; lowEssentialCount: number }
      record(`A1: no text under 14 px in ${root} on the signed-in home`, ta.tinyCount === 0, ta.tiny.slice(0, 4).map(n => `${n.px}px "${n.text.slice(0, 24)}"`).join(' | '))
      record(`A1: every text pair ≥ 4.5:1 in ${root} on the signed-in home`, ta.lowCount === 0, ta.low.slice(0, 4).map(n => `${n.ratio}:1 "${n.text.slice(0, 24)}"`).join(' | '))
      record(`A1: navigation and answers ≥ 7:1 in ${root} on the signed-in home`, ta.lowEssentialCount === 0, ta.lowEssential.slice(0, 4).map(n => `${n.ratio}:1 "${n.text.slice(0, 24)}"`).join(' | '))
    }
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
    await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
    await logFeed(page, 4)
    const seq1 = await watchStates(page, 'Synced to ranch', 20_000, 'Fed 4 bales')
    record('online save shows Saved → Waiting → Synced in order', JSON.stringify(seq1) === JSON.stringify(['Saved on this phone', 'Waiting to sync', 'Synced to ranch']), seq1.join(' → '))
    const strip1 = (await page.locator('[role="status"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    record('2C: the answer — recorded, remaining from the count, no invented runway',
      /4 bales recorded/.test(strip1) && /196 bales on hand \(from your count of 200/.test(strip1) && !/feeding day/.test(strip1), strip1.slice(0, 140))
    // Block 5E — Today, reordered: quick record above the ledgers, the ledger strip open on Hay,
    // conditions and the forecast below, and no news feed on the signed-in Today.
    {
      // Document order (Block 6A: on desktop the strips sit in a right column, so y is not the order; the DOM is).
      const pos = async (sel: string) => await page.locator(sel).first().evaluate(el => { let n = 0; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT); while (w.nextNode()) { n++; if (w.currentNode === el) return n } return -1 }).catch(() => NaN)
      const yRepeat = await pos('text=Repeat last feeding'), yLog = await pos('button:has-text("Log it")'), yTabs = await pos('[role="tablist"][aria-label="Ledgers"]'), yForecast = await pos('text=7-day forecast')
      const activeTab = (await page.locator('[role="tablist"][aria-label="Ledgers"] [role="tab"][aria-selected="true"]').innerText().catch(() => '')).trim()
      const headlines = await page.getByText('Headlines', { exact: true }).count()
      record('5E: Today order — repeat last · Log it · ledgers (open on Hay) · 7-day forecast, and no news feed signed in', yRepeat < yLog && yLog < yTabs && yTabs < yForecast && activeTab === 'Hay' && headlines === 0, `y: repeat ${Math.round(yRepeat)} · log ${Math.round(yLog)} · ledgers ${Math.round(yTabs)} · forecast ${Math.round(yForecast)} · active tab "${activeTab}" · Headlines blocks ${headlines}`)
    }
    // Block 5C — one receipt: the strip's link opens the exact entry it just made.
    {
      const href = await page.locator('[role="status"] [data-audit="receipt-open-entry"]').first().getAttribute('href').catch(() => null)
      const ob = await outbox(page)
      const latestId = ob.length ? ob[ob.length - 1].id : null
      record('5C: the save receipt links to the exact entry', !!href && !!latestId && href === `/ranch/activity/${latestId}`, `${href} vs outbox id ${latestId}`)
    }
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
    await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
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
    await page.goto('/ranch/places', { waitUntil: 'domcontentloaded' })
    const placeLink = page.locator(`main a[href="/ranch/places/${placeId}"]`)
    record('2F: /places lists the place', await placeLink.count() > 0, (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120))
    await page.goto(`/ranch/places/${placeId}`, { waitUntil: 'domcontentloaded' })
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
    await page.waitForURL(/\/(today|dashboard)/, { timeout: 30_000 })
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
    await page.getByRole('button', { name: 'Different today' }).click()
    const changed = await page.getByLabel('Hay fed').inputValue().catch(() => '')
    record('2B: Change opens the sheet pre-filled', changed === '2', `bales "${changed}"`)
    await page.getByRole('button', { name: 'Cancel' }).click()

    // ── a member with NO home county: /home must still put Log it in front of them, and a feeding must save ──
    const ctxB = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
    const pageB = await signIn(ctxB, EMAIL_B)
    if (process.env.DEBUG_2E) pageB.on('request', r => { if (/\/api\/seen/.test(r.url()) && r.method() === 'POST') console.log(`   [2E debug] ${new Date().toISOString()} B POST /api/seen from ${r.frame().url().replace(BASE, '')}`) })
    if (process.env.DEBUG_2E) pageB.on('response', r => { if (/\/(today|dashboard)\?fips=/.test(r.url()) && r.request().isNavigationRequest()) console.log(`   [2E debug] ${new Date().toISOString()} B navigation response ${r.status()} ${r.url().replace(BASE, '')}`) })
    await pageB.goto('/home', { waitUntil: 'domcontentloaded' })
    await pageB.waitForURL(/\/(today|dashboard)/, { timeout: 30_000 })
    const urlB = pageB.url().replace(BASE, '')
    const logItB = await pageB.getByRole('button', { name: /^Log it/ }).waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    record('no home county: /home lands on the ledger with Log it', !/fips=/.test(urlB) && logItB, `${urlB} · Log it: ${logItB}`)
    const beforeB = (await admin.from('events').select('id', { count: 'exact', head: true }).eq('user_id', userIdB).eq('type', 'hay_fed')).count ?? 0
    // Block 4A — the hand sees the ranch's lots: the Fed-to control is there, with the lot.
    await pageB.getByRole('button', { name: /^Log it/ }).click()
    await pageB.getByRole('button', { name: /Hay fed/ }).click()
    const fedTo = pageB.getByLabel('Fed to')
    const fedToShown = await fedTo.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
    const lotOptions = fedToShown ? await fedTo.locator('option').allInnerTexts() : []
    record('4A: the hand sees the ranch\'s lots in the Fed-to control', fedToShown && lotOptions.includes(LOT_NAME), fedToShown ? lotOptions.join(' | ') : 'no Fed-to control')
    await pageB.getByRole('button', { name: 'Cancel' }).click().catch(() => {})
    await logFeed(pageB, 1, { lot: fedToShown ? LOT_NAME : undefined })
    const seqB = await watchStates(pageB, 'Synced to ranch', 20_000, 'Fed 1 bale')
    const afterB = (await admin.from('events').select('id', { count: 'exact', head: true }).eq('user_id', userIdB).eq('type', 'hay_fed')).count ?? 0
    record('no home county: a feed event saves and syncs', seqB.includes('Synced to ranch') && afterB === beforeB + 1, `${seqB.join(' → ')} rows ${beforeB} → ${afterB}`)

    // After a feed syncs the ledger page re-renders and its "visit" ping re-arms (4 s dwell),
    // so a ping can be IN FLIGHT when this fixture reset runs and land after it (seen
    // 2026-09-07: POST /api/seen 47 ms before the reset, stamp written after it). Let the
    // re-armed ping fire first, then restore the unstamped B that 2E's sequence starts from.
    // 2026-09-07 again on the 5A preview: a SECOND re-armed ping landed 64 ms after the
    // reset even with the wait, so park B's page where no ping can fire before resetting.
    await pageB.goto('about:blank').catch(() => {})
    await pageB.waitForTimeout(1_500)
    const resetRes = await admin.from('ranch_members').update({ last_seen_at: null }).eq('user_id', userIdB).select('last_seen_at')
    if (process.env.DEBUG_2E) console.log(`   [2E debug] ${new Date().toISOString()} reset →`, JSON.stringify(resetRes.data), resetRes.error?.message ?? '')

    // ── 2E: the second person sees what A did; a visit clears it; A never sees A ──
    const { error: colErr } = await admin.from('ranch_members').select('last_seen_at').limit(1)
    if (colErr) {
      skip('2E: since-you-were-here for member B', `migration 044 not applied (${colErr.message.slice(0, 60)})`)
      await ctxB.close()
    } else {
      const ownRows = await page.locator('[data-audit="since-row"]').count()
      record('2E: A does not see A\'s own entries as news', ownRows === 0, `since rows on A's Today: ${ownRows}`)
      if (process.env.DEBUG_2E) console.log(`   [2E debug] ${new Date().toISOString()} before goto, B last_seen_at =`, JSON.stringify((await admin.from('ranch_members').select('last_seen_at').eq('user_id', userIdB).maybeSingle()).data))
      await pageB.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await pageB.getByText('Recorded since you checked').waitFor({ timeout: 20_000 }).catch(() => {})
      if (process.env.DEBUG_2E) console.log('   [2E debug] after goto, B last_seen_at =', JSON.stringify((await admin.from('ranch_members').select('last_seen_at').eq('user_id', userIdB).maybeSingle()).data), '· since block present:', await pageB.getByText(/Since (yesterday|you last checked)/i).count())
      const blockB = (await pageB.getByText('Recorded since you checked').locator('xpath=ancestor::div[1]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const mainB = (await pageB.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('2E: B sees "Recorded since you checked" with A\'s feedings by name', /Smoke A fed 2 bales/.test(blockB) && /Smoke A fed 4 bales/.test(blockB), blockB ? blockB.slice(0, 140) : `NO BLOCK · url ${pageB.url().replace(BASE, '')} · main: ${mainB.slice(0, 220)}`)
      // Block 5A — a handoff row opens ITS exact event, by stable id (gate 1).
      const rowHref = await pageB.getByRole('link', { name: /Smoke A fed 2 bales/ }).first().getAttribute('href').catch(() => null)
      const eventId = rowHref?.match(/^\/ranch\/activity\/([0-9a-f-]{36})$/)?.[1] ?? null   // Block 6A: the record lives under /ranch
      record('5A: a handoff row opens its exact event, not a place summary', !!eventId, String(rowHref))
      if (eventId) {
        await pageB.goto(`/ranch/activity/${eventId}`, { waitUntil: 'domcontentloaded' })
        await pageB.locator('[data-audit="event-detail"]').waitFor({ timeout: 30_000 }).catch(() => {})
        const d = async (k: string) => (await pageB.locator(`[data-audit="event-${k}"]`).innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        const who = await d('who'), what = await d('what'), work = await d('work-time'), rec = await d('recorded'), sync = await d('sync'), place = await d('place')
        record('5A: the event states actor + role, what, place, work time, recording time, sync state', /Smoke A/.test(who) && /owner/.test(who) && /Fed 2 bales/.test(what) && /West stack/.test(place) && /\d{4}/.test(work) && /\d{4}/.test(rec) && /Synced to ranch/.test(sync), `${who} · ${what} · ${place} · work ${work} · recorded ${rec} · ${sync}`)
        await pageB.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
      }
      // The place's entry count is a door into the place's record (gate 2).
      await pageB.goto(`/ranch/places/${placeId}`, { waitUntil: 'domcontentloaded' })
      const entriesLink = pageB.locator('[data-audit="place-entries-link"]')
      const entriesText = (await entriesLink.innerText().catch(() => '')).replace(/\s+/g, ' ')
      const claimed = parseInt((entriesText.match(/(\d+) entr/) ?? ['', '0'])[1], 10)
      await entriesLink.click().catch(() => {})
      await pageB.locator('[data-audit="activity-list"]').first().waitFor({ timeout: 30_000 }).catch(() => {})
      const listed = await pageB.locator('[data-audit="activity-row"]').count()
      record('5A: the place\'s N entries opens the place\'s activity listing all N', claimed > 0 && listed === claimed && /place=/.test(pageB.url()), `${claimed} claimed · ${listed} listed · ${pageB.url().replace(BASE, '')}`)
      await pageB.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await pageB.getByText('Recorded since you checked').waitFor({ timeout: 20_000 }).catch(() => {})
      await pageB.waitForTimeout(6_000)                                   // the visit is marked after 4 s in view
      await pageB.reload({ waitUntil: 'domcontentloaded' })
      await pageB.waitForTimeout(3_000)
      const afterRows = await pageB.locator('[data-audit="since-row"]').count()
      const quiet = await pageB.getByText('No new crew entries since your last review').count()
      record('2E: after the visit, nothing new → no rows, the quiet line (never "All work complete")', afterRows === 0 && quiet === 1 && (await pageB.getByText('All work complete').count()) === 0, `rows ${afterRows} · quiet line ${quiet}`)
      // Gate 3 — acknowledgment never removes access: the record still lists A's feeding.
      await pageB.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      await pageB.locator('[data-audit="activity-list"]').first().waitFor({ timeout: 30_000 }).catch(() => {})
      const still = await pageB.getByRole('link', { name: /Smoke A · Fed 2 bales/ }).count()
      record('5A: after the visit the entries are still findable in the record', still >= 1, `${still} matching row(s) on /activity`)
      await ctxB.close()
    }

    // Block 4A — the hand's feeding keeps its lot name for the OWNER: A's Recently logged names the lot.
    // (After 2E on purpose: reloading A's page earlier would turn B's feeding into A's own
    //  "since you last checked" news and break 2E's fixed sequence.)
    await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: 'Recently logged', exact: true }).click().catch(() => {})
    await page.waitForTimeout(800)
    const ownerText = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
    record('4A: the hand\'s feeding shows its lot name to the owner', new RegExp(`Fed 1 bale to ${LOT_NAME}`).test(ownerText), (ownerText.match(new RegExp(`Fed 1 bale[^.]{0,60}`)) ?? ['no line'])[0])

    // ── Block 6A (6): the Ranch hub's numbers stand behind something; Archive keeps history ──
    {
      await page.goto('/ranch', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="ranch-sections"]').waitFor({ timeout: 20_000 }).catch(() => {})
      const numbers = await page.locator('[data-audit="section-number"]').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()))
      const recentRows = await page.locator('[data-audit="ranch-recent"] li').count()
      const { count: eventsOnRanch } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('ranch_id', ranchId)
      // The fixture has one live lot with a head count and one place; it has no devices and its hay
      // count IS a baseline, so on hand exists. No device number may render.
      record('6A: the hub shows recent rows and only the numbers something stands behind (no devices → no device number)', recentRows === Math.min(5, eventsOnRanch ?? 0) && numbers.some(n => /head$/.test(n)) && numbers.some(n => /on hand$/.test(n)) && numbers.some(n => /place/.test(n)) && !numbers.some(n => /device/.test(n)), `recent ${recentRows} of ${eventsOnRanch} · numbers [${numbers.join(' | ')}]`)
      // Archive the lot the feedings were logged against: the row leaves the list; the feedings still name it in the record.
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="lot-row"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const rowsBefore = await page.locator('[data-audit="lot-row"]').count()
      const marketHref = await page.locator('[data-audit="lot-market-link"]').first().getAttribute('href').catch(() => null)
      await page.locator('[data-audit="lot-more"]').first().click()
      const menuText = (await page.locator('[data-audit="lot-menu"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await page.locator('[data-audit="lot-archive"]').click()
      await page.waitForTimeout(1_500)
      const rowsAfter = await page.locator('[data-audit="lot-row"]').count()
      await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="activity-list"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const stillNamed = await page.getByRole('link', { name: new RegExp(`to ${LOT_NAME}`) }).count()
      record('6A: Archive sits behind the row menu, states its consequence, removes the lot from current views, and every past feeding still names it', rowsBefore === 1 && rowsAfter === 0 && /History stays; the lot leaves current views/.test(menuText) && stillNamed >= 1 && /^\/markets\?lot=/.test(marketHref ?? ''), `rows ${rowsBefore}→${rowsAfter} · menu "${menuText.slice(0, 60)}" · feedings still naming the lot: ${stillNamed} · market link ${marketHref}`)
    }

    // ── Block 6A (1): old URLs resolve, the signed-in home is /today, county pages are never redirected ──
    {
      const hop = async (path: string) => { const r = await page.request.get(path, { maxRedirects: 0 }); return { status: r.status(), location: (r.headers()['location'] ?? '').replace(/^https?:\/\/[^/]+/, '') } }
      const { data: anyEvent } = await admin.from('events').select('id').eq('user_id', userId).eq('type', 'hay_fed').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      const { data: anyPlace } = await admin.from('places').select('id').eq('ranch_id', ranchId).limit(1).maybeSingle()
      const statics: [string, string][] = [['/herd', '/ranch/cattle'], ['/places', '/ranch/places'], ['/devices', '/ranch/devices'], ['/activity', '/ranch/activity'], ['/jobs', '/ranch/activity?source=machine'], ['/watchlist', '/weather/locations'], ['/radar', '/weather/radar'], ['/profile', '/account'],
        ...(anyPlace ? [[`/places/${anyPlace.id}`, `/ranch/places/${anyPlace.id}`] as [string, string]] : []),
        ...(anyEvent ? [[`/activity/${anyEvent.id}`, `/ranch/activity/${anyEvent.id}`] as [string, string]] : [])]
      const results = await Promise.all(statics.map(async ([from, expected]) => ({ from, expected, ...(await hop(from)) })))
      // A redirect resolves when it is permanent (301/308) and its Location, host stripped, is exactly the new path.
      const failing = results.filter(r => !((r.status === 301 || r.status === 308) && r.location === r.expected))
      record('6A: every old URL answers a permanent redirect to its new home (incl. /places/[id] and /activity/[id])', failing.length === 0 && results.length >= 9, failing.length ? failing.map(r => `${r.from} → ${r.status} ${r.location || '(no location)'}`).join(' | ') : `${results.length} redirects: ` + results.map(r => `${r.from}→${r.location}`).join(' '))
      const [root, home, bare, county, today] = await Promise.all([hop('/'), hop('/home'), hop('/dashboard'), hop(`/dashboard?fips=${HOME_FIPS}`), hop('/today')])
      record('6A: signed in, / and /home and bare /dashboard land on /today in one hop; a county page and /today are never redirected', [root, home, bare].every(r => r.status >= 300 && r.status < 400 && /\/today$/.test(r.location)) && county.status === 200 && today.status === 200, `/ ${root.status}→${root.location} · /home ${home.status}→${home.location} · /dashboard ${bare.status}→${bare.location} · county ${county.status} · /today ${today.status}`)
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      const title = await page.title()
      await page.goto(`/dashboard?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      const countyTitle = await page.title()
      record('6A: no county title on a private page; the county page keeps it', /^Today/.test(title) && !/Drought/.test(title) && /Drought & LFP Eligibility/.test(countyTitle), `/today: "${title}" · /dashboard: "${countyTitle}"`)
    }

    // ── Block 6A (4): the same ranch in the header on every private page; no county title on any of them ──
    {
      const walk = [`/today?fips=${HOME_FIPS}`, '/ranch', '/ranch/cattle', '/ranch/activity', '/ranch/places', '/markets', '/weather', '/account']
      const seen: { path: string; ranch: string; title: string }[] = []
      for (const path of walk) {
        await page.goto(path, { waitUntil: 'domcontentloaded' })
        await page.locator('[data-audit="header-ranch"]').waitFor({ timeout: 15_000 }).catch(() => {})
        seen.push({ path, ranch: (await page.locator('[data-audit="header-ranch"]').innerText().catch(() => '')).trim(), title: await page.title() })
      }
      const names = new Set(seen.map(x => x.ranch))
      const countyTitled = seen.filter(x => /Drought/.test(x.title))
      record('6A: the same ranch name in the header on Today, Ranch, Cattle, Activity, Places, Markets, Weather, Account — and no county title on any', names.size === 1 && !names.has('') && countyTitled.length === 0, `ranch "${[...names].join('|')}" · titles: ${seen.map(x => `${x.path.replace(/\?.*/, '')}="${x.title.replace(/ — Dryline$/, '')}"`).join(' ')}`)
    }

    // ── Block 6A (3): the Record FAB on a phone — above the bar, hidden while a sheet is open ──
    {
      const prior = page.viewportSize()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      const fab = page.locator('[data-audit="record-fab"]')
      await fab.waitFor({ timeout: 15_000 }).catch(() => {})
      const fabBox = await fab.boundingBox().catch(() => null)
      const barBox = await page.locator('[data-audit="bottom-bar"]').boundingBox().catch(() => null)
      const tabs = await page.locator('[data-audit="bottom-bar"] a').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()))
      record('6A: four labeled bottom tabs and a Record FAB that sits clear above the bar', tabs.join(' ') === 'Today Ranch Markets Weather' && !!fabBox && !!barBox && fabBox.y + fabBox.height <= barBox.y, `tabs [${tabs.join(', ')}] · fab bottom ${fabBox ? Math.round(fabBox.y + fabBox.height) : 'none'} · bar top ${barBox ? Math.round(barBox.y) : 'none'}`)
      await fab.click()
      await page.getByRole('dialog').waitFor({ timeout: 10_000 }).catch(() => {})
      const openDialogs = await page.getByRole('dialog').count()
      const fabWhileOpen = await fab.count()
      const flag = await page.evaluate(() => document.documentElement.dataset.recordSheet ?? '')
      await page.getByRole('button', { name: 'Close' }).click().catch(() => {})
      await page.waitForTimeout(300)
      const fabAfter = await fab.isVisible().catch(() => false)
      record('6A: the FAB opens the record sheet and is hidden while the sheet is up, back when it closes', openDialogs === 1 && fabWhileOpen === 0 && flag === 'open' && fabAfter, `dialogs ${openDialogs} · fab while open ${fabWhileOpen} · html flag "${flag}" · fab after close ${fabAfter}`)
      if (prior) await page.setViewportSize(prior)
    }

    // ── Block 5B, gate 4: correct 6 to 4 after sync, on the phone ──────────────
    // Original, current value, editor, reason, and the resulting balance all
    // visible. Balance read from the receipt the save lands on and from the
    // status strip before it — the same ledger read (lib/hay/queries, through
    // the chain). Skips without migration 054.
    {
      const probe = await admin.from('events').select('superseded_by').limit(1)
      if (probe.error) skip('5B: correct 6 → 4 on the phone', `migration 054 not applied (${probe.error.message.slice(0, 60)})`)
      else {
        await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1_000)
        await logFeed(page, 6)
        const seq6 = await watchStates(page, 'Synced to ranch', 20_000, 'Fed 6 bales')
        // The answer lines follow the sync by a beat; read the strip until they are there (≤ 8 s).
        let strip6 = ''
        for (let i = 0; i < 32 && !/bales? on hand/.test(strip6); i++) { strip6 = (await page.locator('[role="status"]').first().innerText().catch(() => '')).replace(/\s+/g, ' '); if (!/bales? on hand/.test(strip6)) await page.waitForTimeout(250) }
        const onHand6 = parseInt((strip6.match(/(\d+) bales? on hand/) ?? ['', 'NaN'])[1], 10)
        const { data: six } = await admin.from('events').select('id').eq('user_id', userId).eq('type', 'hay_fed').eq('payload->>bales', '6').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
        record('5B: a 6-bale feeding synced and the strip states the balance', seq6.includes('Synced to ranch') && !!six && Number.isFinite(onHand6), `${seq6.join(' → ')} · on hand ${onHand6} · strip: ${strip6.slice(0, 120)}`)
        if (six) {
          await page.goto(`/ranch/activity/${six.id}`, { waitUntil: 'domcontentloaded' })
          await page.locator('[data-audit="correct-entry"]').click()
          await page.getByLabel('Bales', { exact: true }).fill('4')
          await page.locator('[data-audit="correction-reason"]').fill('was 4, typed 6')
          await page.locator('[data-audit="correction-save"]').click()
          await page.waitForURL(/\/activity\/[0-9a-f-]{36}\?saved=1/, { timeout: 30_000 }).catch(() => {})
          await page.locator('[data-audit="event-detail"]').waitFor({ timeout: 30_000 }).catch(() => {})
          const d = async (k: string) => (await page.locator(`[data-audit="event-${k}"]`).innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
          const line = await d('line'), who = await d('who'), corrects = await d('corrects'), reason = await d('reason'), receipt = await d('consequence')
          const onHand4 = parseInt((receipt.match(/(\d+) bales? on hand/) ?? ['', 'NaN'])[1], 10)
          record('5B: the correction lands on its own entry — current value, editor, what it corrects, reason', /Fed 4 bales/.test(line) && /Smoke A/.test(who) && /owner/.test(who) && /Fed 6 bales/.test(corrects) && /was 4, typed 6/.test(reason), `${line} · ${who} · corrects ${corrects} · ${reason}`)
          record('5B: the resulting balance is on the receipt and moved by exactly the 2 bales corrected', Number.isFinite(onHand4) && onHand4 === onHand6 + 2, `on hand ${onHand6} → ${onHand4}`)
          await page.goto(`/ranch/activity/${six.id}`, { waitUntil: 'domcontentloaded' })
          const replaced = (await page.locator('[data-audit="event-replaced"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
          const struck = await page.locator('h1[data-audit="event-line"].line-through').count()
          record('5B: the original stays readable, struck through, and names the current value, who changed it, and why', /Current: Fed 4 bales/.test(replaced) && /Changed by Smoke A/.test(replaced) && /was 4, typed 6/.test(replaced) && struck === 1, replaced.slice(0, 160))
          const again = await page.locator('[data-audit="correct-entry"]').count()
          record('5B: a corrected entry offers no second correction (correct the current entry instead)', again === 0, `${again} correct button(s) on the original`)
        }
      }
    }

    // ── Block 5D, gate 6: sign out with a receipt open; sign in as another person ──
    // Private content disappears at once — the page, the storage, the receipt —
    // and nothing of the first person survives into the second's session, with
    // or without a clean sign-out in between.
    {
      const PRIVATE_KEYS = ['dryline_outbox_v1', 'manual_log_draft_v1', 'manual_log_last_lot', 'manual_log_last_place', 'dryline_hay_draft_v1', 'farmer_type', 'dryline_session_uid']
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[role="status"]').first().waitFor({ timeout: 15_000 }).catch(() => {})
      const beforeText = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const keysBefore = await page.evaluate((ks: string[]) => ks.filter(k => localStorage.getItem(k) !== null), PRIVATE_KEYS)
      record('5D: before sign-out the page holds private content and the phone holds private keys', /SMOKE-DAILY-LOOP/.test(beforeText) && /bales/.test(beforeText) && keysBefore.includes('dryline_outbox_v1') && keysBefore.includes('dryline_session_uid'), `keys: ${keysBefore.join(', ')}`)
      page.once('dialog', d => void d.accept())   // "entries not synced" guard, should not fire — everything synced
      await page.goto('/account', { waitUntil: 'domcontentloaded' })   // Block 6A: Sign out lives on /account
      await page.locator('[data-audit="sign-out"]').click()
      await page.waitForURL(u => u.pathname === '/' || u.pathname === '/signin', { timeout: 30_000 }).catch(() => {})
      await page.waitForLoadState('domcontentloaded')
      const afterText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const keysAfter = await page.evaluate((ks: string[]) => ks.filter(k => localStorage.getItem(k) !== null), PRIVATE_KEYS)
      const signIn = await page.locator('a[href^="/signin"]').count() + (/sign in/i.test(afterText) ? 1 : 0)   // the public page offers a way in, in whatever words
      record('5D: after sign-out — fresh signed-out page, no ranch name, no quantities, no receipt, no private keys', !/SMOKE-DAILY-LOOP/.test(afterText) && !/Fed \d+ bales/.test(afterText) && !/bales on hand/.test(afterText) && !/Synced to ranch/.test(afterText) && keysAfter.length === 0 && signIn >= 1, `url ${page.url().replace(BASE, '') || '/'} · keys left: ${keysAfter.join(', ') || 'none'} · sign-in links ${signIn}`)
      // Account switch WITHOUT a clean sign-out: plant a stale outbox item under A's id, then open B's magic link in the same browser.
      await page.evaluate(([outboxKey, ownerKey, uid]: string[]) => {
        localStorage.setItem(ownerKey, uid)
        localStorage.setItem(outboxKey, JSON.stringify([{ id: 'aaaaaaaa-0000-4000-8000-000000000001', body: { id: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'hay_fed', bales: 99 }, label: 'Fed 99 bales', createdAt: Date.now(), state: 'synced', syncedAt: Date.now(), attempts: 1, owner: uid, consequence: { lines: ['99 bales recorded', '1 bales on hand (from your count of 100 on Mon)'] } }]))
      }, ['dryline_outbox_v1', 'dryline_session_uid', userId])
      const linkB = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL_B })
      const thB = linkB.data?.properties?.hashed_token
      await page.goto(`/auth/callback?token_hash=${thB}&type=magiclink&next=/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForURL(u => u.pathname.startsWith('/today') && !u.searchParams.has('token_hash'), { timeout: 60_000 }).catch(() => {})
      await page.waitForTimeout(2_500)
      const bText = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const bState = await page.evaluate(([outboxKey, ownerKey]: string[]) => ({ outbox: localStorage.getItem(outboxKey), owner: localStorage.getItem(ownerKey) }), ['dryline_outbox_v1', 'dryline_session_uid'])
      record('5D: signed in as another person without a sign-out — the first person\'s receipt and outbox are gone, the phone is theirs now', !/Fed 99 bales/.test(bText) && !/99 bales recorded/.test(bText) && (bState.outbox === null || bState.outbox === '[]') && bState.owner !== userId && !!bState.owner, `owner ${bState.owner === userId ? 'STILL A' : 'B'} · outbox ${bState.outbox ?? 'none'} · receipt shown: ${/Fed 99 bales/.test(bText)}`)
    }

    // ── no page errors / 5xx during the run is not tracked here; the invariant smoke covers it ──
  } finally {
    await browser.close()
    if (process.env.KEEP_FIXTURE) console.log('KEEP_FIXTURE set — fixture left in place for inspection (next run tears it down)')
    else await teardown('finish')
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
