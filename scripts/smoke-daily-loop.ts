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

import { guardWorktree } from './lib/suite-guard'
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
guardWorktree('smoke-daily-loop')

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
    n += (await admin.from('job_annotations').delete().in('user_id', ids).select('job_id')).data?.length ?? 0   // 6J fixtures
    n += (await admin.from('jobs').delete().in('user_id', ids).select('id')).data?.length ?? 0
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
  await page.getByRole('button', { name: /^Record work/ }).click()
  await page.getByRole('button', { name: /^Feed hay/ }).click()
  await page.getByLabel('Hay fed').fill(String(bales))
  if (opts.place) await page.getByLabel('Where').selectOption({ label: opts.place })
  if (opts.lot) { await page.locator('[data-audit="fed-to"]').waitFor({ timeout: 15_000 }).catch(() => {}); await page.locator('[data-audit="fed-to"]').selectOption({ label: opts.lot }) }
  const save = page.getByRole('button', { name: 'Record feeding', exact: true })
  await save.waitFor({ timeout: 15_000 }).catch(() => {})   // Block 6A: Save waits for the lots to load
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
    const hasLogIt = await page.getByRole('button', { name: /^Record work/ }).count() > 0
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
      /4 bales recorded/.test(strip1) && /200 counted [^+]+ \+ 0 added \u2212 4 fed = 196 bales on hand/.test(strip1) && !/feeding day/.test(strip1), strip1.slice(0, 140))   // 6C: the complete equation
    // Block 7.7 — Today is a work screen. The order is live job · needs attention ·
    // since you checked · repeat feeding · hay, and the conditions strip is NOT on it
    // any more: the drought reading and the program deadline moved to Weather with the
    // LFP card, so the check that required a conditions strip BELOW the ledgers was
    // asserting the shape this block deliberately removed.
    //
    // Block 7B.1 amends the tail of that order, not its principle. Headlines are
    // back on Today — they were only ever hidden, gated to the signed-out county
    // page — and they sit LAST, below the ledgers. "No news on Today" becomes
    // "news below all of the work": still nothing above the ranch's own business,
    // which is what 7.7 was protecting.
    {
      // Document order (Block 6A: on desktop the strips sit in a right column, so y is not the order; the DOM is).
      const pos = async (sel: string) => await page.locator(sel).first().evaluate(el => { let n = 0; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT); while (w.nextNode()) { n++; if (w.currentNode === el) return n } return -1 }).catch(() => NaN)
      const ySince = await pos('text=Recorded since you checked'), yRepeat = await pos('text=Repeat last feeding'), yLog = await pos('button:has-text("Record work")'), yTabs = await pos('[role="tablist"][aria-label="Ledgers"]')
      const activeTab = (await page.locator('[role="tablist"][aria-label="Ledgers"] [role="tab"][aria-selected="true"]').innerText().catch(() => '')).trim()
      const yNews = await pos('[data-audit="news-hook"]')
      record('7.7: Today order — since you checked · repeat last · Log it · hay (open on Hay), headlines last (7B.1)', ySince < yRepeat && yRepeat < yLog && yLog < yTabs && yTabs < yNews && activeTab === 'Hay', `order: since ${Math.round(ySince)} · repeat ${Math.round(yRepeat)} · log ${Math.round(yLog)} · ledgers ${Math.round(yTabs)} · news ${Math.round(yNews)} · active tab "${activeTab}"`)
      const body7 = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('7.7: the LFP card, the drought designation and the deadline strip are off Today', (await page.locator('[data-audit="conditions-strip"]').count()) === 0 && !/LFP status/i.test(body7) && !/Next USDA deadline/i.test(body7) && !/U\.S\. Drought Monitor/i.test(body7), (body7.match(/LFP status|Next USDA deadline|U\.S\. Drought Monitor/i) ?? ['all gone'])[0])
      record('7.7: no floating Feedback button on Today', (await page.getByRole('button', { name: /send feedback/i }).count()) === 0)
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
    await page.getByRole('button', { name: /^Record work/ }).click()
    await page.getByRole('button', { name: /^Feed hay/ }).click()
    await page.getByLabel('Hay fed').fill('7')
    await page.reload({ waitUntil: 'domcontentloaded' })
    const btn = await page.getByRole('button', { name: /^Record work/ }).innerText().catch(() => '')
    await page.getByRole('button', { name: /^Record work/ }).click()
    const restored = await page.getByLabel('Hay fed').inputValue().catch(() => '')
    record('half-typed sheet survives a reload', /finish/.test(btn) && restored === '7', `button "${btn}" · bales "${restored}"`)
    await page.getByRole('button', { name: 'Cancel' }).click()

    // ── 7.4 + 7.5: what a form says before it saves ────────────────────────
    {
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_500)
      // The check before this one deliberately leaves a half-typed sheet
      // restored, so the FAB is behind it. Clear the draft before opening a new
      // form, or every assertion below reads the wrong sheet.
      for (let i = 0; i < 2; i++) {
        if (await page.locator('button:has-text("Cancel")').first().isVisible().catch(() => false)) {
          await page.locator('button:has-text("Cancel")').first().click().catch(() => {})
          await page.waitForTimeout(800)
        }
      }
      // Two launchers exist and exactly one is visible at any width — the FAB
      // is md:hidden, the header's Record is hidden on the narrow layout. Pick
      // by VISIBILITY, not DOM order: .first() on the pair silently chose the
      // hidden one and every assertion after it read a sheet that never opened.
      await page.locator('[data-audit="record-button"], [data-audit="record-fab"]').locator('visible=true').first().click()
      await page.locator('[data-audit="tile-hay_inventory"]').first().click()
      await page.waitForTimeout(1_200)
      // An empty number can never save as 0 — it is refused in the form now,
      // not after the entry has landed in the outbox as 'failed'.
      await page.locator('[data-audit="record-save"]').first().click()
      await page.waitForTimeout(1_200)
      const emptyErr = (await page.locator('[role="alert"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('7.4: an empty count is refused in the form, never saved as 0', /Enter a number first/i.test(emptyErr), emptyErr.slice(0, 60))
      await page.getByLabel('On hand').first().fill('200')
      await page.waitForTimeout(600)
      const effect = (await page.locator('[data-audit="count-effect"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('7.4: the count says what it will DO before it does it', /This sets ranch hay on hand to 200 bales/.test(effect), effect.slice(0, 90))
      record('7.4: the picker no longer calls a ranch-wide count a stack count', !/count of the stack/i.test((await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')))
      // 7.5 — the effective date, in a sentence, beside Save, on this form too.
      const nowLine = (await page.locator('[data-audit="when-sentence"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('7.5: every form says which day it is recording', nowLine.trim() === 'Now.', nowLine)
      await page.locator('[data-audit="when-yesterday"]').first().click()
      await page.waitForTimeout(600)
      const yLine = (await page.locator('[data-audit="when-sentence"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('7.5: the Yesterday chip names the day it chose', /^Yesterday, [A-Z][a-z]{2} \d{1,2} · /.test(yLine), yLine)
      // and it survives editing another field
      await page.getByLabel('On hand').first().fill('201')
      await page.waitForTimeout(400)
      record('7.5: a chosen backdate survives editing another field', (await page.locator('[data-audit="when-sentence"]').innerText().catch(() => '')).replace(/\s+/g, ' ') === yLine, yLine)
      await page.locator('[data-audit="when-today"]').first().click()
      await page.waitForTimeout(400)
      record('7.5: Today puts it back to Now', (await page.locator('[data-audit="when-sentence"]').innerText().catch(() => '')).trim() === 'Now.')
      await page.locator('button:has-text("Cancel")').first().click().catch(() => {})
      await page.waitForTimeout(600)
    }

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
    await page.getByRole('tab', { name: 'Last recorded feeding' }).click()
    const chip = (await page.locator('[role="status"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    record('2F: "Last feeding" chip answers', /Last recorded feeding: today .*2 bales/.test(chip), chip.slice(0, 100))
    const feedHere = page.locator('[data-audit="record-here"]')   // Block 6A: one primary Record here — it opens the picker with the place set
    await feedHere.click()
    await page.locator('[data-audit="tile-hay_fed"]').click()
    // The place list loads when the sheet opens; the pre-filled value shows once its option exists.
    await page.getByLabel('Where').locator('option', { hasText: placeName }).waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
    const prefilled = await page.getByLabel('Where').inputValue().catch(() => '')
    record('2F: "Record here" opens the sheet with this place', prefilled === placeId, `Where=${prefilled.slice(0, 8)}…`)
    await page.getByRole('button', { name: 'Cancel' }).click()

    // ── 2B: repeat last — two taps from a cold open, undo, one row ──
    const beforeRepeat = await feedRows()
    await page.goto('/home', { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/(today|dashboard)/, { timeout: 30_000 })
    const same = page.getByRole('button', { name: /^Record \d+ bales? now$/ })
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
    await page.getByRole('button', { name: /^Record \d+ bales? now$/ }).click()
    await page.getByRole('button', { name: /^Undo/ }).click()
    await page.waitForTimeout(13_000)
    record('2B: Undo inside 10 s → no row', (await feedRows()) === beforeUndo && await page.getByRole('button', { name: /^Record \d+ bales? now$/ }).count() > 0, `feeds ${beforeUndo} → ${await feedRows()}`)
    await page.getByRole('button', { name: 'Adjust first' }).click()
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
    const logItB = await pageB.getByRole('button', { name: /^Record work/ }).waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    record('no home county: /home lands on the ledger with Log it', !/fips=/.test(urlB) && logItB, `${urlB} · Log it: ${logItB}`)
    const beforeB = (await admin.from('events').select('id', { count: 'exact', head: true }).eq('user_id', userIdB).eq('type', 'hay_fed')).count ?? 0
    // Block 4A — the hand sees the ranch's lots: the Fed-to control is there, with the lot.
    await pageB.getByRole('button', { name: /^Record work/ }).click()
    await pageB.getByRole('button', { name: /^Feed hay/ }).click()
    const fedTo = pageB.locator('[data-audit="fed-to"]')   // Block 6A: the loaded control (the field's space is reserved while lots load)
    const fedToShown = await fedTo.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
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
      // Block 6A: the block shows 3–5 rows, newest recorded first, and 'View all N updates' carries the rest.
      const sinceRows = await pageB.locator('[data-audit="since-row"]').count()
      const viewAll = (await pageB.locator('[data-audit="since-view-all"]').innerText().catch(() => '')).trim()
      record('2E: B sees "Recorded since you checked" with A\'s feedings by name', /Smoke A fed \d+ bales?/.test(blockB) && sinceRows >= 1 && sinceRows <= 5 && (sinceRows < 5 || /View all \d+ updates/.test(viewAll)), blockB ? blockB.slice(0, 140) : `NO BLOCK · url ${pageB.url().replace(BASE, '')} · main: ${mainB.slice(0, 220)}`)
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
      // 6H: the review boundary is an ACTION. Six seconds on the page mark nothing; Reviewed does.
      await pageB.waitForTimeout(6_000)
      await pageB.reload({ waitUntil: 'domcontentloaded' })
      await pageB.getByText('Recorded since you checked').waitFor({ timeout: 20_000 }).catch(() => {})
      const stillRows = await pageB.locator('[data-audit="since-row"]').count()
      const btnOnCard0 = await pageB.locator('[data-audit="mark-reviewed"]').count()
      const viewAll0 = await pageB.locator('[data-audit="since-view-all"]').count()
      // Reviewed sits on the card only when the card holds every entry; otherwise the full list carries it.
      record('6H: time on the page marks nothing — after six seconds and a reload the rows are still there, and Reviewed is offered exactly where every entry is in view', stillRows >= 1 && (viewAll0 === 0 ? btnOnCard0 === 1 : btnOnCard0 === 0), `rows after reload ${stillRows} · Reviewed on card ${btnOnCard0} · View all ${viewAll0}`)
      if (viewAll0 > 0) {
        await pageB.locator('[data-audit="since-view-all"]').click()
        await pageB.locator('[data-audit="activity-list"]').first().waitFor({ timeout: 30_000 }).catch(() => {})
      }
      await pageB.locator('[data-audit="mark-reviewed"]').click()
      await pageB.waitForTimeout(1_500)
      await pageB.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await pageB.locator('[data-audit="since-empty"]').waitFor({ timeout: 20_000 }).catch(() => {})
      const afterRows = await pageB.locator('[data-audit="since-row"]').count()
      const quiet = await pageB.getByText('No new crew entries since your last review').count()
      const recentLink = await pageB.locator('[data-audit="since-recent-link"]').count()
      record('2E/6H: after Reviewed, nothing new → no rows, the quiet line with recent entries one tap away (never "All work complete")', afterRows === 0 && quiet === 1 && recentLink === 1 && (await pageB.getByText('All work complete').count()) === 0, `rows ${afterRows} · quiet line ${quiet} · recent link ${recentLink}`)
      // 6H: pagination can't mark unseen entries — with more than the card shows, Reviewed lives on the full list only.
      const six = Array.from({ length: 6 }, (_, i) => ({ user_id: userId, ranch_id: ranchId, device_id: null, type: 'hay_fed', ts: new Date(Date.now() - (i + 1) * 60_000).toISOString(), schema_version: 1, payload: { source: 'manual', schema_version: 1, bales: 1, herd_lot_id: null, place_id: placeId } }))
      const { error: sixErr } = await admin.from('events').insert(six)
      if (sixErr) skip('6H: pagination cannot mark unseen entries', sixErr.message)
      else {
        await pageB.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await pageB.getByText('Recorded since you checked').waitFor({ timeout: 20_000 }).catch(() => {})
        const shown = await pageB.locator('[data-audit="since-row"]').count()
        const btnOnCard = await pageB.locator('[data-audit="mark-reviewed"]').count()
        const viewAll = pageB.locator('[data-audit="since-view-all"]')
        const viewAllText = (await viewAll.innerText().catch(() => '')).trim()
        record('6H: more entries than the card shows → no Reviewed on the card, only View all', shown === 5 && btnOnCard === 0 && /View all 6 updates/.test(viewAllText), `shown ${shown} · Reviewed on card ${btnOnCard} · "${viewAllText}"`)
        await viewAll.click().catch(() => {})
        await pageB.locator('[data-audit="activity-list"]').first().waitFor({ timeout: 30_000 }).catch(() => {})
        const listed = await pageB.locator('[data-audit="activity-row"]').count()
        const btnOnList = await pageB.locator('[data-audit="mark-reviewed"]').count()
        await pageB.locator('[data-audit="mark-reviewed"]').click().catch(() => {})
        await pageB.waitForTimeout(1_500)
        await pageB.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await pageB.locator('[data-audit="since-empty"]').waitFor({ timeout: 20_000 }).catch(() => {})
        const quiet2 = await pageB.getByText('No new crew entries since your last review').count()
        record('6H: the full list carries Reviewed once all six are in front of the person, and Today is quiet after it', listed === 6 && btnOnList === 1 && quiet2 === 1, `listed ${listed} · Reviewed on list ${btnOnList} · quiet after ${quiet2}`)
      }
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
    await page.getByRole('tab', { name: 'Activity', exact: true }).click().catch(() => {})
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
      // 7B.2: the hub opens on TWO rows, not five, with the rest behind an
      // in-place expander — so the count asserted here is 2 (or however few
      // the ranch has), and the expander must be offered when there are more.
      const wantRows = Math.min(2, eventsOnRanch ?? 0)
      const expander = await page.locator('[data-audit="ranch-recent-more"]').count()
      record('6A/7B.2: the hub opens on two recent rows with the rest one tap away, and shows only the numbers something stands behind (no devices → no device number)', recentRows === wantRows && expander === ((eventsOnRanch ?? 0) > wantRows ? 1 : 0) && numbers.some(n => /head$/.test(n)) && numbers.some(n => /on hand$/.test(n)) && numbers.some(n => /place/.test(n)) && !numbers.some(n => /device/.test(n)), `recent ${recentRows} of ${eventsOnRanch} · expander ${expander} · numbers [${numbers.join(' | ')}]`)
      // Archive the lot the feedings were logged against: the row leaves the list; the feedings still name it in the record.
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="lot-row"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const rowsBefore = await page.locator('[data-audit="lot-row"]').count()
      const marketHref = await page.locator('[data-audit="lot-market-link"]').first().getAttribute('href').catch(() => null)
      await page.locator('[data-audit="lot-more"]').first().click()
      const menuText = (await page.locator('[data-audit="lot-menu"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await page.locator('[data-audit="lot-archive"]').click()
      for (let i = 0; i < 40 && (await page.locator('[data-audit="lot-row"]').count()) > 0; i++) await page.waitForTimeout(250)   // the list reloads from the server
      const rowsAfter = await page.locator('[data-audit="lot-row"]').count()
      await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="activity-list"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const stillNamed = await page.getByRole('link', { name: new RegExp(`to ${LOT_NAME}`) }).count()
      record('6A: Archive sits behind the row menu, states its consequence, removes the lot from current views, and every past feeding still names it', rowsBefore === 1 && rowsAfter === 0 && /History stays; the lot leaves current views/.test(menuText) && stillNamed >= 1 && /^\/markets\?lot=/.test(marketHref ?? ''), `rows ${rowsBefore}→${rowsAfter} · menu "${menuText.slice(0, 60)}" · feedings still naming the lot: ${stillNamed} · market link ${marketHref}`)
    }

    // ── Block 6A (7): places rows carry last work only when a line exists; devices empty state + setup page ──
    {
      await page.goto('/ranch/places', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="place-rows"]').waitFor({ timeout: 20_000 }).catch(() => {})
      const placeRows = await page.locator('[data-audit="place-row"]').count()
      const withWork = await page.locator('[data-audit="place-last-work"]').count()
      const withRain = await page.locator('[data-audit="place-last-rain"]').count()
      const { count: rainLines } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('ranch_id', ranchId).eq('type', 'rain')
      record('6A: places list — every place a row; last recorded work where a line exists; last rain only where a reading exists', placeRows >= 1 && withWork >= 1 && (rainLines ?? 0) > 0 ? withRain >= 1 : withRain === 0, `rows ${placeRows} · with work ${withWork} · with rain ${withRain} · rain lines on ranch ${rainLines}`)
      await page.goto('/ranch/devices', { waitUntil: 'domcontentloaded' })
      const emptyText = (await page.locator('[data-audit="devices-empty"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const setup = await page.request.get('/ranch/devices/setup')
      const online = await page.locator('main').innerText().then(t => /\bOnline\b|\bOffline\b/.test(t)).catch(() => false)
      record('6A: devices empty state says you can record now and what will appear; Set up a device resolves; never Online/Offline', /No devices connected\. You can record work now\./.test(emptyText) && (await page.locator('[data-audit="setup-device"]').count()) === 1 && setup.status() === 200 && !online, `${emptyText.slice(0, 80)}… · setup ${setup.status()}`)
    }

    // ── Block 6A (8): the record sheet — verbs, Count apart, quantity → lot → place → time, a preview, Record feeding ──
    {
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: /^Record work/ }).click()
      const tiles = await page.locator('[data-audit="record-picker"] button').evaluateAll(els => els.map(e => (e.querySelector('span')?.textContent ?? '').trim()))
      const countApart = await page.locator('[data-audit="record-picker"]').innerText().then(t => /count · not a stock movement/i.test(t)).catch(() => false)   // the eyebrow is uppercased by CSS
      await page.locator('[data-audit="tile-hay_fed"]').click()
      await page.locator('[data-audit="fed-to"]').waitFor({ timeout: 15_000 }).catch(() => {})
      const labels = await page.locator('form label, form [data-audit="feed-preview"], form p').evaluateAll(els => els.map(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))
      const order = ['Hay fed', 'Fed to', 'Where'].map(l => labels.findIndex(x => x.startsWith(l)))
      const noLot = await page.locator('[data-audit="fed-to"] option').first().innerText().catch(() => '')
      await page.getByLabel('Hay fed').fill('3')
      const preview = (await page.locator('[data-audit="feed-preview"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const saveLabel = (await page.locator('[data-audit="record-save"]').innerText().catch(() => '')).trim()
      await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {})
      record('6A: the sheet offers verbs with Count apart; a feeding runs quantity → lot → place; "Not assigned to a lot"; a preview line; Record feeding', tiles.join(' | ') === 'Feed hay | Record rain | Add bales to a stack | Move cattle | Record cattle work | Count hay' && countApart && order[0] < order[1] && order[1] < order[2] && noLot === 'Not assigned to a lot' && /^3 bales.*today \d/.test(preview) && saveLabel === 'Record feeding', `tiles [${tiles.join(' | ')}] · count apart ${countApart} · order ${order.join(',')} · no-lot "${noLot}" · preview "${preview}" · save "${saveLabel}"`)
    }

    // ── Block 6A (9): the copy queue, as rendered ──
    {
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[role="tablist"][aria-label="Ledgers"]').waitFor({ timeout: 20_000 }).catch(() => {})
      const tabs = await page.locator('[role="tablist"][aria-label="Ledgers"] [role="tab"]').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()))
      const repeatButtons = await page.locator('button').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()).filter(t => /^Record \d+ bales? now$/.test(t) || t === 'Adjust first'))
      await page.goto(`/weather?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      // The weather body streams behind Suspense — the forecast leads, the drought card lands later. Wait for it
      // before counting (the count is the fact; the wait only gives the page time to say it).
      await page.getByRole('heading', { name: 'County drought' }).waitFor({ timeout: 30_000 }).catch(() => {})
      const countyDrought = await page.getByRole('heading', { name: 'County drought' }).count()
      const latestReading = await page.getByText('Latest Reading', { exact: true }).count()
      await page.goto('/account', { waitUntil: 'domcontentloaded' })
      await page.getByText('Name shown on your work entries').waitFor({ timeout: 20_000 }).catch(() => {})   // the profile form paints after its fetch
      const nameHint = await page.getByText('Name shown on your work entries').count()
      const buyers = await page.getByText(/How buyers see you|Tell buyers/).count()
      record('6A: copy queue rendered — Jobs this season · Hay · Activity tabs; Record N bales now / Adjust first; County drought; the display-name hint; no buyer copy', tabs.join(' | ') === 'Jobs this season | Hay | Activity' && repeatButtons.length === 2 && countyDrought === 1 && latestReading === 0 && nameHint === 1 && buyers === 0, `tabs [${tabs.join(' | ')}] · repeat [${repeatButtons.join(' | ')}] · County drought ${countyDrought} · Latest Reading ${latestReading} · hint ${nameHint} · buyer copy ${buyers}`)
    }

    // ── Block 6 (6K): weather copy — no "County County"; the rainfall line says what it is; the Drought Monitor's two dates named apart ──
    {
      await page.goto(`/weather?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="weather-estimate"]').waitFor({ timeout: 30_000 }).catch(() => {})
      const mainText = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('6K: no "County County" anywhere on Weather', mainText.length > 0 && !/County County/.test(mainText), /County County/.test(mainText) ? 'found "County County"' : `${mainText.length} chars, clean`)
      // Block 7 (1): no visible copy names a layer the registry has parked. The parked labels are
      // read from the registry source itself (label + "PARKED" inToggle:false in one definition),
      // so un-parking a layer lifts the ban for that label and parking a new one adds it.
      const registry = readFileSync(resolve(process.cwd(), 'app/dashboard/components/layers.ts'), 'utf8')
      const parked = registry.split(/\nexport const /).filter(b => /inToggle:\s*false,\s*\/\/ PARKED/.test(b)).map(b => (b.match(/label:\s*'([^']+)'/) ?? ['', ''])[1]).filter(Boolean)
      const mapSection = (await page.locator('[data-audit="weather-drought-map"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await page.getByRole('button', { name: /Drought map/ }).first().click().catch(() => {})
      await page.waitForTimeout(2_500)
      const expanded = (await page.locator('[data-audit="weather-drought-map"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const named = parked.filter(l => new RegExp(`\\b${l}\\b`, 'i').test(mainText) || new RegExp(`\\b${l}\\b`, 'i').test(expanded))
      record('7-1: the map is named a Drought map, and no visible copy on Weather names a layer the registry has parked', parked.length >= 1 && /Drought map/.test(mapSection) && named.length === 0, `parked in registry: ${parked.join(', ')} · named on the page: ${named.length ? named.join(', ') : 'none'}`)
      // Block 7 (3): public Weather is the destination — a signed-out person who taps the Weather tab gets the
      // seven-day forecast first; public Today keeps its brief outlook.
      {
        const pubCtx = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
        const pub = await pubCtx.newPage()
        await pub.goto(`/dashboard?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await pub.locator('[data-audit="forecast-strip"]').waitFor({ timeout: 30_000 }).catch(() => {})
        const todayStrip = await pub.locator('[data-audit="forecast-strip"]').count()
        await pub.getByRole('tab', { name: 'Weather', exact: true }).click().catch(() => {})
        await pub.locator('[data-audit="weather-forecast"]').waitFor({ timeout: 30_000 }).catch(() => {})
        const fcSection = await pub.locator('[data-audit="weather-forecast"]').count()
        const days = await pub.locator('[data-audit="weather-forecast"] button').count()
        const order = await pub.evaluate(() => { const a = document.querySelector('[data-audit="weather-forecast"]'), b = document.querySelector('[data-audit="weather-estimate"]'); return a && b ? (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? 'forecast first' : 'estimate first') : 'missing' })
        record('7-3: signed out, the Weather tab opens with the seven-day forecast (the destination) and Today keeps its brief outlook', todayStrip === 1 && fcSection === 1 && days >= 7 && order === 'forecast first', `Today strip ${todayStrip} · Weather forecast sections ${fcSection} · day chips ${days} · ${order}`)
        await pubCtx.close()
      }
      for (const d of ['rain-history', 'rain-sources']) { const el = page.locator(`[data-audit="${d}"]`).first(); if (await el.count() && (await el.getAttribute('data-open')) !== 'true') await page.locator(`[data-audit="${d}-summary"]`).first().click().catch(() => {}) }   // Block 7: the chart and the sources expand
      await page.waitForTimeout(500)
      const est = (await page.locator('[data-audit="weather-estimate"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const ytdLabel = (await page.locator('[data-audit="ytd-measured-label"]').innerText().catch(() => '')).trim()
      // The instrument comes from the line that STATES it, not from sniffing the
      // sources footer: that footer names PRISM and NOAA in the same sentence
      // ("a PRISM modeled grid … or the nearest NOAA COOP station when one
      // qualifies"), so /PRISM/ is true whichever instrument is actually in use.
      // It only ever passed while the county happened to be on the grid;
      // Petroleum picked up a qualifying station and the check inverted.
      const sourceLine = (await page.locator('[data-audit="rain-summary-source"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const prism = /County estimate/i.test(sourceLine)
      record('6K: the rainfall figures say what they are — a county estimate (PRISM) or a station gauge — never "Actual"', !/YTD Actual|\bActual:/.test(est) && (ytdLabel === '' ? /rather show nothing|No nearby weather station/.test(est) : prism ? /County estimate/.test(ytdLabel) : /Station gauge/.test(ytdLabel)), `label "${ytdLabel}" · source line "${sourceLine}"`)
      record('6K: the Drought Monitor names its valid date and its release date apart — on the county card and on the map', /Valid [A-Z][a-z]{2} \d{1,2}, \d{4} · released [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(mainText) && /Drought Monitor · valid [A-Z][a-z]{2} \d{1,2}(, \d{4})? · released [A-Z][a-z]{2} \d{1,2}/.test(mainText), `${(mainText.match(/Valid [^·]+· released [^·]{0,20}/) ?? ['no valid/released pill'])[0].slice(0, 60)} · ${(mainText.match(/Drought Monitor · valid [^·]+· released [^·]{0,12}/) ?? ['no map preview'])[0]}`)
    }

    // ── Block 6B (6): Weather in order — forecast · recorded rain · county estimate vs station normal · county drought · drought map ──
    {
      await page.goto(`/weather?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="weather-forecast"]').waitFor({ timeout: 30_000 }).catch(() => {})
      // PAGE ORDER IS NOT ASSERTED HERE ANY MORE — check 7-2 below owns it, in
      // one atomic snapshot. Two reasons this check could not keep doing it:
      //   · it read DOM tree indices one element at a time, with awaits in
      //     between, so a section streaming in mid-sequence shifted every later
      //     index (measured: the same page gave 67<204<213<882<1048 on one run
      //     and 67<1151<200<869<1035 on the next);
      //   · Part 2 moved the ribbon INSIDE the drought card's closed
      //     <details>, and a closed details still lays its content out — the
      //     ribbon measures y=2697 while the map it is supposedly above
      //     measures y=2672. A clipped, unpainted box has no place in a
      //     statement about what the operator sees down the page.
      // What is unique to this check and still true stays: one h1, the title,
      // the PRISM/NOAA footer, the ribbon's wording, and never a zero.
      const hasRain = (await page.locator('[data-audit="recorded-rain"]').count()) > 0
      const zeroRain = /0\.00" .*rain|rain.*0\.00"/i.test(await page.locator('main').innerText().catch(() => ''))
      const title = await page.title()
      const h1 = await page.locator('h1').count()
      // Part 3 replaced RainByPlaceCard with RainOnMyPlaces and renamed these:
      // one row per place, carrying data-state="read" | "none", instead of two
      // separate row hooks. The outer "recorded-rain" hook survived, which is
      // why this check kept finding the section and then counting zero rows.
      const rainRows = await page.locator('[data-audit="rain-place-row"][data-state="read"]').count()
      const noneRows = await page.locator('[data-audit="rain-place-row"][data-state="none"]').count()
      // Part 2 moved the instrument note behind its own "sources" disclosure.
      // innerText is layout-aware, so reading it while that <details> is closed
      // returns "" — measured: innerText 0 chars, textContent 256 with PRISM in
      // it. Open the disclosure and read, which asserts the stronger thing: the
      // words are correct AND the operator can reach them. Nothing that must
      // stay visible is hidden here — the short instrument label ("County
      // estimate · through Sep 8") is outside it, and 7-2 asserts that.
      await page.locator('[data-audit="rain-sources-summary"]').click().catch(() => {})
      await page.waitForTimeout(400)
      const footer = (await page.locator('[data-audit="estimate-footer"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const ribbonLabel = await page.locator('[data-audit="drought-ribbon"]').getAttribute('aria-label').catch(() => null)
      record('6B: Weather says it plainly — recorded rain only when a reading exists, county estimate vs station normal (PRISM/NOAA footer), the drought ribbon in words; one h1; title Weather; never a zero for no reading', /^Weather/.test(title) && h1 === 1 && (hasRain ? rainRows + noneRows >= 1 : !zeroRain) && /PRISM/.test(footer) && /NOAA/.test(footer) && !!ribbonLabel && /three years/.test(ribbonLabel), `title "${title}" · h1 ${h1} · rain rows ${rainRows} + ${noneRows} without a reading · footer "${footer.slice(0, 46)}" · ribbon "${(ribbonLabel ?? '').slice(0, 46)}"`)
      // 6F: no link on the Weather view is dead — every same-site href answers something other than 404 (the audit's /weather/radar).
      const hrefs = [...new Set(await page.locator('main a[href^="/"]').evaluateAll(els => els.map(a => a.getAttribute('href') ?? '')))].filter(h => h && !h.startsWith('/api/'))
      const dead: string[] = []
      for (const h of hrefs) { const r = await page.request.get(h, { maxRedirects: 5 }).catch(() => null); if (!r || r.status() === 404 || r.status() >= 500) dead.push(`${h} → ${r ? r.status() : 'no response'}`) }
      record('6F: every link on the Weather view answers — none is a Page not found', hrefs.length > 0 && dead.length === 0, dead.length ? dead.join(' · ') : `${hrefs.length} links answered`)
    }

    // ── Block 6B (9): at 200% text size on a phone, Record is still reachable ──
    {
      const prior = page.viewportSize()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
      await page.waitForTimeout(500)
      const fab = page.locator('[data-audit="record-fab"]')
      const box = await fab.boundingBox().catch(() => null)
      const vp = page.viewportSize()!
      const inside = !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      await fab.click({ trial: true }).then(() => true).catch(() => false)
      const clickable = await fab.click({ trial: true }).then(() => true).catch(() => false)
      record('6B: at 200% text size Record stays inside the viewport, clickable, and the page does not scroll sideways', inside && clickable && !overflowX, `fab ${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}` : 'none'} in ${vp.width}×${vp.height} · sideways ${overflowX}`)
      await page.evaluate(() => { document.documentElement.style.fontSize = '' })
      if (prior) await page.setViewportSize(prior)
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

    // ── Block 6 (6G): a move and cattle work can name a lot ─────────────────────
    // Optional, "Unassigned" plain; a move records the move and never changes a
    // head count; work against a lot becomes its last recorded work.
    {
      // A fresh lot for this block (the seed lot was archived by an earlier check).
      const lot6g = randomUUID(), LOT6G = `${PREFIX} Pairs`
      const { error: l6Err } = await admin.from('herd_lots').insert({ id: lot6g, ranch_id: ranchId, class: 'cows', name: LOT6G, head_count: 44, avg_weight: 1200, weight_unit: 'lb', created_by: userId, updated_by: userId })
      if (l6Err) throw new Error(`6G lot: ${l6Err.message}`)
      const headBefore = async () => parseInt((await page.locator('[data-audit="lot-row"]').filter({ hasText: LOT6G }).locator('[data-audit="lot-head"]').innerText().catch(() => 'NaN')).replace(/,/g, ''), 10)
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      const head0 = await headBefore()
      // cattle work naming the lot
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: /^Record work/ }).first().click()
      await page.getByRole('button', { name: /^Record cattle work/ }).click()
      await page.getByLabel('Worked').fill('12')
      await page.getByLabel('What').fill('pregged')
      await page.locator('[data-audit="lot-for-work"]').waitFor({ timeout: 15_000 })
      await page.locator('[data-audit="lot-for-work"]').selectOption({ label: LOT6G })
      await page.getByLabel('Where').selectOption({ label: `${PREFIX} West stack` })
      await page.getByRole('button', { name: 'Record work', exact: true }).click()
      await watchStates(page, 'Synced to ranch', 20_000, 'Pregged 12 head')
      const { data: worked } = await admin.from('events').select('id, payload').eq('user_id', userId).eq('type', 'cattle_worked').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      await page.goto(`/ranch/activity/${worked?.id}`, { waitUntil: 'domcontentloaded' })
      const wLot = (await page.locator('[data-audit="event-lot"]').innerText().catch(() => '')).trim(), wWhat = (await page.locator('[data-audit="event-what"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('6G: cattle work names a lot — stored, on the entry, and in the line', worked?.payload?.herd_lot_id === lot6g && wLot === LOT6G && /Pregged 12 head of SMOKE-DAILY-LOOP Pairs at .*West stack/.test(wWhat), `lot "${wLot}" · "${wWhat}"`)
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      const lastWork = (await page.locator('[data-audit="lot-row"]').filter({ hasText: LOT6G }).locator('[data-audit="lot-last-work"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('6G: the lot card\'s last recorded work is the cattle work', /pregged 12 head/.test(lastWork), lastWork.slice(0, 100))
      // a move naming the lot — recorded, and the head count untouched
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: /^Record work/ }).first().click()
      await page.getByRole('button', { name: /^Move cattle/ }).click()
      await page.getByLabel('Moved').fill('5')
      await page.locator('[data-audit="lot-for-move"]').waitFor({ timeout: 15_000 })
      const hintId = await page.locator('[data-audit="lot-for-move"]').getAttribute('aria-describedby')
      const moveHint = hintId ? (await page.locator(`#${hintId}`).innerText().catch(() => '')).replace(/\s+/g, ' ') : ''
      await page.locator('[data-audit="lot-for-move"]').selectOption({ label: LOT6G })
      await page.getByLabel('To').selectOption({ label: `${PREFIX} West stack` })
      await page.getByRole('button', { name: 'Record move', exact: true }).click()
      await watchStates(page, 'Synced to ranch', 20_000, 'Moved 5 head')
      const { data: moved } = await admin.from('events').select('id, payload').eq('user_id', userId).eq('type', 'cattle_moved').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      await page.goto(`/ranch/activity/${moved?.id}`, { waitUntil: 'domcontentloaded' })
      const mLot = (await page.locator('[data-audit="event-lot"]').innerText().catch(() => '')).trim(), mWhat = (await page.locator('[data-audit="event-what"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      const head1 = await headBefore()
      record('6G: a move names a lot, says on the field that it never changes a head count, and the count stays', moved?.payload?.herd_lot_id === lot6g && mLot === LOT6G && /Moved 5 head of SMOKE-DAILY-LOOP Pairs to .*West stack/.test(mWhat) && /never changes a lot/.test(moveHint) && head1 === head0 && Number.isFinite(head0), `lot "${mLot}" · "${mWhat}" · head ${head0} → ${head1} · hint "${moveHint.slice(0, 60)}"`)
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

    // ── Block 6 (6C): the receipt and the Hay balance state one complete equation ──
    // The audit's receipt left the stacked bales out ("323 from your count of
    // 420 … 102 fed since"), so 420 − 102 = 318 looked like a wrong answer.
    // Stack 5, feed 1, and read the equation off the receipt and off the Hay
    // panel: every term present, it adds up, the numbers agree, ranch scope stated.
    {
      const { error: sErr } = await admin.from('events').insert({ user_id: userId, ranch_id: ranchId, device_id: null, type: 'bales_stacked', ts: new Date().toISOString(), schema_version: 1, payload: { source: 'manual', schema_version: 1, count: 5, place_id: placeId } })
      if (sErr) skip('6C: the equation', `could not stack 5 bales: ${sErr.message}`)
      else {
        await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1_000)
        await logFeed(page, 1)
        await watchStates(page, 'Synced to ranch', 20_000, 'Fed 1 bale')
        let strip = ''
        for (let i = 0; i < 32 && !/bales? on hand/.test(strip); i++) { strip = (await page.locator('[role="status"]').first().innerText().catch(() => '')).replace(/\s+/g, ' '); if (!/bales? on hand/.test(strip)) await page.waitForTimeout(250) }
        const EQ = /(\d+) counted [^+]+ \+ (\d+) added \u2212 (\d+) fed = (-?\d+) bales? on hand/
        const m = strip.match(EQ)
        const nums = m ? m.slice(1, 5).map(Number) : null
        const adds = !!nums && nums[0] + nums[1] - nums[2] === nums[3]
        record('6C: the receipt states the complete equation — counted + added − fed = on hand — it adds up, the 5 stacked are in it, ranch scope stated', !!nums && adds && nums[1] === 5 && /across the ranch/.test(strip), m ? `"${m[0]}" · ${/across the ranch/.test(strip) ? 'scope stated' : 'NO scope'}` : `no equation in: ${strip.slice(0, 160)}`)
        await page.goto('/ranch/hay', { waitUntil: 'domcontentloaded' })
        const eq = (await page.locator('[data-audit="hay-equation"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
        const m2 = eq.match(EQ)
        record('6C: the Hay balance states the same equation with the same numbers — one explanation model', !!m2 && !!m && m2.slice(1, 5).join() === m.slice(1, 5).join() && /across the ranch/.test(eq), m2 ? `"${m2[0]}"` : `no equation in: ${eq.slice(0, 160)}`)
      }
    }

    // ── Block 6 (6J): Work under Ranch — cutting and baling have a surface ──────
    // A Scout session is a job (stable id, derived, never an event). The Work
    // section lists it with type, time, machine, origin, quantity and state,
    // filters it by kind, and the Activity record carries it under the same id.
    // A Scout's bale count is bales made — the hay ledger never reads it.
    {
      const EQ = /= (-?\d+) bales? on hand/
      const onHandNow = async () => { await page.goto('/ranch/hay', { waitUntil: 'domcontentloaded' }); const t = (await page.locator('[data-audit="hay-equation"]').innerText().catch(() => '')).replace(/\s+/g, ' '); return parseInt((t.match(EQ) ?? ['', 'NaN'])[1], 10) }
      const hayBefore = await onHandNow()
      const jobId = randomUUID()
      const started = new Date(Date.now() - 2 * 3_600_000).toISOString(), ended = new Date(Date.now() - 3_600_000).toISOString()
      const { error: jErr } = await admin.from('jobs').insert({ id: jobId, user_id: userId, ranch_id: ranchId, device_id: null, hardware_id: 'smoke-scout', started_at: started, ended_at: ended, duration_s: 3600, seq_start: 1, seq_end: 400, event_count: 400, evicted_count: 0, coverage: 1, centroid_lat: 46.94, centroid_lng: -108.19, bbox: {}, track: [], pauses: [], multi_field: false, stats: {}, deriver_version: 'smoke', derived_at: new Date().toISOString() })
      const { error: aErr } = jErr ? { error: null } : await admin.from('job_annotations').insert({ job_id: jobId, user_id: userId, ranch_id: ranchId, name: 'Baling', machine: 'baler', actual_bale_count: 32 })
      if (jErr || aErr) skip('6J: Work under Ranch', `fixture: ${(jErr ?? aErr)!.message.slice(0, 80)}`)
      else {
        await page.goto('/ranch', { waitUntil: 'domcontentloaded' })
        const workSection = (await page.locator('[data-audit="ranch-section"]').filter({ has: page.locator('span', { hasText: /^Work$/ }) }).first().innerText().catch(() => '')).replace(/\s+/g, ' ')
        await page.goto('/ranch/work', { waitUntil: 'domcontentloaded' })
        const row = page.locator('[data-audit="work-list"] > li').filter({ has: page.locator(`[data-id="${jobId}"]`) }).first()
        const rowLi = page.locator(`[data-audit="work-list"] > li[data-id="${jobId}"]`)
        const d = async (k: string) => (await rowLi.locator(`[data-audit="work-${k}"]`).innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        const type = await d('type'), state = await d('state'), machine = await d('machine'), origin = await d('origin'), qty = await d('quantity'), when = await d('when')
        const stockRule = await page.locator('[data-audit="stock-rule"]').count()
        void row
        record('6J: Ranch lists Work as a section with its session count, and the Work page answers type, time, machine, origin, quantity and state — with the stock rule stated', /Work/.test(workSection) && /1 session/.test(workSection) && type === 'Baling' && state === 'ended' && /Machine: baler/.test(machine) && /^Origin: /.test(origin) && /32 bales counted by hand/.test(qty) && /\d – \d|\d –|–/.test(when) && stockRule === 1, `section "${workSection.slice(0, 60)}" · ${type} · ${state} · ${machine} · ${origin} · ${qty} · ${when} · stock rule ${stockRule}`)
        await page.goto('/ranch/work?kind=cutting', { waitUntil: 'domcontentloaded' })
        const cuttingEmpty = await page.locator('[data-audit="work-empty"]').count(), cuttingRows = await page.locator('[data-audit="work-row"]').count()
        await page.goto('/ranch/work?kind=baling', { waitUntil: 'domcontentloaded' })
        const balingRows = await page.locator(`[data-audit="work-list"] > li[data-id="${jobId}"]`).count()
        record('6J: the kind filters hold — Cutting lists nothing (and says so), Baling lists the session', cuttingEmpty === 1 && cuttingRows === 0 && balingRows === 1, `cutting empty ${cuttingEmpty} rows ${cuttingRows} · baling rows ${balingRows}`)
        await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
        const inRecord = page.locator(`[data-audit="activity-list"] li[data-id="${jobId}"] a`)
        const recText = (await inRecord.innerText().catch(() => '')).replace(/\s+/g, ' '), recHref = await inRecord.getAttribute('href').catch(() => null)
        const hayAfter = await onHandNow()
        record('6J: the session is in the Activity record under the same id, opening its job — and the Scout\'s bale count never moved the hay balance', /Baling · 1 h/.test(recText) && /32 bales counted by hand/.test(recText) && recHref === `/jobs/${jobId}` && hayAfter === hayBefore, `"${recText.slice(0, 70)}" → ${recHref} · hay ${hayBefore} → ${hayAfter}`)
      }
    }

    // ── Block 7 (Parts 2–3): Weather in the right order, and Rain on my places ──
    // Two readings by two people at two places, a third place with none. Every
    // place gets a row: the latest reading, its day, who recorded it; a missing
    // reading is missing, never zero; totals are Recorded rain; the history
    // expands; Log rain opens the sheet on Rain with the place chosen. And the
    // order: (warning) → forecast → rain on my places → county rainfall summary
    // (chart and sources behind disclosures) → drought leading with its category.
    {
      const mk = async (name: string, kind: string) => { const { data, error } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} ${name}`, kind }).select('id').single(); if (error) throw new Error(`7-3 place: ${error.message}`); return data.id as string }
      const northId = await mk('North pasture', 'pasture'), auditId = await mk('Audit field', 'field')
      const rain = async (uid: string, place: string, inchesIn: number, daysAgo: number) => { const { error } = await admin.from('events').insert({ user_id: uid, ranch_id: ranchId, device_id: null, type: 'rain', ts: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), schema_version: 1, payload: { source: 'manual', schema_version: 1, inches: inchesIn, place_id: place } }); if (error) throw new Error(`7-3 rain: ${error.message}`) }
      await rain(userId, placeId, 0.35, 3)
      await rain(userIdB, northId, 0.8, 1)
      await page.goto(`/weather?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="rain-on-my-places"]').waitFor({ timeout: 30_000 }).catch(() => {})
      const rowText = async (id: string) => (await page.locator(`[data-audit="rain-place-row"][data-place="${id}"]`).innerText().catch(() => '')).replace(/\s+/g, ' ')
      const north = await rowText(northId), west = await rowText(placeId), audit = await rowText(auditId)
      const section = (await page.locator('[data-audit="rain-on-my-places"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      // The day is fmtDay's short style — "Tue, Sep 8, 2026" — asserted exactly,
      // not loosely: this is the one day format the whole app uses (places,
      // activity, work), and PK settled it here on 2026-09-10 rather than let
      // Rain on my places grow a compact one of its own. The rain SUMMARY line
      // above it still renders a bare "Sep 8" from a different formatter; that
      // inconsistency is known and left alone deliberately, so if either side
      // ever moves, this regex is what notices.
      const DAY = String.raw`[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{4}`
      const rowRe = (inches: string, who: string) => new RegExp(`${inches}" \u00b7 ${DAY} \u00b7 recorded by ${who}`)
      record('7-3: every place has a row — the latest reading, its day, who recorded it; a place with no reading says so and never shows zero', rowRe('0\\.80', 'smoke-daily-loop-b').test(north) && rowRe('0\\.35', 'Smoke A').test(west) && /no rain recorded yet/.test(audit) && !/0\.00/.test(audit) && /Recorded rain/.test(section) && !/rainfall/i.test(section), `north "${north.slice(0, 70)}" · west "${west.slice(0, 60)}" · audit "${audit.slice(0, 60)}"`)
      await page.locator(`[data-audit="rain-history-${northId}-summary"]`).click().catch(() => {})
      const hist = (await page.locator(`[data-audit="rain-history-${northId}"] [data-audit="rain-readings"]`).innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('7-3: a row expands to its history — each reading with its day and who recorded it', /recorded by smoke-daily-loop-b/.test(hist) && /0\.80"/.test(hist), hist.slice(0, 80))
      await page.locator(`[data-audit="rain-place-row"][data-place="${auditId}"] [data-audit="log-rain-here"]`).click()
      await page.getByLabel('Where').waitFor({ timeout: 10_000 }).catch(() => {})
      // The sheet fetches /api/places when it opens, and a <select> cannot show
      // a pre-chosen value before that value's <option> exists. Reading
      // inputValue() the instant the select appears races the fetch and returns
      // "" every time. Check 2F above already waits for the option; this one
      // did not. Measured: "" with 2 options loaded, then the right id once the
      // option attaches.
      await page.getByLabel('Where').locator(`option[value="${auditId}"]`).waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
      const wherePre = await page.getByLabel('Where').inputValue().catch(() => '')
      const rainField = await page.getByLabel('Rain').count()
      record('7-3: Log rain on a row opens the record sheet on Rain with that place chosen', rainField >= 1 && wherePre === auditId, `Where=${wherePre.slice(0, 8)}… · rain field ${rainField}`)
      await page.keyboard.press('Escape').catch(() => {})
      await page.goto(`/weather?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="county-drought"]').waitFor({ timeout: 30_000 }).catch(() => {})
      const orderIds = ['weather-warning', 'weather-forecast', 'rain-on-my-places', 'weather-estimate', 'county-drought', 'weather-drought-map']
      // ONE snapshot, not six awaited reads: the Weather body streams, and
      // measuring section by section let a late arrival land at y=0 (present in
      // the DOM, no box yet) and read as "above everything". Wait until every
      // section that is on the page has a real box, then take all positions in
      // a single evaluate so they describe one moment.
      const measure = async () => await page.evaluate((ids: string[]) => ids.map(id => {
        const el = document.querySelector(`[data-audit="${id}"]`)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return r.height > 0 ? Math.round(r.top + window.scrollY) : 0
      }), orderIds)
      let ys = await measure()
      for (let i = 0; i < 30 && ys.some(y => y === 0); i++) { await page.waitForTimeout(500); ys = await measure() }
      const present = ys.map((y, i) => ({ id: orderIds[i], y })).filter(x => x.y != null) as { id: string; y: number }[]
      const laidOut = present.every(x => x.y > 0)
      const inOrder = laidOut && present.every((x, i) => i === 0 || x.y > present[i - 1].y)
      record('7-2: Weather runs warning (when present) → forecast → rain on my places → county rainfall → drought → map', inOrder && present.length >= 5 && present[present[0].id === 'weather-warning' ? 1 : 0].id === 'weather-forecast', present.map(x => `${x.id}@${x.y}`).join(' < '))
      const summary = (await page.locator('[data-audit="rain-summary-line"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const summarySrc = (await page.locator('[data-audit="rain-summary-source"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      // A native <details> keeps its content LAID OUT while closed — the browser
      // clips it, it does not unmount it. So counting .recharts-wrapper (or
      // measuring its height) reads the same open or closed, and this check
      // could never have passed. Measured on the real page: the card grows
      // 100px → 257px, the chart's own box reports 203px in BOTH states.
      // Disclosure publishes the one honest signal itself — data-open on the
      // details — so read that, and keep a presence check so a chart that
      // disappears entirely is still caught.
      const rainHist = page.locator('[data-audit="rain-history"]')
      if ((await rainHist.getAttribute('data-open')) === 'true') { await page.locator('[data-audit="rain-history-summary"]').click().catch(() => {}); await page.waitForTimeout(400) }
      const rainClosed = await rainHist.getAttribute('data-open')
      const chartsBefore = await page.locator('[data-audit="weather-estimate"] .recharts-wrapper').count()
      await page.locator('[data-audit="rain-history-summary"]').click().catch(() => {})
      await page.waitForTimeout(1_500)
      const rainOpened = await rainHist.getAttribute('data-open')
      const chartsAfter = await page.locator('[data-audit="weather-estimate"] .recharts-wrapper').count()
      record('7-2: county rainfall reads as one answer — inches this year against station normal, county estimate or station gauge, through when — with the history behind View history', /^[\d.]+" this year · [\d.]+" (below|above) station normal$/.test(summary) && /^(County estimate|Station gauge) · through [A-Z][a-z]{2} \d{1,2}$/.test(summarySrc) && rainClosed === 'false' && rainOpened === 'true' && chartsBefore === 1 && chartsAfter === 1, `"${summary}" · "${summarySrc}" · history ${rainClosed} → ${rainOpened} · charts ${chartsBefore} → ${chartsAfter}`)
      const droughtCard = page.locator('[data-audit="county-drought"]')
      const droughtText = (await droughtCard.innerText().catch(() => '')).replace(/\s+/g, ' ')
      // Same native-<details> fact as the rainfall history above: a closed
      // disclosure still lays its ribbon out, so a visible-height count reads 1
      // either way. Read the state the component publishes.
      const droughtHist = page.locator('[data-audit="drought-history"]')
      if ((await droughtHist.getAttribute('data-open')) === 'true') { await page.locator('[data-audit="drought-history-summary"]').click().catch(() => {}); await page.waitForTimeout(400) }
      const ribbonClosed = await droughtHist.getAttribute('data-open')
      const ribbonBefore = await droughtCard.locator('[role="img"]').count()
      await page.locator('[data-audit="drought-history-summary"]').click().catch(() => {})
      await page.waitForTimeout(500)
      const ribbonOpened = await droughtHist.getAttribute('data-open')
      const ribbonAfter = await droughtCard.locator('[role="img"]').count()
      record('7-2: drought leads with its category and valid date; the three-year ribbon expands', /D\d · [A-Z][a-z]+ (drought|dry)|No drought/.test(droughtText) && /Valid [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(droughtText) && ribbonClosed === 'false' && ribbonOpened === 'true' && ribbonBefore >= 1 && ribbonAfter >= 1, `${(droughtText.match(/D\d · [^·]{0,20}|No drought/) ?? [''])[0]} · history ${ribbonClosed} → ${ribbonOpened} · ribbon ${ribbonBefore} → ${ribbonAfter}`)
      await page.locator('[data-audit="forecast-strip"] button').first().click().catch(() => {})
      const dayDetail = (await page.locator('[data-audit="forecast-day-detail"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('7-2: tapping a forecast day gives the chance of rain, the wind and the text', /chance of rain/.test(dayDetail) && /wind/.test(dayDetail), dayDetail.slice(0, 100))
    }

    // ── Block 6 (6A): single-field corrections preserve every other field ──────
    // The Sept 8 audit: a quantity-only correction wrote nulls over the lot and
    // place. Every check here changes ONE thing through the form and reads the
    // effective entry back through the chain, field by field — fast and slow
    // option loads, owner and member entries, a retired lot, a lot the ranch no
    // longer lists at all, and the explicit Clear as the only path to null.
    {
      const probe = await admin.from('events').select('superseded_by').limit(1)
      if (probe.error) skip('6A: single-field corrections', `migration 054 not applied (${probe.error.message.slice(0, 60)})`)
      else {
        const { data: east, error: eErr } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} East pasture`, kind: 'pasture' }).select('id').single()
        if (eErr) throw new Error(`6A place: ${eErr.message}`)
        const eastId = east.id as string
        const lot2 = randomUUID()
        const { error: l2Err } = await admin.from('herd_lots').insert({ id: lot2, ranch_id: ranchId, class: 'heifers', name: `${PREFIX} Heifers`, head_count: 20, avg_weight: 500, weight_unit: 'lb', created_by: userId, updated_by: userId })
        if (l2Err) throw new Error(`6A lot: ${l2Err.message}`)
        type Row = { id: string; ts: string; user_id: string; payload: Record<string, unknown>; superseded_by: string | null }
        // An original the audit's shape: lot, place, note, stock source, a work time with seconds.
        const original = async (uid: string, lot: string | null): Promise<Row> => {
          const ts = new Date(Date.now() - 3_600_000 - Math.floor(Math.random() * 60_000)).toISOString()
          const { data, error } = await admin.from('events').insert({ user_id: uid, ranch_id: ranchId, device_id: null, type: 'hay_fed', ts, schema_version: 1,
            payload: { source: 'manual', schema_version: 1, bales: 3, herd_lot_id: lot, place_id: eastId, note: 'smoke 6A: the note', stock_place_id: placeId } }).select('id, ts, user_id, payload, superseded_by').single()
          if (error) throw new Error(`6A fixture: ${error.message}`)
          return data as Row
        }
        const head = async (id: string): Promise<Row> => {
          let cur = id
          for (let i = 0; i < 10; i++) { const { data } = await admin.from('events').select('id, ts, user_id, payload, superseded_by').eq('id', cur).single(); const r = data as Row; if (!r.superseded_by) return r; cur = r.superseded_by }
          throw new Error('6A: chain too long')
        }
        // Every payload key but the ones named reads back byte-identical; the work time too, unless it was the change.
        const preserved = (before: Row, after: Row, except: string[]) => {
          const keys = Array.from(new Set([...Object.keys(before.payload), ...Object.keys(after.payload)])).filter(k => !except.includes(k))
          const bad = keys.filter(k => JSON.stringify(before.payload[k]) !== JSON.stringify(after.payload[k]))
          if (!except.includes('ts') && before.ts !== after.ts) bad.push('ts')
          return bad
        }
        const describe = (bad: string[], now: Row) => bad.length ? `lost or changed: ${bad.join(', ')} · now ${JSON.stringify(now.payload)}` : `every other field kept · ${JSON.stringify(now.payload)}`
        const correct = async (p: Page, id: string, act: (p: Page) => Promise<void>, reason: string) => {
          await p.goto(`/ranch/activity/${id}`, { waitUntil: 'domcontentloaded' })
          await p.locator('[data-audit="correct-entry"]').click()
          await p.locator('[data-audit="correction-options"][data-state="ready"]').waitFor({ state: 'attached', timeout: 20_000 })
          await act(p)
          await p.locator('[data-audit="correction-reason"]').fill(reason)
          await p.locator('[data-audit="correction-save"]').click()
          await p.waitForURL(/\/activity\/[0-9a-f-]{36}\?saved=1/, { timeout: 30_000 }).catch(() => {})
        }

        // 1 · quantity-only on a fast load, the owner's entry
        {
          const o = await original(userId, lotId)
          await correct(page, o.id, async p => { await p.getByLabel('Bales', { exact: true }).fill('2') }, '6A quantity only')
          const h = await head(o.id); const bad = preserved(o, h, ['bales'])
          record('6A: a quantity-only correction keeps lot, place, note, stock source and the exact work time', h.id !== o.id && h.payload.bales === 2 && bad.length === 0, describe(bad, h))
          // 6E: the optional fields read back on the entry — the note, and the stack the hay was taken from.
          await page.goto(`/ranch/activity/${h.id}`, { waitUntil: 'domcontentloaded' })
          const noteRow = (await page.locator('[data-audit="event-note"]').innerText().catch(() => '')).trim()
          const takenRow = (await page.locator('[data-audit="event-taken-from"]').innerText().catch(() => '')).trim()
          record('6E: the event detail shows the note and the stack the hay was taken from', noteRow === 'smoke 6A: the note' && /West stack/.test(takenRow), `note "${noteRow}" · taken from "${takenRow}"`)
        }
        // 2 · quantity-only on a SLOW option load: the form holds; the stored ids are the draft before any name arrives
        {
          const o = await original(userId, lotId)
          await page.route('**/api/activity/options', async r => { await new Promise(res => setTimeout(res, 3_000)); await r.continue() })
          await page.goto(`/ranch/activity/${o.id}`, { waitUntil: 'domcontentloaded' })
          await page.locator('[data-audit="correct-entry"]').click()
          await page.locator('[data-audit="correction-options"][data-state="loading"]').waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
          const heldSave = await page.locator('[data-audit="correction-save"]').isDisabled()
          const heldLot = await page.locator('[data-audit="correction-herd_lot_id"]').inputValue().catch(() => '')
          const heldPlace = await page.locator('[data-audit="correction-place_id"]').inputValue().catch(() => '')
          record('6A: while the names load the form is held and the stored lot and place ids are already the draft', heldSave && heldLot === lotId && heldPlace === eastId, `save disabled=${heldSave} · lot=${heldLot.slice(0, 8)} · place=${heldPlace.slice(0, 8)}`)
          await page.locator('[data-audit="correction-options"][data-state="ready"]').waitFor({ state: 'attached', timeout: 20_000 })
          const lotAfter = await page.locator('[data-audit="correction-herd_lot_id"]').inputValue()
          await page.getByLabel('Bales', { exact: true }).fill('2')
          await page.locator('[data-audit="correction-reason"]').fill('6A slow load')
          await page.locator('[data-audit="correction-save"]').click()
          await page.waitForURL(/\?saved=1/, { timeout: 30_000 }).catch(() => {})
          await page.unroute('**/api/activity/options')
          const h = await head(o.id); const bad = preserved(o, h, ['bales'])
          record('6A: a slow option load rewrites nothing — the quantity-only correction still keeps every other field', lotAfter === lotId && h.payload.bales === 2 && bad.length === 0, `lot after load=${lotAfter.slice(0, 8)} · ${describe(bad, h)}`)
        }
        // 3–8 · one chain: lot-only, place-only, date-only, reason-only, a retired lot, the explicit Clear
        {
          const o = await original(userId, lotId)
          await correct(page, o.id, async p => { await p.locator('[data-audit="correction-herd_lot_id"]').selectOption(lot2) }, '6A lot only')
          const h1 = await head(o.id); const bad1 = preserved(o, h1, ['herd_lot_id'])
          record('6A: a lot-only correction changes the lot and nothing else', h1.payload.herd_lot_id === lot2 && bad1.length === 0, describe(bad1, h1))
          await correct(page, h1.id, async p => { await p.locator('[data-audit="correction-place_id"]').selectOption(placeId) }, '6A place only')
          const h2 = await head(o.id); const bad2 = preserved(h1, h2, ['place_id'])
          record('6A: a place-only correction changes the place and nothing else', h2.payload.place_id === placeId && bad2.length === 0, describe(bad2, h2))
          const dayBefore = (iso: string) => { const d = new Date(iso); d.setDate(d.getDate() - 1); const pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
          await correct(page, h2.id, async p => { await p.getByLabel('Work date').fill(dayBefore(h2.ts)) }, '6A date only')
          const h3 = await head(o.id); const bad3 = preserved(h2, h3, ['ts'])
          const a = new Date(h2.ts), b = new Date(h3.ts)
          const movedOneDay = a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes() && Math.round((a.getTime() - b.getTime()) / 3_600_000) === 24
          record('6A: a date-only correction moves the work time one day and keeps every value', movedOneDay && bad3.length === 0, `${h2.ts} → ${h3.ts} · ${describe(bad3, h3)}`)
          // reason-only: the reason is part of the record — a new reason alone lands as a correction, every value and the time kept
          await correct(page, h3.id, async () => {}, '6A reason only')
          const h4 = await head(o.id); const bad4 = preserved(h3, h4, [])
          const { data: r4 } = await admin.from('events').select('correction_reason').eq('id', h4.id).single()
          record('6A: a reason-only correction lands as a correction — the reason recorded, every value and the time kept', h4.id !== h3.id && r4?.correction_reason === '6A reason only' && bad4.length === 0, `reason "${r4?.correction_reason}" · ${describe(bad4, h4)}`)
          // the same reason again, nothing else different: refused as nothing changed, reason included; the entry untouched
          await page.goto(`/ranch/activity/${h4.id}`, { waitUntil: 'domcontentloaded' })
          await page.locator('[data-audit="correct-entry"]').click()
          await page.locator('[data-audit="correction-options"][data-state="ready"]').waitFor({ state: 'attached', timeout: 20_000 })
          await page.locator('[data-audit="correction-reason"]').fill('6A reason only')
          await page.locator('[data-audit="correction-save"]').click()
          const refusal = await page.locator('[data-audit="correction-error"]').innerText({ timeout: 5_000 }).catch(() => '')
          const h4b = await head(o.id)
          record('6A: nothing changed means no field differs, reason included — the same reason again is refused and the entry untouched', /Nothing changed/.test(refusal) && h4b.id === h4.id, `"${refusal.slice(0, 70)}" · head ${h4b.id === h4.id ? 'unchanged' : 'MOVED'}`)
          // the lot is retired: the form names it as retired and a quantity-only correction keeps it
          const { error: rErr } = await admin.from('herd_lots').update({ retired_at: new Date().toISOString() }).eq('id', lot2)
          if (rErr) throw new Error(`6A retire: ${rErr.message}`)
          let retiredLabel = ''
          await correct(page, h4.id, async p => { retiredLabel = await p.locator('[data-audit="correction-herd_lot_id"] option:checked').innerText().catch(() => ''); await p.getByLabel('Bales', { exact: true }).fill('1') }, '6A retired lot')
          const h5 = await head(o.id); const bad5 = preserved(h4, h5, ['bales'])
          record('6A: a retired lot is named as retired on the form and a quantity-only correction keeps it', /retired/.test(retiredLabel) && h5.payload.herd_lot_id === lot2 && h5.payload.bales === 1 && bad5.length === 0, `option "${retiredLabel}" · ${describe(bad5, h5)}`)
          // the explicit Clear is the only path to null: the lot goes, the place and the rest stay
          await correct(page, h5.id, async p => { await p.locator('[data-audit="correction-clear-herd_lot_id"]').click() }, '6A clear lot')
          const h6 = await head(o.id); const bad6 = preserved(h5, h6, ['herd_lot_id'])
          record('6A: Clear lot is explicit — the lot goes to none and the place, note and stock source stay', h6.payload.herd_lot_id === null && bad6.length === 0, describe(bad6, h6))
        }
        // 9 · a lot the ranch no longer lists at all: shown unresolved, kept
        {
          const ghost = randomUUID()
          const o = await original(userId, ghost)
          let unresolved = '', shown = ''
          await correct(page, o.id, async p => { unresolved = await p.locator('[data-audit="correction-unresolved-herd_lot_id"]').innerText().catch(() => ''); shown = await p.locator('[data-audit="correction-herd_lot_id"]').inputValue(); await p.getByLabel('Bales', { exact: true }).fill('2') }, '6A unresolved lot')
          const h = await head(o.id); const bad = preserved(o, h, ['bales'])
          record('6A: a lot the ranch no longer lists is shown as unresolved and kept through a quantity-only correction', /isn.t on the ranch/.test(unresolved) && shown === ghost && h.payload.herd_lot_id === ghost && bad.length === 0, `"${unresolved.slice(0, 50)}" · ${describe(bad, h)}`)
        }
        // 10 · a member's own entry, corrected by the member
        {
          const ctxM = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
          const pageM = await signIn(ctxM, EMAIL_B)
          const o = await original(userIdB, lotId)
          await correct(pageM, o.id, async p => { await p.getByLabel('Bales', { exact: true }).fill('2') }, '6A member quantity only')
          const h = await head(o.id); const bad = preserved(o, h, ['bales'])
          record("6A: a member's quantity-only correction of their own entry keeps every other field", h.user_id === userIdB && h.payload.bales === 2 && bad.length === 0, describe(bad, h))
          await ctxM.close()
        }
      }
    }

    // ── Block 6 (6B): superseded entries marked the same way on every timeline ──
    // The audit read a place timeline with the original and the correction as
    // two ordinary rows: two feedings. Operational lists (a place, the Ranch
    // hub, Today's Activity tab) show the EFFECTIVE entry marked "corrected"
    // with what it replaced one tap away; the Activity record (audit history)
    // shows every revision, the replaced original struck and marked.
    {
      const { data: four } = await admin.from('events').select('id, supersedes_event_id').eq('user_id', userId).eq('type', 'hay_fed').eq('payload->>bales', '4').not('supersedes_event_id', 'is', null).order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      if (!four) skip('6B: timelines', 'the gate-4 correction (6 → 4) is not on the record')
      else {
        // One list, read the same way everywhere: rows as [text, marker, chain text].
        const readList = async (p: Page, sel: string) => p.locator(`${sel} > li`).evaluateAll(els => els.map(li => ({
          id: li.getAttribute('data-id') ?? '',
          text: (li.querySelector('a')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          marker: li.getAttribute('data-marker') ?? 'none',
          chain: (li.querySelector('[data-audit="row-chain"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        })))
        // By identity, not by text (another 6-bale feeding may legitimately stand): the replaced
        // original's id must not be a row; the correction's id must be, marked, with the chain.
        const operational = (rows: { id: string; text: string; marker: string; chain: string }[]) => {
          const original = rows.filter(r => r.id === four.supersedes_event_id)
          const fourRow = rows.find(r => r.id === four.id)
          const replaced = rows.filter(r => r.marker === 'replaced' || r.marker === 'voided')
          const ok = original.length === 0 && replaced.length === 0 && !!fourRow && /Fed 4 bales/.test(fourRow.text) && fourRow.marker === 'corrected' && /Fed 6 bales/.test(fourRow.chain) && /was 4, typed 6/.test(fourRow.chain)
          return { ok, detail: `rows ${rows.length} · the replaced original as a row: ${original.length} · replaced/voided rows: ${replaced.length} · the correction → ${fourRow ? `"${fourRow.text.slice(0, 40)}" ${fourRow.marker}, chain "${fourRow.chain.slice(0, 70)}"` : 'MISSING'}` }
        }
        await page.goto(`/ranch/places/${placeId}`, { waitUntil: 'domcontentloaded' })
        const placeRows = operational(await readList(page, '[data-audit="place-activity"]'))
        record('6B: the place timeline shows one feeding — the effective "Fed 4 bales" marked corrected, "Fed 6 bales" only inside what it replaced', placeRows.ok, placeRows.detail)
        await page.goto('/ranch', { waitUntil: 'domcontentloaded' })
        // 7B.2: the hub opens on two rows. Open it before reading — the invariant
        // is about how a correction is marked WHEREVER it appears, so the whole
        // list is the subject, not the first screenful. This reads more of the
        // hub than the check ever did before, when it saw at most five rows.
        await page.locator('[data-audit="ranch-recent-more"]').evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {})
        await page.locator('[data-audit="ranch-recent-more"]').click({ timeout: 5_000 }).catch(() => {})
        await page.waitForTimeout(600)
        const hubRows = operational(await readList(page, '[data-audit="ranch-recent"]'))
        record('6B: the Ranch hub marks the same entry the same way — no replaced original as an ordinary row', hubRows.ok, hubRows.detail)
        await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await page.getByRole('tab', { name: 'Activity', exact: true }).click().catch(() => {})
        await page.locator('[data-audit="logged-row"]').first().waitFor({ timeout: 15_000 }).catch(() => {})
        const todayRows = await page.locator('[data-audit="logged-row"]').evaluateAll(els => els.map(a => ({ id: a.closest('li')?.getAttribute('data-id') ?? '', text: (a.textContent ?? '').replace(/\s+/g, ' ').trim(), marker: a.closest('li')?.getAttribute('data-marker') ?? 'none' })))
        const todayFour = todayRows.find(r => r.id === four.id), todayOrig = todayRows.filter(r => r.id === four.supersedes_event_id)
        record('6B: Today\'s Activity tab — the effective feeding marked corrected, the replaced original absent', !!todayFour && /Fed 4 bales/.test(todayFour.text) && todayFour.marker === 'corrected' && todayOrig.length === 0, `rows ${todayRows.length} · the correction → ${todayFour ? `"${todayFour.text.slice(0, 40)}" ${todayFour.marker}` : 'MISSING'} · the original as a row: ${todayOrig.length}`)
        await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
        const history = await readList(page, '[data-audit="activity-list"]')
        const hSix = history.find(r => r.id === four.supersedes_event_id), hFour = history.find(r => r.id === four.id)
        const struck = await page.locator('[data-audit="activity-list"] li[data-marker="replaced"] s').count()
        record('6B: the Activity record keeps every revision — the original struck and marked replaced, the correction marked corrected', !!hSix && hSix.marker === 'replaced' && /replaced/.test(hSix.text) && !!hFour && hFour.marker === 'corrected' && /corrected/.test(hFour.text) && struck >= 1, `Fed 6 → ${hSix?.marker ?? 'MISSING'} · Fed 4 → ${hFour?.marker ?? 'MISSING'} · struck ${struck}`)
      }
    }

    // ── Block 6 (6B-2): a void stands on every operational timeline — marked, greyed, not counted ──
    // PK: a void is a fact about the day. The hand who logged it must never find
    // his entry gone with no explanation; "caught up" never means an entry
    // vanished. Void a feeding through the form and read it back off the place,
    // the Ranch hub and Today's Activity tab, marked "voided", with the balance unmoved.
    {
      const EQ = /= (-?\d+) bales? on hand/
      const onHandNow = async () => { await page.goto('/ranch/hay', { waitUntil: 'domcontentloaded' }); const t = (await page.locator('[data-audit="hay-equation"]').innerText().catch(() => '')).replace(/\s+/g, ' '); return parseInt((t.match(EQ) ?? ['', 'NaN'])[1], 10) }
      const before = await onHandNow()   // read BEFORE the feeding: feed 7 then void it must net to zero
      const { data: v0 } = await admin.from('events').insert({ user_id: userId, ranch_id: ranchId, device_id: null, type: 'hay_fed', ts: new Date().toISOString(), schema_version: 1, payload: { source: 'manual', schema_version: 1, bales: 7, herd_lot_id: lotId, place_id: placeId } }).select('id').single()
      if (!v0) skip('6B-2: voids', 'could not seed the feeding to void')
      else {
        const fed = await onHandNow()
        await page.goto(`/ranch/activity/${v0.id}`, { waitUntil: 'domcontentloaded' })
        await page.locator('[data-audit="void-entry"]').click()
        await page.locator('[data-audit="correction-reason"]').fill('6B-2 never happened')
        await page.locator('[data-audit="correction-save"]').click()
        await page.waitForURL(/\/activity\/[0-9a-f-]{36}\?saved=1/, { timeout: 30_000 }).catch(() => {})
        const voidId = (page.url().match(/\/activity\/([0-9a-f-]{36})/) ?? ['', ''])[1]
        const after = await onHandNow()
        const readRows = async (sel: string) => page.locator(`${sel} > li`).evaluateAll(els => els.map(li => ({ id: li.getAttribute('data-id') ?? '', marker: li.getAttribute('data-marker') ?? 'none', text: (li.querySelector('a')?.textContent ?? '').replace(/\s+/g, ' ').trim(), grey: !!li.querySelector('a span.text-secondary-ink'), chain: (li.querySelector('[data-audit="row-chain"]')?.textContent ?? '').replace(/\s+/g, ' ') })))
        await page.goto(`/ranch/places/${placeId}`, { waitUntil: 'domcontentloaded' })
        const pl = (await readRows('[data-audit="place-activity"]')).find(r => r.id === voidId)
        const plOrig = (await readRows('[data-audit="place-activity"]')).filter(r => r.id === v0.id)
        record('6B-2: the voided feeding stands on the place timeline — marked voided, greyed, what it voided one tap away; the original not a second row', !!pl && pl.marker === 'voided' && /voided/.test(pl.text) && pl.grey && /Fed 7 bales/.test(pl.chain) && plOrig.length === 0, pl ? `"${pl.text.slice(0, 50)}" · grey ${pl.grey} · chain "${pl.chain.slice(0, 60)}" · original rows ${plOrig.length}` : `void row ${voidId.slice(0, 8)} MISSING`)
        await page.goto('/ranch', { waitUntil: 'domcontentloaded' })
        const hub = (await readRows('[data-audit="ranch-recent"]')).find(r => r.id === voidId)
        await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await page.getByRole('tab', { name: 'Activity', exact: true }).click().catch(() => {})
        await page.locator('[data-audit="logged-row"]').first().waitFor({ timeout: 15_000 }).catch(() => {})
        const today = (await page.locator('[data-audit="logged-row"]').evaluateAll(els => els.map(a => ({ id: a.closest('li')?.getAttribute('data-id') ?? '', marker: a.closest('li')?.getAttribute('data-marker') ?? 'none' })))).find(r => r.id === voidId)
        record('6B-2: the Ranch hub and Today\'s Activity tab keep the void, marked the same way — never hidden', !!hub && hub.marker === 'voided' && !!today && today.marker === 'voided', `hub ${hub?.marker ?? 'MISSING'} · today ${today?.marker ?? 'MISSING'}`)
        record('6B-2: the void counts toward no balance — the 7 bales fed then voided leave hay on hand where it was', Number.isFinite(before) && fed === before - 7 && after === before, `on hand ${before} → fed ${fed} → voided ${after}`)
      }
    }

    // ── Block 6 (6D): a save refreshes what it changed, from every entry point ──
    // The audit saved a feeding from Ranch: the sheet closed, the hub still read
    // the old bales and the old recent rows. Record from the Ranch hub's FAB and,
    // without navigating, watch the hub's Hay number and its recent list follow
    // the sync — with the receipt strip on that page.
    {
      const prior6d = page.viewportSize()
      await page.setViewportSize({ width: 390, height: 844 })   // the FAB is the phone's entry point (md:hidden)
      await page.goto('/ranch', { waitUntil: 'domcontentloaded' })
      const hayNumber = async () => parseInt(((await page.locator('[data-audit="ranch-section"]', { hasText: 'Hay' }).locator('[data-audit="section-number"]').innerText().catch(() => '')).match(/(\d+) bales? on hand/) ?? ['', 'NaN'])[1], 10)
      const beforeHay = await hayNumber()
      const firstBefore = (await page.locator('[data-audit="ranch-recent"] > li a').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
      await logFeed(page, 2)
      const strip = page.locator('[data-audit="global-save-status"] [role="status"]')
      let stripText = ''
      for (let i = 0; i < 80 && !/Synced to ranch/.test(stripText); i++) { stripText = (await strip.innerText().catch(() => '')).replace(/\s+/g, ' '); if (!/Synced to ranch/.test(stripText)) await page.waitForTimeout(250) }
      record('6D: recorded from the Ranch hub, the receipt strip stands on that page and reaches Synced to ranch', /Synced to ranch/.test(stripText) && /2 bales recorded/.test(stripText) && /on hand/.test(stripText), stripText.slice(0, 140) || 'no strip')
      let afterHay = NaN, firstAfter = ''
      for (let i = 0; i < 60 && afterHay !== beforeHay - 2; i++) { afterHay = await hayNumber(); firstAfter = (await page.locator('[data-audit="ranch-recent"] > li a').first().innerText().catch(() => '')).replace(/\s+/g, ' '); if (afterHay !== beforeHay - 2) await page.waitForTimeout(500) }
      record('6D: without navigating, the hub\'s Hay number and its recent rows follow the sync', Number.isFinite(beforeHay) && afterHay === beforeHay - 2 && /Fed 2 bales/.test(firstAfter) && firstAfter !== firstBefore && /\/ranch$/.test(page.url().replace(/\?.*$/, '')), `hay ${beforeHay} → ${afterHay} · first row "${firstAfter.slice(0, 50)}" · ${page.url().replace(BASE, '')}`)
      if (prior6d) await page.setViewportSize(prior6d)
    }

    // ── Block 7B.2: the Ranch hub opens its recent rows in place ──────────
    // Five rows and a navigation was the only way further down a list the page
    // had already read. Two rows now, the rest revealed in place — and "in
    // place" is the whole claim, so it is tested as one: no request, no URL
    // change, the Sections list (and its Activity link) still on the page.
    {
      const prior7b = page.viewportSize()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/ranch', { waitUntil: 'domcontentloaded' })
      // Drop the SYNCED receipt the 6D check above deliberately leaves up. It is
      // pinned to the bottom of the viewport for 90 s and it is the previous
      // check's state, not this one's subject — the same clean-up 7.4 needed
      // when a restored half-typed sheet sat on top of the FAB. Only synced
      // entries go: anything genuinely unsynced is real work and stays.
      await page.evaluate((k: string) => {
        try {
          const raw = localStorage.getItem(k)
          if (!raw) return
          const kept = (JSON.parse(raw) as { state: string }[]).filter(i => i.state !== 'synced')
          localStorage.setItem(k, JSON.stringify(kept))
        } catch { /* no outbox, nothing to clear */ }
      }, 'dryline_outbox_v1')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_500)
      const liCount = () => page.locator('[data-audit="ranch-recent"] > li').count()
      // This page has a fixed overlay at BOTH ends. The save receipt is pinned
      // to the bottom for 90 s (RecordSheetHost, fadeAfterMs 90_000) and the 6D
      // check immediately above deliberately leaves one up; the site header is
      // sticky at the top. Playwright's own auto-scroll put the button under
      // the receipt, and scrolling it to `start` put it under the header — two
      // crashed runs, one for each end. `center` is the clear band between
      // them, which is where a person reading the list has it anyway.
      //
      // The click is also no longer allowed to take the run down with it. A
      // 30 s actionability timeout inside a 25-minute suite should be one red
      // line naming what intercepted the tap, not an exception that discards
      // every check after it.
      const tapMore = async (): Promise<string | null> => {
        const btn = page.locator('[data-audit="ranch-recent-more"]')
        try {
          await btn.evaluate(el => el.scrollIntoView({ block: 'center' }))
          await page.waitForTimeout(200)
          await btn.click({ timeout: 15_000 })
          return null
        } catch (e) {
          // Say WHAT was on top, not just that the click timed out. Playwright
          // names the interceptor in its call log, and elementFromPoint at the
          // button's own centre says it independently — a bare "Timeout 15000ms
          // exceeded" sent me guessing at overlays twice.
          const msg = (e instanceof Error ? e.message : String(e)).split('\n')
          const intercept = msg.find(l => l.includes('intercepts pointer events'))?.trim()
          const onTop = await btn.evaluate(el => {
            const r = el.getBoundingClientRect()
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            if (!top) return 'nothing (off-screen)'
            const a = top.closest('[data-audit]')?.getAttribute('data-audit')
            return `${top.tagName.toLowerCase()}${a ? `[${a}]` : ''}`
          }).catch(() => 'unreadable')
          return `${msg[0]} · on top: ${onTop}${intercept ? ` · ${intercept.slice(0, 120)}` : ''}`
        }
      }
      const shown = await liCount()
      const label = ((await page.locator('[data-audit="ranch-recent-more"]').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
      const promised = parseInt((label.match(/Show (\d+) more/) ?? ['', 'NaN'])[1], 10)
      record('7B.2: the hub opens on two recent rows, and the expander says how many more there are',
        shown === 2 && promised > 0,
        `${shown} row(s) · "${label}"`)

      // Count what the tap fetches. The rows are already on the page; an
      // expander that goes back for them is a page load wearing a disclosure's
      // clothes, and that is the thing being asserted.
      //
      // NOT every request counts. Revealing 26 rows puts 26 more <Link>s on
      // screen and Next prefetches the ones near the viewport — measured, 12
      // RSC requests to /ranch/activity/<id>, the rows' own destinations. That
      // is the framework preparing the next tap, not this tap fetching its
      // content. What must be zero is a refetch of THIS page's data: the /ranch
      // RSC payload, or any API call. A blanket "zero requests" was simply the
      // wrong claim, and it failed on prefetches while proving nothing.
      const fetched: string[] = []
      let prefetches = 0
      const countReq = (r: { url: () => string }) => {
        const path = r.url().replace(BASE, '').split('?')[0]
        if (/^\/ranch\/activity\/[0-9a-f-]+$/.test(path)) { prefetches++; return }
        fetched.push(path)
      }
      page.on('request', countReq)
      const urlBefore = page.url()
      const tapErr = await tapMore()
      await page.waitForTimeout(1_500)
      page.off('request', countReq)
      const opened = await liCount()
      const sections = await page.locator('[data-audit="ranch-sections"]').count()
      const activityLink = await page.locator('[data-audit="ranch-section"]', { hasText: 'Activity' }).count()
      record('7B.2: the rest open in place — the rows are never refetched, no navigation, the Sections list and its Activity link untouched',
        !tapErr && opened === shown + promised && fetched.length === 0 && page.url() === urlBefore && sections === 1 && activityLink === 1,
        tapErr ? `the expander could not be tapped: ${tapErr}` : `${shown} → ${opened} row(s) (promised ${promised}) · ${fetched.length} data request(s)${fetched.length ? ` [${fetched.slice(0, 3).join(', ')}]` : ''} · ${prefetches} link prefetch(es) · url ${page.url() === urlBefore ? 'unchanged' : 'CHANGED'} · sections ${sections} · Activity link ${activityLink}`)

      const collapsed = await page.locator('[data-audit="ranch-recent-more"]').innerText().catch(() => '')
      const closeErr = await tapMore()
      await page.waitForTimeout(800)
      record('7B.2: it closes again to two rows', !closeErr && (await liCount()) === 2 && /Show fewer/.test(collapsed),
        closeErr ? `the expander could not be tapped: ${closeErr}` : `open label "${collapsed.replace(/\s+/g, ' ').trim()}" · back to ${await liCount()} row(s)`)
      if (prior7b) await page.setViewportSize(prior7b)
    }

    // ── Block 7B.1: headlines last on Today, and only as expensive as shown ──
    // The card was gated to the signed-out county page, and when it did render
    // it pulled 147 items and 75,601 bytes to show three. Both are tested here:
    // WHERE it sits (last — news never appears above work) and WHAT it costs.
    for (const width of [390, 320]) {
      const prior = page.viewportSize()
      await page.setViewportSize({ width, height: 844 })
      const seen: { url: string; bytes: number }[] = []
      const onRes = async (res: { url(): string; body(): Promise<Buffer> }) => {
        if (!res.url().includes('/api/news')) return
        try { seen.push({ url: res.url().replace(BASE, ''), bytes: (await res.body()).length }) } catch { /* body gone */ }
      }
      page.on('response', onRes)
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(9_000)

      const order: string[] = await page.evaluate(`[...document.querySelectorAll('main [data-audit]')].map(e => e.getAttribute('data-audit'))`)
      const hookAt = order.indexOf('news-hook')
      // "Last" is asserted as an ABSENCE OF ANYTHING ELSE below, not against a
      // list of section names: NeedsAttention and ProgramAlerts render nothing
      // when there is nothing to say, so a hardcoded roster would be a check
      // that passes because the names never appeared. Anything on Today that is
      // not part of the news card itself must sort above it.
      const below = order.slice(hookAt + 1).filter(a => a && !a.startsWith('news-'))
      // And the ledger strip — hay — must be above it, positively.
      const hayAt = order.findIndex(a => a === 'hay-details' || a === 'logged-row' || a === 'whole-record')
      record(`7B.1 (${width}): headlines are on Today, last, below hay`,
        hookAt >= 0 && below.length === 0 && hayAt >= 0 && hayAt < hookAt,
        hookAt < 0 ? 'news-hook ABSENT from Today' : `position ${hookAt + 1} of ${order.length} · ledger at ${hayAt + 1} · below it: ${below.join(', ') || 'nothing'}`)

      const first = seen.find(r => /\/api\/news/.test(r.url))
      record(`7B.1 (${width}): it asks for the three it shows, not the whole river`,
        !!first && /limit=3/.test(first.url) && first.bytes < 20_000,
        first ? `${first.url} → ${first.bytes} B` : 'no /api/news request seen')

      const rendered = await page.locator('[data-audit="news-list"] a').count()
      const moreBtn = page.locator('[data-audit="news-more"]')
      const hasMore = await moreBtn.count()
      record(`7B.1 (${width}): three headlines render, and "More headlines" survives the smaller payload`,
        rendered === 3 && hasMore === 1,
        `${rendered} headline(s) · more button ${hasMore}`)

      if (hasMore === 1) {
        const urlBefore = page.url()
        await moreBtn.click()
        await page.waitForTimeout(5_000)
        const expanded = await page.locator('[data-audit="news-list"] a').count()
        const second = seen.filter(r => /limit=10/.test(r.url))
        record(`7B.1 (${width}): expanding pays for ten, in place, once`,
          expanded === 10 && second.length === 1 && page.url() === urlBefore,
          `${rendered} → ${expanded} headline(s) · ${second[0]?.bytes ?? '—'} B · url ${page.url() === urlBefore ? 'unchanged' : 'CHANGED'}`)
      }
      page.off('response', onRes)
      if (prior) await page.setViewportSize(prior)
    }

    // ── Block 7B.1: a broken feed is never "no news" ───────────────────────
    // The distinction the three states exist for. An error must read as a claim
    // about the network; "No cattle-country headlines right now" is a claim
    // about the world, and a failed fetch must never be allowed to make it.
    {
      await page.route('**/api/news**', r => r.abort())
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(6_000)
      const err = await page.locator('[data-audit="news-error"]').count()
      const empty = await page.locator('[data-audit="news-empty"]').count()
      record('7B.1: with the feed unreachable the card says so — never "no headlines right now"',
        err === 1 && empty === 0,
        `error state ${err} · empty state ${empty}`)
      await page.unroute('**/api/news**')
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
      // ── 7.1: sign-out never silently loses work ──────────────────────────
      // Offline, log one feeding so the outbox holds unsynced work, then try to
      // leave. The old guard was a native window.confirm that never fired for a
      // FAILED entry at all; the block is now in-app, it counts everything
      // unsynced, and it says what each button does to them.
      await page.goto('/account', { waitUntil: 'domcontentloaded' })
      await page.context().setOffline(true)
      await page.locator('[data-audit="record-button"], [data-audit="record-fab"]').locator('visible=true').first().click().catch(() => {})
      await page.locator('[data-audit="tile-hay_fed"]').first().click().catch(() => {})
      await page.getByLabel('Hay fed').first().fill('3').catch(() => {})
      await page.locator('[data-audit="record-save"]').first().click().catch(() => {})
      await page.waitForTimeout(3_000)
      // The precondition, asserted rather than assumed: without an unsynced
      // entry the block SHOULD not appear, and three cascading failures below
      // would say nothing about the guard.
      const heldOffline = await page.evaluate(`(() => { try { return (JSON.parse(localStorage.getItem('dryline_outbox_v1') || '[]')).filter(i => i.state !== 'synced').length } catch (e) { return -1 } })()`)
      record('7.1: offline, the entry is held on the phone (precondition)', (heldOffline as number) > 0, `${heldOffline} unsynced`)
      await page.locator('[data-audit="sign-out"]').first().click().catch(() => {})
      await page.waitForTimeout(2_500)
      const blockTxt = (await page.locator('[data-audit="signout-block"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('7.1: offline, sign-out is blocked by an in-app sheet naming the count', /haven\u2019t reached the ranch yet|hasn\u2019t reached the ranch yet/.test(blockTxt) && /^\d+ /.test(blockTxt), blockTxt.slice(0, 110))
      record('7.1: the block offers Stay signed in and a discard that shows the count', (await page.locator('[data-audit="signout-stay"]').count()) === 1 && /discard/i.test(await page.locator('[data-audit="signout-discard"]').innerText().catch(() => '')), (await page.locator('[data-audit="signout-discard"]').innerText().catch(() => '')).replace(/\s+/g, ' '))
      record('7.1: staying signed in keeps the session and the entry', await page.locator('[data-audit="signout-stay"]').click().then(async () => { await page.waitForTimeout(1_200); return page.url().includes('/account') }).catch(() => false), page.url().replace(BASE, ''))
      // Back online, the stay path syncs it rather than stranding it.
      await page.context().setOffline(false)
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(6_000)
      const stillPending = await page.evaluate(`(() => { try { return (JSON.parse(localStorage.getItem('dryline_outbox_v1') || '[]')).filter(i => i.state !== 'synced').length } catch (e) { return -1 } })()`)
      record('7.1: back online, the kept entry syncs instead of stranding', stillPending === 0, `${stillPending} unsynced left`)

      await page.goto('/account', { waitUntil: 'domcontentloaded' })   // Block 6A: Sign out lives on /account
      await page.locator('[data-audit="sign-out"]').click()
      await page.waitForURL(u => u.pathname === '/' || u.pathname === '/signin', { timeout: 30_000 }).catch(() => {})
      await page.waitForLoadState('domcontentloaded')
      const afterText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const keysAfter = await page.evaluate((ks: string[]) => ks.filter(k => localStorage.getItem(k) !== null), PRIVATE_KEYS)
      const signIn = await page.locator('a[href^="/signin"]').count() + (/sign in/i.test(afterText) ? 1 : 0)   // the public page offers a way in, in whatever words
      // The receipt is checked by ELEMENT, not by text: the public landing page's
      // own marketing copy contains the words "Saved on this phone → Waiting to
      // sync → Synced to ranch", so a body-text match for that phrase was testing
      // Dryline's sales pitch, not whether a private receipt survived. It passed
      // only while the assertion happened to run before the landing finished
      // rendering; a slower sign-out (7.1 flushes first) exposed it.
      const receiptEls = await page.locator('[role="status"], [data-audit="global-save-status"]').count()
      record('5D: after sign-out — fresh signed-out page, no ranch name, no quantities, no receipt, no private keys', !/SMOKE-DAILY-LOOP/.test(afterText) && !/Fed \d+ bales/.test(afterText) && !/bales on hand/.test(afterText) && receiptEls === 0 && keysAfter.length === 0 && signIn >= 1, `url ${page.url().replace(BASE, '') || '/'} · keys left: ${keysAfter.join(', ') || 'none'} · receipt elements ${receiptEls} · sign-in links ${signIn}`)
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
