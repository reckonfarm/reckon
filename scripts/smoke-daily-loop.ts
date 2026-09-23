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
//   2A — the four states show in order (Saved → Waiting to
//   sync → Sent); exactly one row, under the client-minted id;
//   airplane mode: saved on the phone, waits, syncs on reconnect; a replay
//   of the same body is answered duplicate with no second row; force-quit
//   mid-save (page killed while offline) → reopened → exactly one row;
//   double-tap Save → one row; a half-typed sheet survives a reload.

import { guardWorktree, suiteIdentity } from './lib/suite-guard'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { chromium, type Locator, type Page, type BrowserContext } from '@playwright/test'
import { TEXT_AUDIT, type TextAudit } from './lib/text-audit'
import { MOVE_NEEDS_BUNCH, NO_PLACE_RECORDED } from '../lib/move-line'

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
// PK, 2026-09-15: known flakes are NAMED AND SKIPPED, never replayed. A pass is
// a pass; a fail is a named skip that keeps its detail, so a real failure
// shows up twice across two runs instead of costing a replay each time.
const KNOWN_FLAKES = ['force-quit receipt', 'Weather day chips'] as const
const flaky = (name: typeof KNOWN_FLAKES[number], check: string, pass: boolean, detail = '') => {
  if (pass) { record(check, true, detail); return }
  skip(check, `known flake "${name}" — ${detail}`)
}

// The ranch day, not the UTC day: between 00:00 and 06:00 UTC the two differ, and a count
// stamped 'tomorrow' would make today's feeding read as before the count (seen 2026-09-07 05:10 UTC).
const ranchDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
let userId = ''
// Block 14: 069 by capability — a bunch with no weight is accepted only once
// the migration has run. Probed once on the smoke ranch (its own scratch
// row, removed at once); the chute and count checks skip, saying so, without it.
let has069: boolean | null = null
async function probe069(ranchId: string, userId: string): Promise<boolean> {
  if (has069 !== null) return has069
  const { data, error } = await admin.from('herd_lots').insert({ ranch_id: ranchId, class: 'cows', name: `${PREFIX} 069 probe`, head_count: 1, avg_weight: null, weight_unit: 'lb', created_by: userId, updated_by: userId }).select('id').single()
  if (data) await admin.from('herd_lots').delete().eq('id', (data as { id: string }).id)
  has069 = !error
  return has069
}
// Block 15: 070 by capability — one preg check may carry its opens as a bunch
// only once the migration has run. Probed on the smoke ranch's own scratch
// bunch through the signed-in page (the way the phone does it); every row it
// makes is removed at once. The chute checks skip, saying so, without it.
let has070: boolean | null = null
async function probe070(page: Page, ranchId: string, userId: string): Promise<boolean> {
  if (has070 !== null) return has070
  const { data: lot } = await admin.from('herd_lots').insert({ ranch_id: ranchId, class: 'cows', name: `${PREFIX} 070 probe`, head_count: 2, avg_weight: null, weight_unit: 'lb', created_by: userId, updated_by: userId }).select('id').single()
  if (!lot) { has070 = false; return false }
  const id = randomUUID()
  const r = await page.request.post('/api/log', { data: { id, type: 'group_action', action: 'preg_check', source_lot_id: (lot as { id: string }).id, expected_head: 2, counted: 2, stay: 1, results: [{ lot_id: null, name: `${PREFIX} 070 probe opens`, class: 'old_cows', head: 1 }], detail: { bred: 1, open: 1 } } })
  has070 = r.status() === 201
  await admin.from('events').delete().eq('id', id)
  await admin.from('herd_lots').delete().like('name', `${PREFIX} 070 probe%`)
  return has070
}
// Block 19: does this database know what a split is? 071 is PK's to run, and
// until he has, the split is a capability this build does not have — named in
// the report every run, never a silent skip.
let has071: boolean | null = null
async function probe071(page: Page, ranchId: string, userId: string): Promise<boolean> {
  if (has071 !== null) return has071
  const { data: lot } = await admin.from('herd_lots').insert({ ranch_id: ranchId, class: 'cows', name: `${PREFIX} 071 probe`, head_count: 3, avg_weight: null, weight_unit: 'lb', created_by: userId, updated_by: userId }).select('id').single()
  if (!lot) { has071 = false; return false }
  const id = randomUUID()
  const r = await page.request.post('/api/log', { data: { id, type: 'group_action', action: 'split', source_lot_id: (lot as { id: string }).id, expected_head: 3, results: [{ lot_id: null, name: `${PREFIX} 071 probe off`, class: 'cows', head: 1 }] } })
  has071 = r.status() === 201
  await admin.from('events').delete().eq('id', id)
  await admin.from('herd_lots').delete().like('name', `${PREFIX} 071 probe%`)
  return has071
}
let userIdB = ''
let ranchId = ''
let placeId = ''
let lotId = ''
const LOT_NAME = 'Smoke steers'

async function teardown(label: string) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const ids = (users?.users ?? []).filter(u => u.email === EMAIL || u.email === EMAIL_B || u.email === 'smoke-daily-loop-new@dryline.farm').map(u => u.id)
  let n = 0
  if (ids.length) {
    n += (await admin.from('events').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('job_annotations').delete().in('user_id', ids).select('job_id')).data?.length ?? 0   // 6J fixtures
    n += (await admin.from('jobs').delete().in('user_id', ids).select('id')).data?.length ?? 0
    n += (await admin.from('devices').delete().in('user_id', ids).select('id')).data?.length ?? 0
    // Block 28 (074): a place that history points at is never hard-deleted —
    // the events went first; the bunches go before the places; and a parent is
    // refused while a child still lives, so places go in passes until none go.
    n += (await admin.from('herd_lots').delete().in('created_by', ids).select('id')).data?.length ?? 0
    for (let pass = 0; pass < 4; pass++) { const gone = (await admin.from('places').delete().in('user_id', ids).select('id')).data?.length ?? 0; n += gone; if (!gone) break }
    n += (await admin.from('operation_profiles').delete().in('user_id', ids).select('user_id')).data?.length ?? 0
    n += (await admin.from('hay_listings').delete().in('user_id', ids).select('id')).data?.length ?? 0
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
const STATES = ['Saved', 'Waiting for signal', 'Sent', "Couldn't send"]
let lastWatch: string[] = []   // raw strip texts seen by the last watch, for FAIL details
// Block 32: a ledger page stamps what its render read (data-audit="ledger-through").
// Wait until the painted stamp is at or past a row's ingested_at — the page's own
// proof that it caught up — and say how long that took. A page without the stamp
// is not a ledger page and can never catch up.
async function stampReaches(page: Page, ingestedAt: string | null, timeoutMs: number): Promise<{ ok: boolean; stamp: string | null; ms: number }> {
  const t0 = Date.now()
  let stamp: string | null = null
  while (Date.now() - t0 < timeoutMs) {
    stamp = await page.locator('[data-audit="ledger-through"]').first().getAttribute('data-through').catch(() => null)
    if (ingestedAt && stamp && Date.parse(stamp) >= Date.parse(ingestedAt)) return { ok: true, stamp, ms: Date.now() - t0 }
    await page.waitForTimeout(250)
  }
  return { ok: false, stamp, ms: Date.now() - t0 }
}

async function watchStates(page: Page, until: string, timeoutMs: number, label?: string): Promise<string[]> {
  const seen: string[] = []
  const raw: string[] = []
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const strip = page.locator('[role="status"]').first()
    const text = (await strip.innerText().catch(() => '')).replace(/\s+/g, ' ')
    if (raw[raw.length - 1] !== text) raw.push(text)
    // Block 23: a synced receipt is ONE line and may not repeat the record's
    // name, so which record a strip is about is read from the strip, not from
    // its words. The text is still accepted, for strips without the attribute.
    const named = await strip.getAttribute('data-label').catch(() => null)
    if (label && !text.includes(label) && !(named ?? '').includes(label)) { await page.waitForTimeout(50); continue }
    const s = STATES.find(x => text.includes(x))
    if (s && seen[seen.length - 1] !== s) seen.push(s)
    if (s === until) break
    await page.waitForTimeout(50)
  }
  lastWatch = raw
  return seen
}
const rawSeen = () => ` [strip: ${lastWatch.map(t => JSON.stringify(t.slice(0, 60))).join(' → ')}]`

// Block 11 (11.5): Today's full-width "Record work" button is gone — the bar
// carries Record on every screen, so a second one on Today was the same action
// twice. Which control is on screen now depends on the width: the header's
// Record on desktop (where this suite runs by default), the bar's on a phone.
// One helper, so no check has to know which.
function recordControl(page: Page) {
  return page.locator('[data-audit="record-button"], [data-audit="record-fab"]').locator('visible=true').first()
}

// Block 15: a bunch option reads "Name · Class · N head", so a bunch is picked
// by the name it starts with, never by the whole label.
// One retry on a navigation the wire dropped (a preview's "fetch failed"), so a
// hiccup between here and Vercel does not end the whole run.
async function gotoTwice(page: Page, url: string) {
  try { await page.goto(url, { waitUntil: 'domcontentloaded' }) }
  catch { await page.waitForTimeout(2_000); await page.goto(url, { waitUntil: 'domcontentloaded' }) }
}
// Block 15b: the place page folds Activity and Devices shut. A check that reads
// what is under a fold opens it first — the way a person would.
async function openFolds(page: Page) {
  await page.evaluate(() => { for (const d of document.querySelectorAll<HTMLDetailsElement>('details[data-audit$="-fold"]')) d.open = true })
}
async function selectBunch(page: Page, selector: string, name: string) {
  const value = await page.locator(`${selector} option`).evaluateAll((opts, n) => {
    const hit = (opts as HTMLOptionElement[]).find(o => o.textContent?.trim().startsWith(n as string))
    return hit ? hit.value : null
  }, name)
  if (!value) throw new Error(`no bunch option starting with "${name}" in ${selector}`)
  await page.locator(selector).selectOption(value)
}
async function logFeed(page: Page, bales: number, opts: { doubleTap?: boolean; place?: string; lot?: string } = {}) {
  await recordControl(page).click()
  await page.getByRole('button', { name: /^Feed hay/ }).click()
  await page.getByLabel('Hay fed').fill(String(bales))
  if (opts.place) await page.getByLabel('Where').selectOption({ label: opts.place })
  if (opts.lot) { await page.locator('[data-audit="fed-to"]').waitFor({ timeout: 15_000 }).catch(() => {}); await selectBunch(page, '[data-audit="fed-to"]', opts.lot) }
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

// Block 13 — the one gesture. Hold a row (mouse down, 600 ms, up) and read the
// sheet. `hold` returns whether the sheet opened; the caller reads its parts.
async function hold(page: Page, row: Locator): Promise<boolean> {
  // A row painted by the server answers a hold only once it has hydrated; on a slow
  // page the first hold can land before that. Three tries, never a false 'closed'.
  for (let attempt = 0; attempt < 3; attempt++) {
    await row.scrollIntoViewIfNeeded().catch(() => {})
    const box = await row.boundingBox().catch(() => null)
    if (!box) return false
    await page.mouse.move(box.x + Math.min(40, box.width / 3), box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(650)
    await page.mouse.up()
    await page.locator('[data-audit="row-actions-sheet"]').waitFor({ timeout: 3_000 }).catch(() => {})
    if ((await page.locator('[data-audit="row-actions-sheet"]').count()) === 1) return true
    await page.waitForTimeout(500)
  }
  return false
}
const sheet = (page: Page) => ({
  fix: page.locator('[data-audit="row-actions-sheet"] [data-audit="row-action-fix"]'),
  fixNote: page.locator('[data-audit="row-actions-sheet"] [data-audit="row-action-fix-note"]'),
  del: page.locator('[data-audit="row-actions-sheet"] [data-audit="row-action-delete"]'),
  deleteNote: page.locator('[data-audit="row-actions-sheet"] [data-audit="row-action-delete-note"]'),
  extra: page.locator('[data-audit="row-actions-sheet"] [data-audit="row-action-extra"]'),
  cancel: page.locator('[data-audit="row-actions-sheet"] [data-audit="row-action-cancel"]'),
})
const undoStrip = (page: Page) => page.locator('[data-audit="undo-strip"]')
async function pressUndo(page: Page): Promise<boolean> {
  const btn = page.locator('[data-audit="undo-button"]')
  await btn.waitFor({ timeout: 5_000 }).catch(() => {})
  if ((await btn.count()) === 0) return false
  await btn.click().catch(() => {})
  for (let i = 0; i < 40; i++) { if ((await undoStrip(page).getAttribute('data-state').catch(() => null)) === 'undone') return true; await page.waitForTimeout(250) }
  return false
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
    // ── Block 26b (ruling 1): a check that dies is ONE red, and the run goes on ──
    // Every section below runs inside this. A throw — a Playwright timeout, a
    // fixture insert refused, anything — is recorded as one FAIL naming the
    // section and what it died of; then the page is put back on its feet (back
    // online, every route unblocked, a fresh page if it was closed) and the
    // next section runs. Before this a single ride timeout left every check
    // after it unrun, and a run that stops is not a result.
    // ONLY=<regex> runs just the sections whose names match — for chasing a red
    // that only shows after certain sections, without the whole loop. A run
    // with ONLY set is a PARTIAL and says so on its summary line.
    const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null
    const section = async (name: string, body: () => Promise<void>) => {
      if (only && !only.test(name)) return
      try { await body() } catch (e) {
        // The first line names the verb; the 'waiting for' line names the locator — both, or a timeout says nothing.
        const lines = (e instanceof Error ? e.message : String(e)).split('\n').map(l => l.trim()).filter(Boolean)
        // The verb, the locator, and WHAT STOOD IN THE WAY: an element that intercepts pointer events is the line that names the culprit.
        const said = [lines[0], ...lines.filter(l => /waiting for|locator\(|getBy|intercepts|receives|retrying|from <|subtree/.test(l)).slice(0, 5)].join(' · ').slice(0, 700)
        record(`${name}: died before its checks finished — ${said}`, false, 'every check of this section after that point is unrun')
        await ctx.setOffline(false).catch(() => {})
        if (page.isClosed()) page = await ctx.newPage()
        await page.unroute('**').catch(() => {})
        await page.context().setGeolocation(null).catch(() => {})
      }
    }

    record('signed in', page.url().includes('/today'), page.url().replace(BASE, ''))

    // ── invariant ──
    await page.goto('/home', { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/(today|dashboard)/, { timeout: 30_000 })
    const homeUrl = page.url().replace(BASE, '')
    // WAIT for it, do not sample it. This counted the button the instant
    // waitForURL resolved, with no settle after domcontentloaded, so it was a
    // race that usually won — and lost once here, reporting a red on a button
    // that three separate trials found present within 18 ms. A bounded wait is
    // the same assertion ("the button is there") without the coin toss.
    const hasRecord = await recordControl(page).waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    // Block 6A: /home lands on /today (the county is public context, not part of the home URL); the private stack is there.
    // Block 11 (11.5): the assertion is unchanged in substance — a signed-in
    // person landing on Today can record something. It just no longer insists
    // that the control be a full-width button ON Today.
    record('/home renders the home county Today stack, with Record reachable', homeUrl.startsWith('/today') && hasRecord, `${homeUrl} · Record reachable: ${hasRecord}`)
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
    const seq1 = await watchStates(page, 'Sent', 20_000, 'Fed 4 bales')
    record('online save shows Saved → Waiting → Synced in order', JSON.stringify(seq1) === JSON.stringify(['Saved', 'Waiting for signal', 'Sent']), seq1.join(' → '))
    // Block 11 (11.12): the receipt leads with the balance and keeps the
    // arithmetic one tap away, so this reads textContent — a closed <details>
    // is the shape under test. "N bales recorded" no longer restates the label.
    const strip1 = ((await page.locator('[role="status"]').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ')
    const balance1 = ((await page.locator('[data-audit="receipt-balance"]').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
    record('2C: the answer — recorded, the balance leads, the count\'s arithmetic behind a tap, no invented runway',
      /Fed 4 bales/.test(strip1) && balance1 === '196 bales on hand' && /200 counted [^+]+ \+ 0 added \u2212 4 fed = 196 bales on hand/.test(strip1) && !/feeding day/.test(strip1), `balance "${balance1}" · ${strip1.slice(0, 120)}`)
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
    await section('Block 11 (11.12): the receipt leads with the balance', async () => {
      // Document order (Block 6A: on desktop the strips sit in a right column, so y is not the order; the DOM is).
      const pos = async (sel: string) => await page.locator(sel).first().evaluate(el => { let n = 0; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT); while (w.nextNode()) { n++; if (w.currentNode === el) return n } return -1 }).catch(() => NaN)
      const ySince = await pos('text=Recorded since you checked'), yRepeat = await pos('text=/Repeat (last|a) feeding/'), yTabs = await pos('[role="tablist"][aria-label="Ledgers"]')
      const activeTab = (await page.locator('[role="tablist"][aria-label="Ledgers"] [role="tab"][aria-selected="true"]').innerText().catch(() => '')).trim()
      // Block 16 (ruling 1): headlines are BACK on Today — and the order 7.7
      // protects is unchanged, because they sit below everything: the ranch's
      // own business, the ledgers, the strips, then the headlines, last.
      const yHead = await pos('[data-audit="today-headlines"]')
      record('7.7 + 16: Today order — since you checked · repeat last · hay (open on Hay) · headlines LAST', ySince < yRepeat && yRepeat < yTabs && yTabs < yHead && (await page.locator('[data-audit="news-hook"]').count()) === 1 && activeTab === 'Hay', `order: since ${Math.round(ySince)} · repeat ${Math.round(yRepeat)} · ledgers ${Math.round(yTabs)} · news ${Math.round(0)} · active tab "${activeTab}"`)
      const body7 = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
      // The drought designation is checked by its own panels, not by the words
      // "U.S. Drought Monitor" — Block 16 gives those words to the Thursday
      // alert, which is a ledger row and may honestly appear on Today.
      const droughtPanels = (await page.locator('[data-audit="county-drought"], [data-audit="drought-ribbon"], [data-audit="lfp-alert"]').count())
      record('7.7: the LFP card, the drought designation panels and the deadline strip are off Today', (await page.locator('[data-audit="conditions-strip"]').count()) === 0 && !/LFP status/i.test(body7) && !/Next USDA deadline/i.test(body7) && droughtPanels === 0, `${(body7.match(/LFP status|Next USDA deadline/i) ?? ['no program text'])[0]} · drought panels ${droughtPanels}`)
      record('7.7: no floating Feedback button on Today', (await page.getByRole('button', { name: /send feedback/i }).count()) === 0)
    })
    // Block 5C — one receipt: the strip's link opens the exact entry it just made.
    await section('Today order: nothing above the ranch\'s own business', async () => {
      const href = await page.locator('[role="status"] [data-audit="receipt-open-entry"]').first().getAttribute('href').catch(() => null)
      const ob = await outbox(page)
      const latestId = ob.length ? ob[ob.length - 1].id : null
      record('5C: the save receipt links to the exact entry', !!href && !!latestId && href === `/ranch/activity/${latestId}`, `${href} vs outbox id ${latestId}`)
    })
    await section('outbox core: one row per id, airplane mode, force-quit, the receipt link', async () => {
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
    const seqOff = await watchStates(page, 'Sent', 4_000, 'Fed 3 bales')   // must NOT reach synced
    const stillLocal = (await page.locator('[role="status"]').first().innerText().catch(() => '')).includes('Saved')
    record('airplane mode: Saved, and stays there', seqOff[0] === 'Saved' && !seqOff.includes('Sent') && stillLocal, seqOff.join(' → ') + rawSeen())
    await ctx.setOffline(false)
    const seqOn = await watchStates(page, 'Sent', 45_000, 'Fed 3 bales')
    const ob2 = await outbox(page)
    const id2 = ob2.find(i => (i.body as { bales?: number }).bales === 3)?.id ?? ''
    record('reconnect → Sent, exactly one row', seqOn.includes('Sent') && !!id2 && (await rowsFor(id2)) === 1 && (await feedRows()) === 2, `${seqOn.join(' → ')} feeds=${await feedRows()}` + rawSeen())

    // ── force-quit mid-save: kill the page while offline, reopen ──
    await ctx.setOffline(true)
    await logFeed(page, 5)
    await watchStates(page, 'Saved', 8_000, 'Fed 5 bales')
    const ob3 = await outbox(page)
    const id3 = ob3.find(i => (i.body as { bales?: number }).bales === 5)?.id ?? ''
    await page.close()                               // the "force quit"
    await ctx.setOffline(false)
    page = await ctx.newPage()
    page.on('dialog', d => void d.accept())
    await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
    const seqFq = await watchStates(page, 'Sent', 45_000, 'Fed 5 bales')
    flaky('force-quit receipt', 'force-quit mid-save → reopen → exactly one row', !!id3 && seqFq.includes('Sent') && (await rowsFor(id3)) === 1 && (await feedRows()) === 3, `${seqFq.join(' → ')} feeds=${await feedRows()}`)

    // ── double-tap Save → one row ──
    const before = await feedRows()
    await logFeed(page, 6, { doubleTap: true })
    await watchStates(page, 'Sent', 20_000, 'Fed 6 bales')
    await page.waitForTimeout(1000)
    record('double-tap Save → one row', (await feedRows()) === before + 1, `feeds ${before} → ${await feedRows()}`)

    // ── half-typed sheet survives a reload ──
    await recordControl(page).click()
    await page.getByRole('button', { name: /^Feed hay/ }).click()
    await page.getByLabel('Hay fed').fill('7')
    await page.reload({ waitUntil: 'domcontentloaded' })
    // Block 11 (11.5): the "finish your unsaved entry" wording moved onto the
    // one control Today kept — a way back to work already started, which is
    // the thing the bar cannot say.
    const btn = ((await page.locator('[data-audit="finish-draft"]').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
    await page.locator('[data-audit="finish-draft"]').first().click()
    const restored = await page.getByLabel('Hay fed').inputValue().catch(() => '')
    record('half-typed sheet survives a reload, and Today offers a way back to it', /finish/i.test(btn) && restored === '7', `draft control "${btn}" · bales "${restored}"`)
    await page.getByRole('button', { name: 'Cancel' }).click()
    })

    // ── 7.4 + 7.5: what a form says before it saves ────────────────────────
    await section('7.4 + 7.5: what a form says before it saves', async () => {
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
    })

    await section('2F: a feeding AT the place, then the place page answers', async () => {
    // ── 2F: a feeding AT the place, then the place page answers ──
    const placeName = `${PREFIX} West stack`
    await logFeed(page, 2, { place: placeName })
    await watchStates(page, 'Sent', 20_000, 'Fed 2 bales')
    await page.goto('/ranch/places', { waitUntil: 'domcontentloaded' })
    // Block 43: places sit behind their kind's count — a stackyard is under Yards; open it first.
    await page.locator('[data-audit="place-group-open"][data-group="yards"]').click({ timeout: 10_000 }).catch(() => {})
    const placeLink = page.locator(`main a[href="/ranch/places/${placeId}"]`)
    record('2F: /places lists the place (under Yards, one tap open)', await placeLink.count() > 0, (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120))
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
    const cardText = (await page.getByText(/^Repeat (last|a) feeding$/).locator('xpath=ancestor::div[1]').innerText().catch(() => '')).replace(/\s+/g, ' ')
    record('2B: Repeat last feeding card shows the last feeding', await same.count() > 0 && /2 bales/.test(cardText) && cardText.includes(placeName), cardText.slice(0, 100))
    await same.click()                                                   // tap 2
    const undo = page.getByRole('button', { name: /^Undo/ })
    const sawUndo = await undo.waitFor({ timeout: 5_000 }).then(() => true).catch(() => false)
    const seqRepeat = await watchStates(page, 'Sent', 30_000, 'Fed 2 bales')
    record('2B: Same today → Saved with Undo, then Synced — one row', sawUndo && seqRepeat[0] === 'Saved' && seqRepeat.includes('Sent') && (await feedRows()) === beforeRepeat + 1, `${seqRepeat.join(' → ')} feeds ${beforeRepeat} → ${await feedRows()}`)
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
    const logItB = await recordControl(pageB).waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    record('no home county: /home lands on the ledger with Log it', !/fips=/.test(urlB) && logItB, `${urlB} · Log it: ${logItB}`)
    const beforeB = (await admin.from('events').select('id', { count: 'exact', head: true }).eq('user_id', userIdB).eq('type', 'hay_fed')).count ?? 0
    // Block 4A — the hand sees the ranch's lots: the Fed-to control is there, with the lot.
    await recordControl(pageB).click()
    await pageB.getByRole('button', { name: /^Feed hay/ }).click()
    const fedTo = pageB.locator('[data-audit="fed-to"]')   // Block 6A: the loaded control (the field's space is reserved while lots load)
    const fedToShown = await fedTo.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
    const lotOptions = fedToShown ? await fedTo.locator('option').allInnerTexts() : []
    record('4A: the hand sees the ranch\'s lots in the Fed-to control', fedToShown && lotOptions.some(o => o.startsWith(LOT_NAME)), fedToShown ? lotOptions.join(' | ') : 'no Fed-to control')
    await pageB.getByRole('button', { name: 'Cancel' }).click().catch(() => {})
    await logFeed(pageB, 1, { lot: fedToShown ? LOT_NAME : undefined })
    const seqB = await watchStates(pageB, 'Sent', 20_000, 'Fed 1 bale')
    const afterB = (await admin.from('events').select('id', { count: 'exact', head: true }).eq('user_id', userIdB).eq('type', 'hay_fed')).count ?? 0
    record('no home county: a feed event saves and syncs', seqB.includes('Sent') && afterB === beforeB + 1, `${seqB.join(' → ')} rows ${beforeB} → ${afterB}`)

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
        const who = await d('who'), what = await d('what'), work = await d('work-time'), rec = await d('recorded'), sync = await d('saved'), place = await d('place')
        record('5A: the event states actor + role, what, place, work time, recording time, sync state', /Smoke A/.test(who) && /owner/.test(who) && /Fed 2 bales/.test(what) && /West stack/.test(place) && /\d{4}/.test(work) && /\d{4}/.test(rec) && /Sent/.test(sync), `${who} · ${what} · ${place} · work ${work} · recorded ${rec} · ${sync}`)
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
    // 12.13: Today's Activity tab is gone; the Ranch hub's recent rows are where
    // the owner sees the hand's entry named with its lot.
    await page.goto('/ranch', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-audit="ranch-tile"][data-tile="record"]').click({ timeout: 20_000 }).catch(() => {})   // Block 47: the record is a tab on the Ranch view
    await page.locator('[data-audit="ranch-today"]').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
    const ownerText = ((await page.locator('[data-audit="ranch-today"]').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ')
    record('4A/12.8: the hand\'s feeding shows its lot name to the owner, in the hand\'s line under Today on the ranch', new RegExp(`Fed 1 bale to ${LOT_NAME}`).test(ownerText), (ownerText.match(new RegExp(`Fed 1 bale[^.]{0,60}`)) ?? ['no line'])[0])
    })

    // ── Block 6A (6): the Ranch hub's numbers stand behind something; Archive keeps history ──
    await section('Block 6A (6): the Ranch hub\'s numbers stand behind something; Archive keeps history', async () => {
      await page.goto('/ranch', { waitUntil: 'domcontentloaded' })
      // Block 12 (12.7): three tiles, each with a number only where something
      // stands behind it. This ranch has no devices, so Ground names places
      // alone; Cattle names head; the record names today's entries.
      await page.locator('[data-audit="ranch-tabs"]').waitFor({ timeout: 20_000 }).catch(() => {})
      const tileLabels = await page.locator('[data-audit="ranch-tile"]').evaluateAll(els => els.map(e => (e.getAttribute('data-tile') ?? '')))
      // Block 47: the numbers stand above the tabs — head, bales, rain — each
      // painted only with a record behind it; a tab is a word, the record's
      // carrying today's count. This ranch has lots, so head is painted.
      const numbers = await page.locator('[data-audit="ranch-numbers"] [data-audit^="ranch-number-"][data-audit$="-word"], [data-audit="tile-number"]').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()))
      record('6A/12.7: Ranch is three things — Cattle · Ground · The record — and shows only the numbers something stands behind (no devices → no device number)',
        tileLabels.join(',') === 'cattle,ground,record' && numbers.some(n => /^head\b/.test(n)) && !numbers.some(n => /device/.test(n)),
        `tiles [${tileLabels.join(', ')}] · numbers [${numbers.join(' | ')}]`)
      // Block 13: hold the lot the feedings were logged against → Fix opens
      // its form; Delete sends it to the trash with no confirm; every past
      // feeding still names it, marked gone; Undo brings it back.
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="lot-row"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const rowsBefore = await page.locator('[data-audit="lot-row"]').count()
      const lotRow = page.locator('[data-audit="lot-row"]').first()
      const lotSheet = await hold(page, lotRow)
      await sheet(page).fix.click().catch(() => {})
      const lotFormOpen = await page.getByText('Fix this bunch').waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)
      record('13 (lot): hold → Fix opens the lot form', lotSheet && lotFormOpen, `sheet ${lotSheet} · form ${lotFormOpen}`)
      await page.getByRole('button', { name: 'Cancel' }).first().click().catch(() => {})
      const lotSheet2 = await hold(page, page.locator('[data-audit="lot-row"]').first())
      await sheet(page).del.click().catch(() => {})
      await undoStrip(page).waitFor({ timeout: 8_000 }).catch(() => {})
      const stripUp = (await undoStrip(page).count()) === 1
      for (let i = 0; i < 40 && (await page.locator('[data-audit="lot-row"]').count()) >= rowsBefore; i++) await page.waitForTimeout(250)
      const rowsAfter = await page.locator('[data-audit="lot-row"]').count()
      // The record, read from a SECOND tab: the strip lives in this tab's
      // memory for ten seconds, and a full page load (which goto is) would
      // drop it — a person tapping the bottom bar keeps it.
      const look = await page.context().newPage()
      await look.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      await look.locator('[data-audit="activity-list"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const stillNamed = await look.getByRole('link', { name: new RegExp(`to ${LOT_NAME} \\(in trash\\)`) }).count()
      await look.close()
      record('13 (lot): hold → Delete goes to the trash with no confirm, the row leaves the list, and every past feeding still names the lot as in the trash',
        lotSheet2 && stripUp && rowsBefore === 1 && rowsAfter === 0 && stillNamed >= 1, `sheet ${lotSheet2} · strip ${stripUp} · rows ${rowsBefore} → ${rowsAfter} · feedings still naming it as in trash ${stillNamed}`)
      const undone = await pressUndo(page)
      for (let i = 0; i < 40 && (await page.locator('[data-audit="lot-row"]').count()) === 0; i++) await page.waitForTimeout(250)
      const rowsBack = await page.locator('[data-audit="lot-row"]').count()
      record('13 (lot): Undo puts the lot back on the list', undone && rowsBack === 1, `undo ${undone} · rows ${rowsBack}`)
    })

    // ── Block 6A (7): places rows carry last work only when a line exists; devices empty state + setup page ──
    await section('Block 6A (7): places rows carry last work only when a line exists; devices empty state + setup page', async () => {
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
    })

    // ── Block 6A (8): the record sheet — verbs, Count apart, quantity → lot → place → time, a preview, Record feeding ──
    await section('Block 6A (8): the record sheet — verbs, Count apart, quantity → lot → place → time, a preview, Record feeding', async () => {
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await recordControl(page).click()
      // Block 20: the picker is the ranch map and ONE row — Feed · Move · Count · Rain · Work · Place, each an icon with its word.
      const tiles = await page.locator('[data-audit="record-actions"] button').evaluateAll(els => els.map(e => (e.querySelector('span')?.textContent ?? '').trim()))
      const countApart = tiles.join(' | ') === 'Feed | Move | Count | Rain | Work | Place'
      await page.locator('[data-audit="tile-hay_fed"]').click()
      await page.locator('[data-audit="fed-to"]').waitFor({ timeout: 15_000 }).catch(() => {})
      const labels = await page.locator('form label, form [data-audit="feed-preview"], form p').evaluateAll(els => els.map(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))
      const order = ['Hay fed', 'Fed to', 'Where'].map(l => labels.findIndex(x => x.startsWith(l)))
      const noLot = await page.locator('[data-audit="fed-to"] option').first().innerText().catch(() => '')
      await page.getByLabel('Hay fed').fill('3')
      const preview = (await page.locator('[data-audit="feed-preview"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const saveLabel = (await page.locator('[data-audit="record-save"]').innerText().catch(() => '')).trim()
      await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {})
      record('6A/12.2/14/20: the sheet opens on one row of six — Feed · Move · Count · Rain · Work · Place; a feeding runs quantity → bunch → place; "Not assigned to a bunch"; a preview line; Record feeding', countApart && order[0] < order[1] && order[1] < order[2] && noLot === 'Not assigned to a bunch' && /^3 bales.*today \d/.test(preview) && saveLabel === 'Record feeding', `tiles [${tiles.join(' | ')}] · count apart ${countApart} · order ${order.join(',')} · no-lot "${noLot}" · preview "${preview}" · save "${saveLabel}"`)
    })

    // ── Block 6A (9): the copy queue, as rendered ──
    await section('Block 6A (9): the copy queue, as rendered', async () => {
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
      await page.getByText('Display name', { exact: true }).waitFor({ timeout: 20_000 }).catch(() => {})   // the profile form paints after its fetch
      const nameHint = await page.getByText('Display name', { exact: true }).count()   // Block 46: the field's label alone; its hint sentence is gone
      const buyers = await page.getByText(/How buyers see you|Tell buyers/).count()
      record('6A/12.13: copy queue rendered — Jobs this season · Hay tabs (the Activity tab went in 12.13); Record N bales now / Adjust first; County drought; the display-name hint; no buyer copy', tabs.join(' | ') === 'Jobs this season | Hay' && repeatButtons.length === 2 && countyDrought === 1 && latestReading === 0 && nameHint === 1 && buyers === 0, `tabs [${tabs.join(' | ')}] · repeat [${repeatButtons.join(' | ')}] · County drought ${countyDrought} · Latest Reading ${latestReading} · hint ${nameHint} · buyer copy ${buyers}`)
    })

    // ── Block 6 (6K): weather copy — no "County County"; the rainfall line says what it is; the Drought Monitor's two dates named apart ──
    await section('Block 6 (6K): weather copy — no "County County"; the rainfall line says what it is; the Drought Monitor\'s two dates named apart', async () => {
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
        flaky('Weather day chips', '7-3: signed out, the Weather tab opens with the seven-day forecast (the destination) and Today keeps its brief outlook', todayStrip === 1 && fcSection === 1 && days >= 7 && order === 'forecast first', `Today strip ${todayStrip} · Weather forecast sections ${fcSection} · day chips ${days} · ${order}`)
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
      // Block 44: the map stands open on the page, so its dated preview line (the closed state's) is not painted — the map being open is what stands in for it.
      const mapOpen = await page.locator('[data-audit="weather-drought-map"] .leaflet-container, [data-audit="weather-drought-map"] img').count()   // the same reading the 44 check makes: the map is painted
      record('6K: the Drought Monitor names its valid date and its release date apart — on the county card and on the map', /Valid [A-Z][a-z]{2} \d{1,2}, \d{4} · released [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(mainText) && (mapOpen > 0 || /Drought Monitor · valid [A-Z][a-z]{2} \d{1,2}(, \d{4})? · released [A-Z][a-z]{2} \d{1,2}/.test(mainText)), `map open ${mapOpen} · ${(mainText.match(/Valid [^·]+· released [^·]{0,20}/) ?? ['no valid/released pill'])[0].slice(0, 60)} · ${(mainText.match(/Drought Monitor · valid [^·]+· released [^·]{0,12}/) ?? ['no map preview'])[0]}`)
    })

    // ── Block 6B (6): Weather in order — forecast · recorded rain · county estimate vs station normal · county drought · drought map ──
    await section('Block 6B (6): Weather in order — forecast · recorded rain · county estimate vs station normal · county drought · drought map', async () => {
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
      record('6B: Weather says it plainly — recorded rain only when a reading exists, county estimate vs station normal (PRISM/NOAA footer), the drought ribbon in words; one h1; title Weather; never a zero for no reading', /^Weather/.test(title) && h1 === 1 && !zeroRain && /PRISM/.test(footer) && /NOAA/.test(footer) && !!ribbonLabel && /three years/.test(ribbonLabel), `title "${title}" · h1 ${h1} · rain rows ${rainRows} + ${noneRows} without a reading · footer "${footer.slice(0, 46)}" · ribbon "${(ribbonLabel ?? '').slice(0, 46)}"`)
      // 6F: no link on the Weather view is dead — every same-site href answers something other than 404 (the audit's /weather/radar).
      const hrefs = [...new Set(await page.locator('main a[href^="/"]').evaluateAll(els => els.map(a => a.getAttribute('href') ?? '')))].filter(h => h && !h.startsWith('/api/'))
      const dead: string[] = []
      for (const h of hrefs) { const r = await page.request.get(h, { maxRedirects: 5 }).catch(() => null); if (!r || r.status() === 404 || r.status() >= 500) dead.push(`${h} → ${r ? r.status() : 'no response'}`) }
      record('6F: every link on the Weather view answers — none is a Page not found', hrefs.length > 0 && dead.length === 0, dead.length ? dead.join(' · ') : `${hrefs.length} links answered`)
    })

    // ── Block 6B (9): at 200% text size on a phone, Record is still reachable ──
    await section('Block 6B (9): at 200% text size on a phone, Record is still reachable', async () => {
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
    })

    // ── Block 6A (1): old URLs resolve, the signed-in home is /today, county pages are never redirected ──
    await section('Block 6A (1): old URLs resolve, the signed-in home is /today, county pages are never redirected', async () => {
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
    })

    // ── Block 6A (4): the same ranch in the header on every private page; no county title on any of them ──
    await section('Block 6A (4): the same ranch in the header on every private page; no county title on any of them', async () => {
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
    })

    // ── Block 6A (3) / 11.4: the bottom bar carries Record on a phone ────────
    // The FAB this used to check is deleted. It floated over real controls on
    // four screens — including "Drop a place here" on Places, that screen's
    // whole purpose — and PK's ruling was to fix the class rather than the
    // instances: no floating element may sit over an interactive control. The
    // cheapest way to keep that promise is to have almost no floating
    // elements, so Record moved INTO the bar and the pill went.
    //
    // The behaviour worth keeping from the old check survives: Record opens
    // the sheet, and it is not offered while the sheet is already up.
    await section('Block 6A (3) / 11.4: the bottom bar carries Record on a phone', async () => {
      const prior = page.viewportSize()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      const bar = page.locator('[data-audit="bottom-bar"]')
      await bar.waitFor({ timeout: 15_000 }).catch(() => {})
      const tabs = await page.locator('[data-audit="bottom-bar"] a').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()))
      // Block 12 (12.1): the pill is back. Four destinations in the bar and
      // nothing else; Record floats above it, clear of it, under the 11.4 rule
      // that the overlap check enforces on every screen.
      const rec = page.locator('[data-audit="record-fab"]')
      await rec.waitFor({ timeout: 15_000 }).catch(() => {})
      const recCount = await rec.count()
      const inBar = await page.locator('[data-audit="bottom-bar"] [data-audit="record-action"]').count()
      const fabBox = await rec.boundingBox().catch(() => null)
      const barBox = await bar.boundingBox().catch(() => null)
      record('6A/12.1: four labeled destinations in the bar, and Record is the pill above it — clear of the bar, and not in it',
        tabs.join(' ') === 'Today Ranch Markets Weather' && recCount === 1 && inBar === 0 && !!fabBox && !!barBox && fabBox.y + fabBox.height <= barBox.y,
        `tabs [${tabs.join(', ')}] · pill ${recCount} · in bar ${inBar} · pill bottom ${fabBox ? Math.round(fabBox.y + fabBox.height) : 'none'} · bar top ${barBox ? Math.round(barBox.y) : 'none'}`)

      await rec.click()
      await page.getByRole('dialog').waitFor({ timeout: 10_000 }).catch(() => {})
      const openDialogs = await page.getByRole('dialog').count()
      const recWhileOpen = await rec.count()
      const flag = await page.evaluate(() => document.documentElement.dataset.recordSheet ?? '')
      await page.keyboard.press('Escape').catch(() => {})   // Block 26c: no Close button — the pull-down, the dim, or Escape
      await page.waitForTimeout(300)
      const recAfter = await rec.isVisible().catch(() => false)
      record('6A: Record opens the sheet and is not offered while the sheet is up, back when it closes',
        openDialogs === 1 && recWhileOpen === 0 && flag === 'open' && recAfter,
        `dialogs ${openDialogs} · Record while open ${recWhileOpen} · html flag "${flag}" · back after close ${recAfter}`)
      if (prior) await page.setViewportSize(prior)
    })

    // ── Block 6 (6G): a move and cattle work can name a lot ─────────────────────
    // Optional, "Unassigned" plain; a move records the move and never changes a
    // head count; work against a lot becomes its last recorded work.
    await section('Block 6 (6G): a move and cattle work can name a lot', async () => {
      // A fresh lot for this block (the seed lot was archived by an earlier check).
      const lot6g = randomUUID(), LOT6G = `${PREFIX} Pairs`
      const { error: l6Err } = await admin.from('herd_lots').insert({ id: lot6g, ranch_id: ranchId, class: 'cows', name: LOT6G, head_count: 44, avg_weight: 1200, weight_unit: 'lb', created_by: userId, updated_by: userId })
      if (l6Err) throw new Error(`6G lot: ${l6Err.message}`)
      const headBefore = async () => parseInt((await page.locator('[data-audit="lot-row"]').filter({ hasText: LOT6G }).locator('[data-audit="lot-head"]').innerText().catch(() => 'NaN')).replace(/,/g, ''), 10)
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      const head0 = await headBefore()
      // cattle work naming the lot
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await recordControl(page).click()
      await page.getByRole('button', { name: /^Record cattle work/ }).click()
      await page.getByLabel('Worked').fill('12')
      await page.getByLabel('What').fill('pregged')
      await page.locator('[data-audit="lot-for-work"]').waitFor({ timeout: 15_000 })
      await selectBunch(page, '[data-audit="lot-for-work"]', LOT6G)
      await page.getByLabel('Where').selectOption({ label: `${PREFIX} West stack` })
      await page.getByRole('button', { name: 'Record work', exact: true }).click()
      await watchStates(page, 'Sent', 20_000, 'Pregged 12 head')
      const { data: worked } = await admin.from('events').select('id, payload').eq('user_id', userId).eq('type', 'cattle_worked').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      await page.goto(`/ranch/activity/${worked?.id}`, { waitUntil: 'domcontentloaded' })
      const wLot = (await page.locator('[data-audit="event-bunch"]').innerText().catch(() => '')).trim(), wWhat = (await page.locator('[data-audit="event-what"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('6G: cattle work names a lot — stored, on the entry, and in the line', worked?.payload?.herd_lot_id === lot6g && wLot === LOT6G && /Pregged 12 head of SMOKE-DAILY-LOOP Pairs at .*West stack/.test(wWhat), `lot "${wLot}" · "${wWhat}"`)
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      const lastWork = (await page.locator('[data-audit="lot-row"]').filter({ hasText: LOT6G }).locator('[data-audit="lot-last-work"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('6G: the lot card\'s last recorded work is the cattle work', /pregged 12 head/.test(lastWork), lastWork.slice(0, 100))
      // ── Block 25: a move names its bunch, and sets the bunch's place ─────────
      // PK's falsifier, as written: record a move of a bunch to a place; the
      // bunch's place reads as that place immediately, and the move in Activity
      // names both. Then once with the network off: it queues, sends on
      // reconnect, and the place is set. Read from the DATABASE first
      // (herd_lots.place_id), then from the painted page.
      const placeOf = async (lot: string) => ((await admin.from('herd_lots').select('place_id').eq('id', lot).maybeSingle()).data as { place_id: string | null } | null)?.place_id ?? null
      const { data: east25, error: e25 } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} 25 east`, kind: 'pasture' }).select('id').single()
      if (e25) throw new Error(`25 place: ${e25.message}`)
      const openMove = async () => {
        await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await recordControl(page).click()
        await page.getByRole('button', { name: /^Move cattle/ }).click()
        await page.locator('[data-audit="lot-for-move"]').waitFor({ timeout: 15_000 })
      }

      // (a) no bunch, no move — the sheet's words ARE the route's words.
      await openMove()
      await page.locator('[data-audit="lot-for-move"]').selectOption('')
      await page.getByLabel('Moved').fill('5')
      await page.getByLabel('To').selectOption({ label: `${PREFIX} West stack` })
      await page.getByRole('button', { name: 'Record move', exact: true }).click()
      const sheetSays = ((await page.getByText(MOVE_NEEDS_BUNCH, { exact: true }).first().innerText({ timeout: 5_000 }).catch(() => '')) ?? '').trim()
      const bare = await page.request.post('/api/log', { data: { type: 'cattle_moved', head: 5, to_place_id: placeId, place_id: placeId } })
      const routeSays = ((await bare.json().catch(() => ({}))) as { error?: string }).error ?? ''
      record('25: a move with no bunch is refused — and the sheet and the route say it in the same words',
        sheetSays === MOVE_NEEDS_BUNCH && bare.status() === 400 && routeSays === MOVE_NEEDS_BUNCH, `sheet "${sheetSays}" · route ${bare.status()} "${routeSays}"`)

      // (b) a move of a bunch to a place — online.
      const before25 = await placeOf(lot6g)
      const hintId = await page.locator('[data-audit="lot-for-move"]').getAttribute('aria-describedby')
      const moveHint = hintId ? (await page.locator(`#${hintId}`).innerText().catch(() => '')).replace(/\s+/g, ' ') : ''
      await selectBunch(page, '[data-audit="lot-for-move"]', LOT6G)
      const preview25 = ((await page.locator('[data-audit="move-preview"]').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      await page.getByRole('button', { name: 'Record move', exact: true }).click()
      const WHO25 = `${LOT6G} · Cows · 5 head`
      await watchStates(page, 'Sent', 20_000, `Moved ${WHO25}`)
      const receipt25 = ((await page.locator('[role="status"]').first().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      const after25 = await placeOf(lot6g)
      const { data: moved } = await admin.from('events').select('id, payload').eq('user_id', userId).eq('type', 'cattle_moved').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      record('25: the move sets the bunch’s place in the same request — true in the database the moment it is Sent, and the receipt says where they are now',
        before25 === null && after25 === placeId && moved?.payload?.herd_lot_id === lot6g && moved?.payload?.place_id === placeId && receipt25.includes(`${WHO25} — now at ${PREFIX} West stack`),
        `place ${before25} → ${after25} (want ${placeId}) · preview "${preview25}" · receipt "${receipt25.slice(0, 110)}"`)

      await page.goto(`/ranch/activity/${moved?.id}`, { waitUntil: 'domcontentloaded' })
      const mLot = (await page.locator('[data-audit="event-bunch"]').innerText().catch(() => '')).trim(), mWhat = (await page.locator('[data-audit="event-what"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      const head1 = await headBefore()
      const where25 = ((await page.locator('[data-audit="lot-row"]').filter({ hasText: LOT6G }).locator('[data-audit="lot-where"]').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      record('25: the move in Activity names the bunch and where it went; the bunch reads as there, with the move as its as-of; the head count stays',
        mLot === `${LOT6G} · Cows` && mWhat.includes(`Moved ${WHO25} to ${PREFIX} West stack`) && where25.includes(`At ${PREFIX} West stack`) && /moved today/.test(where25) && /never changes a bunch/.test(moveHint) && head1 === head0 && Number.isFinite(head0),
        `bunch "${mLot}" · "${mWhat}" · row "${where25}" · head ${head0} → ${head1}`)

      // (c) the same with the network off: it queues, sends on reconnect, and the place is set.
      await openMove()
      await selectBunch(page, '[data-audit="lot-for-move"]', LOT6G)
      await page.getByLabel('To').selectOption({ label: `${PREFIX} 25 east` })
      await page.context().setOffline(true)
      await page.getByRole('button', { name: 'Record move', exact: true }).click()
      // Offline the strip says Saved and STAYS there (the airplane-mode check's own
      // rule); Waiting for signal is what it says once it starts to send.
      const offStates = await watchStates(page, 'Sent', 4_000, `Moved ${LOT6G}`)   // must NOT reach Sent
      const waitingLabel = (await page.locator('[role="status"]').first().getAttribute('data-label').catch(() => '')) ?? ''
      const heldPlace = await placeOf(lot6g)
      await page.context().setOffline(false)
      const onStates = await watchStates(page, 'Sent', 45_000, `Moved ${LOT6G}`)
      const sentPlace = await placeOf(lot6g)
      record('25: with no signal the move waits — named, whole bunch — and on reconnect it sends and the bunch is at the new place',
        offStates[0] === 'Saved' && !offStates.includes('Sent') && heldPlace === placeId && onStates.includes('Sent') && sentPlace === east25.id && waitingLabel.includes(`${LOT6G} · Cows · 44 head`),
        `offline [${offStates.join(' → ')}] place held ${heldPlace === placeId} · online [${onStates.join(' → ')}] place ${sentPlace} (want ${east25.id}) · label "${waitingLabel}"${rawSeen()}`)

      // (d) an older move arriving late never drags the bunch back; a move with
      //     no bunch (from before Block 25) is given none and says so.
      const late = await page.request.post('/api/log', { data: { id: randomUUID(), type: 'cattle_moved', head: 44, herd_lot_id: lot6g, to_place_id: placeId, place_id: placeId, ts: new Date(Date.now() - 6 * 3600_000).toISOString() } })
      const latePlace = await placeOf(lot6g)
      const old25 = randomUUID()
      await admin.from('events').insert({ id: old25, user_id: userId, ranch_id: ranchId, type: 'cattle_moved', ts: new Date(Date.now() - 86_400_000).toISOString(), schema_version: 1, payload: { source: 'manual', schema_version: 1, head: 12, place_id: placeId, to_place_id: placeId, from_place_id: null, herd_lot_id: null } })
      await page.goto(`/ranch/activity/${old25}`, { waitUntil: 'domcontentloaded' })
      const oldWhat = (await page.locator('[data-audit="event-what"]').innerText().catch(() => '')).replace(/\s+/g, ' '), oldBunch = (await page.locator('[data-audit="event-bunch"]').innerText().catch(() => '')).trim()
      record('25: a back-dated move lands but does not move the bunch back; an old move with no bunch is given none, and says so',
        late.status() === 201 && latePlace === east25.id && oldWhat.includes(`Moved 12 head to ${PREFIX} West stack · no bunch named`) && oldBunch === 'No bunch named',
        `late ${late.status()} place ${latePlace === east25.id ? 'unchanged' : latePlace} · old "${oldWhat}" · bunch "${oldBunch}"`)

      // ── Block 25b: the DATABASE decides where a bunch is (072) ────────────────
      // PK's falsifier: A then B; void B → at A; delete A → no place recorded;
      // change a move's bunch X → Y → X loses the place, Y gains it. Plus: a
      // place picked on the edit form is a move; a bunch made at a place is a
      // placement. Capability, not existence — 42883 = 072 is not applied.
      const probe072 = await admin.rpc('rebuild_lot_place', { p_lot: '00000000-0000-0000-0000-000000000000' })
      if (probe072.error?.code === '42883') {
        // A capability gap, named and RED — never a skip to reach green.
        record('25b: the place projection — CAPABILITY GAP: migration 072 is not applied on this database', false, 'void → A · delete → no place · bunch X→Y · edit-form move · placement: none of these can be read until 072 is run')
      } else {
        const post = async (path: string, data: unknown) => { const r = await page.request.post(path, { data }); return { status: r.status(), json: (await r.json().catch(() => ({}))) as Record<string, unknown> } }
        const movesOf = async (lot: string) => ((await admin.from('events').select('id, ts, payload, superseded_by, voided_at, deleted_at').eq('type', 'cattle_moved').eq('payload->>herd_lot_id', lot).order('ts', { ascending: false })).data ?? []) as { id: string; ts: string; payload: Record<string, unknown>; superseded_by: string | null; voided_at: string | null; deleted_at: string | null }[]
        const live = (await movesOf(lot6g)).filter(m => !m.superseded_by && !m.voided_at && !m.deleted_at)
        const toB = live.find(m => m.payload.to_place_id === east25.id)
        // A = West stack (two live moves there: the first, and the back-dated one), B = 25 east.
        const voided = toB ? await post(`/api/activity/${toB.id}/void`, { id: randomUUID(), reason: '25b falsifier' }) : { status: 0, json: {} }
        const afterVoid = await placeOf(lot6g)
        record('25b: void the move to B and the bunch reads as at A — the move before it, by its own time', voided.status === 201 && afterVoid === placeId, `void ${voided.status} · place ${afterVoid === placeId ? 'A' : afterVoid}`)

        for (const m of (await movesOf(lot6g)).filter(m => !m.superseded_by && !m.voided_at && !m.deleted_at)) await page.request.delete(`/api/activity/${m.id}/delete`)
        const afterDelete = await placeOf(lot6g)
        await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
        const noPlace = ((await page.locator('[data-audit="lot-row"]').filter({ hasText: LOT6G }).locator('[data-audit="lot-where"]').innerText().catch(() => '')) ?? '').trim()
        record('25b: delete every live move and the bunch has no place — not the place from before — and the row says so', afterDelete === null && noPlace === NO_PLACE_RECORDED, `place ${afterDelete ?? 'null'} · row "${noPlace}"`)

        const lotY = randomUUID(), LOTY = `${PREFIX} 25b Y`
        await admin.from('herd_lots').insert({ id: lotY, ranch_id: ranchId, class: 'heifers', name: LOTY, head_count: 12, avg_weight: 700, weight_unit: 'lb', created_by: userId, updated_by: userId })
        await admin.from('events').insert({ id: randomUUID(), user_id: userId, ranch_id: ranchId, type: 'head_count_set', ts: new Date().toISOString(), schema_version: 1, payload: { lot_id: lotY, reason: 'created', source: 'manual', head_after: 12, head_before: null, schema_version: 1 } })
        const mx = randomUUID()
        const movedX = await post('/api/log', { id: mx, type: 'cattle_moved', head: 44, herd_lot_id: lot6g, to_place_id: east25.id, place_id: east25.id, ts: new Date().toISOString() })
        const xAt = await placeOf(lot6g)
        const fixed = await post(`/api/activity/${mx}/correct`, { id: randomUUID(), herd_lot_id: lotY, reason: 'wrong bunch' })
        record('25b: change a move\'s bunch from X to Y — X loses the place, Y gains it', movedX.status === 201 && xAt === east25.id && fixed.status === 201 && (await placeOf(lot6g)) === null && (await placeOf(lotY)) === east25.id,
          `move ${movedX.status} X→${xAt === east25.id ? 'B' : xAt} · correct ${fixed.status} · X ${(await placeOf(lot6g)) ?? 'no place'} · Y ${(await placeOf(lotY)) === east25.id ? 'B' : await placeOf(lotY)}`)

        // Ruling 3: the place chip on the bunch EDIT form records a move, through the outbox.
        await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
        await hold(page, page.locator('[data-audit="lot-row"]').filter({ hasText: LOT6G })); await sheet(page).fix.click()   // Block 46: hold → Fix
        await page.locator('[data-audit="lot-place"]').getByRole('radio', { name: `${PREFIX} West stack`, exact: true }).click()
        await page.locator('[data-audit="lot-save"]').click()
        const chipStates = await watchStates(page, 'Sent', 30_000, `Moved ${LOT6G}`)
        const chipMove = (await movesOf(lot6g)).find(m => !m.deleted_at && !m.superseded_by && !m.voided_at)
        record('25b: picking a place on the bunch\'s edit form records a MOVE there through the outbox, and the bunch is there', chipStates.includes('Sent') && (await placeOf(lot6g)) === placeId && chipMove?.payload.to_place_id === placeId && chipMove?.payload.placement !== true,
          `[${chipStates.join(' → ')}] place ${(await placeOf(lot6g)) === placeId ? 'A' : await placeOf(lot6g)} · move ${chipMove ? 'written' : 'MISSING'}${rawSeen()}`)

        // A bunch MADE at a place is a placement: same event, reads "placed at".
        const madeAt = await post('/api/herd/lots', { name: `${PREFIX} 25b made`, class: 'cows', head_count: 9, weight_unit: 'lb', place_id: east25.id })
        const madeId = ((madeAt.json.lot ?? {}) as { id?: string }).id ?? ''
        const placement = (await movesOf(madeId))[0]
        await page.goto(`/ranch/activity/${placement?.id}`, { waitUntil: 'domcontentloaded' })
        const placedWhat = (await page.locator('[data-audit="event-what"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
        record('25b: a bunch made at a place records a placement — it reads "placed at", never "moved", and the bunch is there', (madeAt.status === 200 || madeAt.status === 201) && placement?.payload.placement === true && (await placeOf(madeId)) === east25.id && placedWhat.includes(`${PREFIX} 25b made · Cows · 9 head placed at ${PREFIX} 25 east`) && !/moved/i.test(placedWhat),
          `create ${madeAt.status} · placement ${placement?.payload.placement === true} · "${placedWhat}"`)
      }
    })

    // ── Block 5B, gate 4: correct 6 to 4 after sync, on the phone ──────────────
    // Original, current value, editor, reason, and the resulting balance all
    // visible. Balance read from the receipt the save lands on and from the
    // status strip before it — the same ledger read (lib/hay/queries, through
    // the chain). Skips without migration 054.
    await section('Block 5B, gate 4: correct 6 to 4 after sync, on the phone', async () => {
      const probe = await admin.from('events').select('superseded_by').limit(1)
      if (probe.error) skip('5B: correct 6 → 4 on the phone', `migration 054 not applied (${probe.error.message.slice(0, 60)})`)
      else {
        await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1_000)
        await logFeed(page, 6)
        const seq6 = await watchStates(page, 'Sent', 20_000, 'Fed 6 bales')
        // The answer lines follow the sync by a beat; read the strip until they are there (≤ 8 s).
        let strip6 = ''
        for (let i = 0; i < 32 && !/bales? on hand/.test(strip6); i++) { strip6 = (await page.locator('[role="status"]').first().innerText().catch(() => '')).replace(/\s+/g, ' '); if (!/bales? on hand/.test(strip6)) await page.waitForTimeout(250) }
        const onHand6 = parseInt((strip6.match(/(\d+) bales? on hand/) ?? ['', 'NaN'])[1], 10)
        const { data: six } = await admin.from('events').select('id').eq('user_id', userId).eq('type', 'hay_fed').eq('payload->>bales', '6').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
        record('5B: a 6-bale feeding synced and the strip states the balance', seq6.includes('Sent') && !!six && Number.isFinite(onHand6), `${seq6.join(' → ')} · on hand ${onHand6} · strip: ${strip6.slice(0, 120)}`)
        if (six) {
          await page.goto(`/ranch/activity/${six.id}`, { waitUntil: 'domcontentloaded' })
          await hold(page, page.locator('[data-audit="event-detail"]')); await sheet(page).fix.click()   // Block 46: hold → Fix
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
          const again = await page.locator('[data-audit="row-actions"] [data-audit="event-detail"]').count()   // Block 46: a held card offers Fix; a replaced entry's card is not held
          record('5B: a corrected entry offers no second correction (correct the current entry instead)', again === 0, `${again} correct button(s) on the original`)
        }
      }
    })

    // ── Block 6 (6C): the receipt and the Hay balance state one complete equation ──
    // The audit's receipt left the stacked bales out ("323 from your count of
    // 420 … 102 fed since"), so 420 − 102 = 318 looked like a wrong answer.
    // Stack 5, feed 1, and read the equation off the receipt and off the Hay
    // panel: every term present, it adds up, the numbers agree, ranch scope stated.
    await section('Block 6 (6C): the receipt and the Hay balance state one complete equation', async () => {
      const { error: sErr } = await admin.from('events').insert({ user_id: userId, ranch_id: ranchId, device_id: null, type: 'bales_stacked', ts: new Date().toISOString(), schema_version: 1, payload: { source: 'manual', schema_version: 1, count: 5, place_id: placeId } })
      if (sErr) skip('6C: the equation', `could not stack 5 bales: ${sErr.message}`)
      else {
        await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1_000)
        await logFeed(page, 1)
        await watchStates(page, 'Sent', 20_000, 'Fed 1 bale')
        let strip = ''
        // textContent, not innerText: the equation sits behind "How that adds up" (11.12).
        for (let i = 0; i < 32 && !/bales? on hand/.test(strip); i++) { strip = ((await page.locator('[role="status"]').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' '); if (!/bales? on hand/.test(strip)) await page.waitForTimeout(250) }
        const EQ = /(\d+) counted [^+]+ \+ (\d+) added \u2212 (\d+) fed = (-?\d+) bales? on hand/
        const m = strip.match(EQ)
        const nums = m ? m.slice(1, 5).map(Number) : null
        const adds = !!nums && nums[0] + nums[1] - nums[2] === nums[3]
        // Block 11 (11.12): the equation is still stated in full and still has
        // to add up — it just sits behind "How that adds up" now instead of in
        // the middle of the receipt. The balance leads. Read with textContent,
        // because a closed <details> is exactly what this is testing.
        const receiptText = ((await page.locator('[role="status"]').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ')
        const m3 = receiptText.match(EQ)
        const balanceFirst = (await page.locator('[data-audit="receipt-balance"]').first().textContent().catch(() => '') ?? '').replace(/\s+/g, ' ').trim()
        const behindTap = await page.locator('[data-audit="receipt-detail"]').count()
        record('6C/11.12: the receipt leads with the balance and keeps the complete equation one tap away — it still adds up, the 5 stacked are still in it',
          !!m3 && m3.slice(1, 5).map(Number)[0] + m3.slice(1, 5).map(Number)[1] - m3.slice(1, 5).map(Number)[2] === m3.slice(1, 5).map(Number)[3]
            && Number(m3[2]) === 5 && /across the ranch/.test(receiptText)
            && /bales? on hand/.test(balanceFirst) && !/counted/.test(balanceFirst) && behindTap === 1,
          `balance "${balanceFirst}" · detail ${behindTap} · equation "${m3 ? m3[0] : 'MISSING'}"`)
        await page.goto('/ranch/hay', { waitUntil: 'domcontentloaded' })
        // Wait for it, do not sample it — and read textContent, because the
        // equation sits inside the closed Details disclosure (7.7).
        await page.locator('[data-audit="hay-equation"]').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
        const eq = ((await page.locator('[data-audit="hay-equation"]').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ')
        const m2 = eq.match(EQ)
        record('6C: the Hay balance states the same equation with the same numbers — one explanation model', !!m2 && !!m && m2.slice(1, 5).join() === m.slice(1, 5).join() && /across the ranch/.test(eq), m2 ? `"${m2[0]}"` : `no equation in: ${eq.slice(0, 160)}`)
      }
    })

    // ── Block 6 (6J): Work under Ranch — cutting and baling have a surface ──────
    // A Scout session is a job (stable id, derived, never an event). The Work
    // section lists it with type, time, machine, origin, quantity and state,
    // filters it by kind, and the Activity record carries it under the same id.
    // A Scout's bale count is bales made — the hay ledger never reads it.
    await section('Block 6 (6J): Work under Ranch — cutting and baling have a surface', async () => {
      const EQ = /= (-?\d+) bales? on hand/
      // WAIT for the equation, do not sample it — and wait for it where it
      // actually lives. 7.7 moved the equation inside the "Details"
      // disclosure, so it is ATTACHED but never VISIBLE, and the default
      // waitFor state (visible) burns its whole timeout and then reads
      // nothing. Wait for attachment and read textContent, which does not
      // care whether the <details> is open. A balance that still will not
      // parse is reported with what was on the page, never as a bare NaN —
      // NaN fails every comparison silently, which is how "a void moved the
      // balance" gets printed when the balance was simply not there.
      let hayEvidence = ''
      const onHandNow = async () => {
        await page.goto('/ranch/hay', { waitUntil: 'domcontentloaded' })
        const eq = page.locator('[data-audit="hay-equation"]').first()
        await eq.waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
        const t = ((await eq.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
        const n = parseInt((t.match(EQ) ?? ['', 'NaN'])[1], 10)
        if (!Number.isFinite(n)) hayEvidence = `no balance on ${page.url().replace(BASE, '')} — equation "${t.slice(0, 90)}" · card ${await page.locator('[data-audit="hay-details"]').count()}`
        return n
      }
      const hayBefore = await onHandNow()
      const jobId = randomUUID()
      const started = new Date(Date.now() - 2 * 3_600_000).toISOString(), ended = new Date(Date.now() - 3_600_000).toISOString()
      const { error: jErr } = await admin.from('jobs').insert({ id: jobId, user_id: userId, ranch_id: ranchId, device_id: null, hardware_id: 'smoke-scout', started_at: started, ended_at: ended, duration_s: 3600, seq_start: 1, seq_end: 400, event_count: 400, evicted_count: 0, coverage: 1, centroid_lat: 46.94, centroid_lng: -108.19, bbox: {}, track: [], pauses: [], multi_field: false, stats: {}, deriver_version: 'smoke', derived_at: new Date().toISOString() })
      const { error: aErr } = jErr ? { error: null } : await admin.from('job_annotations').insert({ job_id: jobId, user_id: userId, ranch_id: ranchId, name: 'Baling', machine: 'baler', actual_bale_count: 32 })
      if (jErr || aErr) skip('6J: Work under Ranch', `fixture: ${(jErr ?? aErr)!.message.slice(0, 80)}`)
      else {
        // Block 12 (12.7): Work is no longer a hub section — machine sessions
        // are the record's Machines filter (6J). The page still answers; the
        // 6J reachability rule is held by the 12.7 check below.
        const workSection = 'Work'
        await page.goto('/ranch/work', { waitUntil: 'domcontentloaded' })
        const row = page.locator('[data-audit="work-list"] > li').filter({ has: page.locator(`[data-id="${jobId}"]`) }).first()
        const rowLi = page.locator(`[data-audit="work-list"] > li[data-id="${jobId}"]`)
        const d = async (k: string) => (await rowLi.locator(`[data-audit="work-${k}"]`).innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        const type = await d('type'), state = await d('state'), machine = await d('machine'), origin = await d('origin'), qty = await d('quantity'), when = await d('when')
        const stockRule = await page.locator('[data-audit="stock-rule"]').count()
        void row
        record('6J/12.7: the Work page answers type, time, machine, origin, quantity and state — with the stock rule stated', /Work/.test(workSection) && type === 'Baling' && state === 'ended' && /Machine: baler/.test(machine) && /^Origin: /.test(origin) && /32 bales counted by hand/.test(qty) && /\d – \d|\d –|–/.test(when) && stockRule === 1, `section "${workSection.slice(0, 60)}" · ${type} · ${state} · ${machine} · ${origin} · ${qty} · ${when} · stock rule ${stockRule}`)
        await page.goto('/ranch/work?kind=cutting', { waitUntil: 'domcontentloaded' })
        const cuttingEmpty = await page.locator('[data-audit="work-empty"]').count(), cuttingRows = await page.locator('[data-audit="work-row"]').count()
        await page.goto('/ranch/work?kind=baling', { waitUntil: 'domcontentloaded' })
        const balingRows = await page.locator(`[data-audit="work-list"] > li[data-id="${jobId}"]`).count()
        record('6J: the kind filters hold — Cutting lists nothing (and says so), Baling lists the session', cuttingEmpty === 1 && cuttingRows === 0 && balingRows === 1, `cutting empty ${cuttingEmpty} rows ${cuttingRows} · baling rows ${balingRows}`)
        await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
        const inRecord = page.locator(`[data-audit="activity-list"] li[data-id="${jobId}"] a`)
        const recText = (await inRecord.innerText().catch(() => '')).replace(/\s+/g, ' '), recHref = await inRecord.getAttribute('href').catch(() => null)
        const hayAfter = await onHandNow()
        record('6J: the session is in the Activity record under the same id, opening its job — and the Scout\'s bale count never moved the hay balance', /Baling · 1 h/.test(recText) && /32 bales counted by hand/.test(recText) && recHref === `/jobs/${jobId}` && Number.isFinite(hayBefore) && hayAfter === hayBefore, `"${recText.slice(0, 70)}" → ${recHref} · hay ${hayBefore} → ${hayAfter}${hayEvidence ? ` · ${hayEvidence}` : ''}`)
      }
    })

    // ── Block 7 (Parts 2–3): Weather in the right order, and Rain on my places ──
    // Two readings by two people at two places, a third place with none. Every
    // place gets a row: the latest reading, its day, who recorded it; a missing
    // reading is missing, never zero; totals are Recorded rain; the history
    // expands; Log rain opens the sheet on Rain with the place chosen. And the
    // order: (warning) → forecast → rain on my places → county rainfall summary
    // (chart and sources behind disclosures) → drought leading with its category.
    await section('Block 7 (Parts 2–3): Weather in the right order, and Rain on my places', async () => {
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
      // 7D.4 CHANGED WHAT BELONGS HERE. "Every place has a row" was the thing
      // that made this section 35% of the page, two of five rows saying "no
      // rain recorded yet". A place earns its row now by having a reading, a
      // device, or a pin; the rest sit behind the picker. So the assertion
      // splits: the places WITH readings still carry the full answer, and the
      // place WITHOUT one is no longer on the list — it is in the picker,
      // counted, reachable. What must never happen either way is a zero
      // standing in for a missing reading, and that is still checked.
      const picker = (await page.locator('[data-audit="weather-place-picker"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('7-3/7D.4: a place with a reading carries the latest one, its day and who recorded it', rowRe('0\\.80', 'smoke-daily-loop-b').test(north) && rowRe('0\\.35', 'Smoke A').test(west) && /Recorded rain/.test(section) && !/rainfall/i.test(section), `north "${north.slice(0, 70)}" · west "${west.slice(0, 60)}"`)
      record('7-3/7D.4 + 43: a place with no reading is off the list — never a zero', audit === '' && picker === '' && !/0\.00/.test(section), `audit row "${audit.slice(0, 30)}" · picker "${picker.slice(0, 50)}"`)
      await page.locator(`[data-audit="rain-history-${northId}-summary"]`).click().catch(() => {})
      const hist = (await page.locator(`[data-audit="rain-history-${northId}"] [data-audit="rain-readings"]`).innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('7-3: a row expands to its history — each reading with its day and who recorded it', /recorded by smoke-daily-loop-b/.test(hist) && /0\.80"/.test(hist), hist.slice(0, 80))
      // 7D.4: Log rain must be tapped on a LISTED place. The audit place has no
      // reading, no device and no pin, so it is in the picker now — clicking a
      // row that is deliberately not on the list is what crashed this run.
      await page.locator(`[data-audit="rain-place-row"][data-place="${northId}"] [data-audit="log-rain-here"]`).click()
      await page.getByLabel('Where').waitFor({ timeout: 10_000 }).catch(() => {})
      // The sheet fetches /api/places when it opens, and a <select> cannot show
      // a pre-chosen value before that value's <option> exists. Reading
      // inputValue() the instant the select appears races the fetch and returns
      // "" every time. Check 2F above already waits for the option; this one
      // did not. Measured: "" with 2 options loaded, then the right id once the
      // option attaches.
      await page.getByLabel('Where').locator(`option[value="${northId}"]`).waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
      const wherePre = await page.getByLabel('Where').inputValue().catch(() => '')
      const rainField = await page.getByLabel('Rain').count()
      record('7-3: Log rain on a row opens the record sheet on Rain with that place chosen', rainField >= 1 && wherePre === northId, `Where=${wherePre.slice(0, 8)}… · rain field ${rainField}`)
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
      // 7D.5 REMOVED THE DISCLOSURE. The history used to sit behind "View
      // history" and this check drove it — closed it, opened it, watched the
      // chart survive. It is always open now: measured, opening it cost +404px
      // at 390 and +447px at 320 and ZERO requests, because the data is already
      // resolved server-side and the panel is inert markup either way.
      //
      // So the assertion becomes the stronger one it was standing in for: the
      // chart is THERE, on load, with no tap. The old version would have gone
      // green on a page where the chart was behind a disclosure nobody opens.
      const rainHist = page.locator('[data-audit="rain-history"]')
      const stillADisclosure = await rainHist.evaluate(el => el.tagName.toLowerCase() === 'details').catch(() => false)
      const chartsOnLoad = await page.locator('[data-audit="weather-estimate"] .recharts-wrapper').count()
      record('7-2/7D.5: county rainfall reads as one answer, and the 30-year history is drawn on load — no tap, no disclosure', /^[\d.]+" this year · [\d.]+" (below|above) station normal$/.test(summary) && /^(County estimate|Station gauge) · through [A-Z][a-z]{2} \d{1,2}$/.test(summarySrc) && chartsOnLoad === 1 && !stillADisclosure, `"${summary}" · "${summarySrc}" · charts on load ${chartsOnLoad} · disclosure ${stillADisclosure}`)
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
    })

    // ── Block 6 (6A): single-field corrections preserve every other field ──────
    // The Sept 8 audit: a quantity-only correction wrote nulls over the lot and
    // place. Every check here changes ONE thing through the form and reads the
    // effective entry back through the chain, field by field — fast and slow
    // option loads, owner and member entries, a retired lot, a lot the ranch no
    // longer lists at all, and the explicit Clear as the only path to null.
    await section('Block 6 (6A): single-field corrections preserve every other field', async () => {
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
          await hold(p, p.locator('[data-audit="event-detail"]')); await sheet(p).fix.click()   // Block 46: hold → Fix
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
          await hold(page, page.locator('[data-audit="event-detail"]')); await sheet(page).fix.click()   // Block 46: hold → Fix
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
          await hold(page, page.locator('[data-audit="event-detail"]')); await sheet(page).fix.click()   // Block 46: hold → Fix
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
          record('6A/13: a lot that is off the list is named so on the form and a quantity-only correction keeps it', /off the list/.test(retiredLabel) && h5.payload.herd_lot_id === lot2 && h5.payload.bales === 1 && bad5.length === 0, `option "${retiredLabel}" · ${describe(bad5, h5)}`)
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
    })

    // ── Block 6 (6B): superseded entries marked the same way on every timeline ──
    // The audit read a place timeline with the original and the correction as
    // two ordinary rows: two feedings. Operational lists (a place, the Ranch
    // hub, Today's Activity tab) show the EFFECTIVE entry marked "corrected"
    // with what it replaced one tap away; the Activity record (audit history)
    // shows every revision, the replaced original struck and marked.
    await section('Block 6 (6B): superseded entries marked the same way on every timeline', async () => {
      // Block 26b (3): this skipped EVERY run. It looked for the gate-4 correction
      // (made ~40 checks earlier) on the place timeline, which shows the ten
      // newest standing rows — and by now the sections between have written
      // more than ten newer entries at this place, so it was never there. The
      // rule under test is the timeline's, not that one row's: so make a fresh
      // 6-bale feeding here, now, correct it to 4 through the same route the
      // phone uses, and read the timeline with the correction guaranteed inside
      // its window. Nothing is skipped and nothing is flaky about it.
      const sixId = randomUUID()
      await admin.from('events').insert({ id: sixId, user_id: userId, ranch_id: ranchId, device_id: null, type: 'hay_fed', ts: new Date().toISOString(), schema_version: 1, payload: { source: 'manual', schema_version: 1, bales: 6, herd_lot_id: null, place_id: placeId } })
      const fixed6 = await page.request.post(`/api/activity/${sixId}/correct`, { data: { id: randomUUID(), bales: 4, reason: 'was 4, typed 6' } })
      const fourRowJson = (await fixed6.json().catch(() => ({}))) as { event?: { id: string; supersedes_event_id: string | null } }
      const four = fixed6.status() === 201 && fourRowJson.event ? { id: fourRowJson.event.id, supersedes_event_id: fourRowJson.event.supersedes_event_id } : null
      if (!four) record('6B: timelines — the 6 → 4 correction could not be made', false, `correct ${fixed6.status()}`)
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
        await openFolds(page)
        const placeRows = operational(await readList(page, '[data-audit="place-activity"]'))
        record('6B: the place timeline shows one feeding — the effective "Fed 4 bales" marked corrected, "Fed 6 bales" only inside what it replaced', placeRows.ok, placeRows.detail)
        // Block 12 (12.8): the hub no longer lists rows; the record below is the surface.
        // Block 12 (12.13): Today's Activity tab is gone — its rows were a subset of
        // the record. The same assertion stands on the Ranch hub above and on the
        // record below; a third copy on a surface that no longer exists is not evidence.
        await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
        const history = await readList(page, '[data-audit="activity-list"]')
        const hSix = history.find(r => r.id === four.supersedes_event_id), hFour = history.find(r => r.id === four.id)
        const struck = await page.locator('[data-audit="activity-list"] li[data-marker="replaced"] s').count()
        record('6B: the Activity record keeps every revision — the original struck and marked replaced, the correction marked corrected', !!hSix && hSix.marker === 'replaced' && /replaced/.test(hSix.text) && !!hFour && hFour.marker === 'corrected' && /corrected/.test(hFour.text) && struck >= 1, `Fed 6 → ${hSix?.marker ?? 'MISSING'} · Fed 4 → ${hFour?.marker ?? 'MISSING'} · struck ${struck}`)
      }
    })

    // ── Block 6 (6B-2): a void stands on every operational timeline — marked, greyed, not counted ──
    // PK: a void is a fact about the day. The hand who logged it must never find
    // his entry gone with no explanation; "caught up" never means an entry
    // vanished. Void a feeding through the form and read it back off the place,
    // the Ranch hub and Today's Activity tab, marked "voided", with the balance unmoved.
    await section('Block 6 (6B-2): a void stands on every operational timeline — marked, greyed, not counted', async () => {
      const EQ = /= (-?\d+) bales? on hand/
      // WAIT for the equation, do not sample it — and wait for it where it
      // actually lives. 7.7 moved the equation inside the "Details"
      // disclosure, so it is ATTACHED but never VISIBLE, and the default
      // waitFor state (visible) burns its whole timeout and then reads
      // nothing. Wait for attachment and read textContent, which does not
      // care whether the <details> is open. A balance that still will not
      // parse is reported with what was on the page, never as a bare NaN —
      // NaN fails every comparison silently, which is how "a void moved the
      // balance" gets printed when the balance was simply not there.
      let hayEvidence = ''
      const onHandNow = async () => {
        await page.goto('/ranch/hay', { waitUntil: 'domcontentloaded' })
        const eq = page.locator('[data-audit="hay-equation"]').first()
        await eq.waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
        const t = ((await eq.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
        const n = parseInt((t.match(EQ) ?? ['', 'NaN'])[1], 10)
        if (!Number.isFinite(n)) hayEvidence = `no balance on ${page.url().replace(BASE, '')} — equation "${t.slice(0, 90)}" · card ${await page.locator('[data-audit="hay-details"]').count()}`
        return n
      }
      const before = await onHandNow()   // read BEFORE the feeding: feed 7 then void it must net to zero
      const { data: v0 } = await admin.from('events').insert({ user_id: userId, ranch_id: ranchId, device_id: null, type: 'hay_fed', ts: new Date().toISOString(), schema_version: 1, payload: { source: 'manual', schema_version: 1, bales: 7, herd_lot_id: lotId, place_id: placeId } }).select('id').single()
      if (!v0) skip('6B-2: voids', 'could not seed the feeding to void')
      else {
        const fed = await onHandNow()
        // Block 11 (11.13): the Void BUTTON is gone — 7D ruled "void" does not
        // survive as a user-facing word, and Delete's record path took over
        // what a person meant by it. The MECHANISM is unchanged and still
        // worth every check below, so the void is made through the route the
        // way any other client would, and everything after this line is
        // exactly the assertion it always was: a void stands on every
        // timeline, marked, greyed, and counting for nothing.
        await page.goto(`/ranch/activity/${v0.id}`, { waitUntil: 'domcontentloaded' })
        const voided = await page.request.post(`/api/activity/${v0.id}/void`, {
          data: { id: randomUUID(), reason: '6B-2 never happened' },
        })
        const voidJson = await voided.json().catch(() => ({} as Record<string, unknown>))
        const voidId = String(((voidJson.event ?? {}) as { id?: string }).id ?? '')
        record('6B-2/11.13: a void is still recordable through the route with no button on the screen',
          voided.ok() && !!voidId && (await page.locator('[data-audit="void-entry"]').count()) === 0,
          `${voided.status()} · void ${voidId.slice(0, 8) || 'NONE'} · buttons on screen ${await page.locator('[data-audit="void-entry"]').count()}`)
        if (voidId) await page.goto(`/ranch/activity/${voidId}?saved=1`, { waitUntil: 'domcontentloaded' })
        const after = await onHandNow()
        const readRows = async (sel: string) => page.locator(`${sel} > li`).evaluateAll(els => els.map(li => ({ id: li.getAttribute('data-id') ?? '', marker: li.getAttribute('data-marker') ?? 'none', text: (li.querySelector('a')?.textContent ?? '').replace(/\s+/g, ' ').trim(), grey: !!li.querySelector('a span.text-secondary-ink'), chain: (li.querySelector('[data-audit="row-chain"]')?.textContent ?? '').replace(/\s+/g, ' ') })))
        await page.goto(`/ranch/places/${placeId}`, { waitUntil: 'domcontentloaded' })
        await openFolds(page)
        const pl = (await readRows('[data-audit="place-activity"]')).find(r => r.id === voidId)
        const plOrig = (await readRows('[data-audit="place-activity"]')).filter(r => r.id === v0.id)
        record('6B-2/12.5: the removed feeding stands on the place timeline — marked removed, greyed, what it removed one tap away; the original not a second row', !!pl && pl.marker === 'voided' && /removed/i.test(pl.text) && pl.grey && /Fed 7 bales/.test(pl.chain) && plOrig.length === 0, pl ? `"${pl.text.slice(0, 50)}" · grey ${pl.grey} · chain "${pl.chain.slice(0, 60)}" · original rows ${plOrig.length}` : `void row ${voidId.slice(0, 8)} MISSING`)
        // 12.8: the hub no longer lists rows; the record keeps the void in view.
        await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
        await page.locator(`li[data-id="${voidId}"]`).first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {})
        const hub = (await page.locator('li[data-id]').evaluateAll(els => els.map(li => ({ id: li.getAttribute('data-id') ?? '', marker: li.getAttribute('data-marker') ?? 'none' })))).find(r => r.id === voidId)
        record('6B-2: the record keeps the void, marked — never hidden', !!hub && hub.marker === 'voided', `record ${hub?.marker ?? 'MISSING'}`)
        record('6B-2: the void counts toward no balance — the 7 bales fed then voided leave hay on hand where it was', Number.isFinite(before) && fed === before - 7 && after === before, `on hand ${before} → fed ${fed} → voided ${after}${hayEvidence ? ` · ${hayEvidence}` : ''}`)
      }
    })

    // ── Block 6 (6D): a save refreshes what it changed, from every entry point ──
    // The audit saved a feeding from Ranch: the sheet closed, the hub still read
    // the old bales and the old recent rows. Record from the Ranch hub's FAB and,
    // without navigating, watch the hub's Hay number and its recent list follow
    // the sync — with the receipt strip on that page.
    await section('Block 6 (6D): a save refreshes what it changed, from every entry point', async () => {
      const prior6d = page.viewportSize()
      await page.setViewportSize({ width: 390, height: 844 })   // the FAB is the phone's entry point (md:hidden)
      await page.goto('/ranch', { waitUntil: 'domcontentloaded' })
      // Block 47: the record is a tab on the Ranch view — open it; the count stays on the tab's label.
      await page.locator('[data-audit="ranch-tile"][data-tile="record"]').click({ timeout: 15_000 }).catch(() => {})
      // Block 12 (12.7/12.8): hay left the hub; the record tile counts today's
      // entries and the person line says what was done. Both must follow a save
      // made from this page, without navigating.
      const entriesToday = async () => parseInt((((await page.locator('[data-audit="ranch-tile"][data-tile="record"] [data-audit="tile-number"]').textContent().catch(() => '')) ?? '').match(/(\d+)/) ?? ['', '0'])[1], 10)
      const beforeHay = await entriesToday()
      const firstBefore = ((await page.locator('[data-audit="ranch-today"]').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      await logFeed(page, 2)
      const strip = page.locator('[data-audit="global-save-status"] [role="status"]')
      let stripText = ''
      for (let i = 0; i < 80 && !/Sent/.test(stripText); i++) { stripText = ((await strip.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' '); if (!/Sent/.test(stripText)) await page.waitForTimeout(250) }
      // Block 23: a sent receipt is one line and says what the feeding MEANT
      // ("161 bales on hand"), not what was tapped a second ago. It still names
      // the record it is about — in the strip's own attribute — so this asks
      // for that rather than for words the ruling took off the screen.
      const stripNames = ((await page.locator('[data-audit="global-save-status"] [data-audit="save-strip"]').getAttribute('data-label').catch(() => '')) ?? '')
      record('6D: recorded from the Ranch hub, the receipt strip stands on that page and reaches Sent', /Sent/.test(stripText) && /Fed 2 bales/.test(stripNames) && /on hand/.test(stripText), stripText.slice(0, 140) || 'no strip')
      // Block 32: the page proves it caught up — its ledger stamp must reach the
      // feeding's ingested_at (the 6D/12.8 tile stayed at 28 for 15 s once on
      // production). The stamp is waited on, then the tile is read ONCE.
      const { data: fed2Row } = await admin.from('events').select('id, ingested_at').eq('user_id', userId).eq('type', 'hay_fed').eq('payload->>bales', '2').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      const fed2At = (fed2Row as { ingested_at?: string } | null)?.ingested_at ?? null
      const caught6d = await stampReaches(page, fed2At, 60_000)
      const afterHay = await entriesToday()
      const firstAfter = ((await page.locator('[data-audit="ranch-today"]').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      record('6D/12.8: without navigating, the record tile and Today on the ranch follow the sync — the page\'s stamp reaches the feeding, then the tile reads it', Number.isFinite(beforeHay) && afterHay === beforeHay + 1 && /Fed 2 bales/.test(firstAfter) && firstAfter !== firstBefore && caught6d.ok, `entries today ${beforeHay} → ${afterHay} · stamp ${caught6d.stamp ?? 'none'} vs row ${fed2At ?? 'none'} caught up ${caught6d.ok} in ${caught6d.ms} ms · "${firstAfter.slice(0, 70)}"`)
      if (prior6d) await page.setViewportSize(prior6d)
    })

    // ── Block 32: one hay number ────────────────────────────────────────────
    // GPT's audit: after 41 feedings the receipt and Activity said 3,075 and
    // Today's tile said 3,123 — exactly the last two feedings. The stored total
    // was right; the tile was a render that predated them. Now every ledger
    // page stamps what it read and the phone refreshes until the stamp reaches
    // what it knows landed. The falsifier: ten feedings back to back, and after
    // each one the receipt, the tile, the route and Activity agree — with no
    // navigation and no pull. Then a phone that wakes on Today catches up on
    // what another hand recorded while it slept, without a tap.
    await section('Block 32: one hay number', async () => {
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('#ledger-hay').waitFor({ timeout: 20_000 }).catch(() => {})
      // Sign-aware: a negative on hand paints with a minus (either glyph) and must read as one.
      const onHandOf = (s: string) => { const m = s.match(/(-|−)?(\d[\d,]*) bales? on hand/); return m ? (m[1] ? -1 : 1) * parseInt(m[2].replace(/,/g, ''), 10) : null }
      const tile = async () => onHandOf((await page.locator('#ledger-hay').innerText().catch(() => '')).replace(/\s+/g, ' '))
      const route = async () => { const r = await page.request.get('/api/ranch/hay-on-hand'); return ((await r.json().catch(() => ({}))) as { bales?: number | null }).bales ?? null }
      const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
      // Activity is read over the wire (a fresh render), never by navigating the page under test.
      const inActivity = async (id: string) => (await (await page.request.get(`/ranch/activity?from=${day}&to=${day}`)).text()).includes(`data-id="${id}"`)
      const lines: string[] = []
      let allAgree = true, slowest = 0
      // Small feedings: the fixture's stack must stay positive for every section after this one.
      const feedings: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const fedLabel = (n: number) => `Fed ${n} bale${n === 1 ? '' : 's'}`
      for (const bales of feedings) {
        const t0 = Date.now()
        await logFeed(page, bales)
        const states = await watchStates(page, 'Sent', 45_000, fedLabel(bales))
        const strip = page.locator('[role="status"]').first()
        const receipt = onHandOf((await strip.innerText().catch(() => '')).replace(/\s+/g, ' '))
        const { data: row } = await admin.from('events').select('id, ingested_at').eq('user_id', userId).eq('type', 'hay_fed').eq('payload->>bales', String(bales)).order('ingested_at', { ascending: false }).limit(1).maybeSingle()
        const r = row as { id: string; ingested_at: string } | null
        const caught = await stampReaches(page, r?.ingested_at ?? null, 30_000)
        const painted = await tile(), served = await route(), listed = r ? await inActivity(r.id) : false
        const agree = states.includes('Sent') && receipt != null && painted === receipt && served === receipt && listed && caught.ok
        slowest = Math.max(slowest, Date.now() - t0)
        if (!agree) { allAgree = false; lines.push(`fed ${bales}: [${states.join(' → ')}] receipt ${receipt} · tile ${painted} · route ${served} · in Activity ${listed} · stamp ${caught.stamp ?? 'none'} vs ${r?.ingested_at ?? 'no row'} caught up ${caught.ok} in ${caught.ms} ms`) }
      }
      record('32: ten feedings back to back — after each one the receipt, the Today tile, the on-hand route and Activity agree, with no navigation and no pull', allAgree, lines.length ? lines.slice(0, 3).join(' | ') : `all ten agreed · slowest feeding-to-agreement ${slowest} ms`)

      // Two saved before the first has sent: the page must catch up to the LAST one.
      await logFeed(page, 11); await logFeed(page, 12)
      const states32 = await watchStates(page, 'Sent', 45_000, 'Fed 12 bales')
      const receipt32 = onHandOf((await page.locator('[role="status"]').first().innerText().catch(() => '')).replace(/\s+/g, ' '))
      const { data: row32 } = await admin.from('events').select('id, ingested_at').eq('user_id', userId).eq('type', 'hay_fed').eq('payload->>bales', '12').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      const caught32 = await stampReaches(page, (row32 as { ingested_at?: string } | null)?.ingested_at ?? null, 30_000)
      const tile32 = await tile(), route32 = await route()
      record('32: two feedings saved back to back — the tile reaches the second one\'s number, the one the receipt shows', states32.includes('Sent') && receipt32 != null && tile32 === receipt32 && route32 === receipt32 && caught32.ok, `[${states32.join(' → ')}] receipt ${receipt32} · tile ${tile32} · route ${route32} · caught up ${caught32.ok} in ${caught32.ms} ms`)

      // A phone asleep in a pickup: another hand feeds while this page is hidden; on waking it catches up with no tap.
      const setVisibility = (state: 'hidden' | 'visible') => page.evaluate(`(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${state}' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${state === 'hidden'} }); document.dispatchEvent(new Event('visibilitychange')) })()`)
      await setVisibility('hidden')
      const sleptId = randomUUID()
      const { data: sleptRow } = await admin.from('events').insert({ id: sleptId, user_id: userIdB, ranch_id: ranchId, type: 'hay_fed', ts: new Date().toISOString(), schema_version: 1, payload: { source: 'manual', schema_version: 1, place_id: null, bales: 3, herd_lot_id: null } }).select('ingested_at').single()
      const sleptAt = (sleptRow as { ingested_at?: string } | null)?.ingested_at ?? null
      const beforeWake = await tile()
      await page.waitForTimeout(2_500)
      const stillAsleep = await tile()
      await setVisibility('visible')
      const woke = await stampReaches(page, sleptAt, 30_000)
      const afterWake = await tile(), routeWake = await route()
      record('32: a phone that wakes on Today catches up on what another hand fed while it slept, without a tap', sleptAt != null && woke.ok && afterWake === routeWake && beforeWake != null && afterWake === beforeWake - 3, `before ${beforeWake} · while hidden ${stillAsleep} · after waking ${afterWake} (route ${routeWake}) · stamp caught up ${woke.ok} in ${woke.ms} ms`)
    })

    // ── Block 33: feeding in three taps ─────────────────────────────────────
    // GPT's audit kept SIM-Corrals as Where for the cows after a bull move — it
    // would have recorded cow feedings in the wrong place. Now the bunch decides
    // Where, a feeding starts from the bunch (hold the row → Feed → number →
    // Record: three taps plus the number), and Today's repeat card offers every
    // regularly fed bunch. The falsifier: three bunches at three places, fed in
    // a row; each one's Where is where that bunch is.
    await section('Block 33: feeding in three taps', async () => {
      const base = { lng: -108.43, lat: 47.12 }
      const square = (i: number) => { const x = base.lng + i * 0.006, y = base.lat; return [[x, y], [x + 0.003, y], [x + 0.003, y + 0.003], [x, y + 0.003], [x, y]] }
      const trio: { name: string; lotId: string; placeId: string; placeName: string }[] = []
      for (let i = 0; i < 3; i++) {
        const placeName = `${PREFIX} 33 pasture ${i + 1}`
        const { data: pl, error: pErr } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: placeName, kind: 'pasture', geometry: { type: 'Polygon', coordinates: [square(i)] }, acres: 120 }).select('id').single()
        if (pErr) throw new Error(`33 place: ${pErr.message}`)
        const lotId = randomUUID(); const name = `${PREFIX} 33 bunch ${i + 1}`
        const { error: lErr } = await admin.from('herd_lots').insert({ id: lotId, ranch_id: ranchId, class: 'cows', name, head_count: 30 + i, avg_weight: 1100, weight_unit: 'lb', created_by: userId, updated_by: userId })
        if (lErr) throw new Error(`33 lot: ${lErr.message}`)
        await admin.from('events').insert({ id: randomUUID(), user_id: userId, ranch_id: ranchId, type: 'head_count_set', ts: new Date(Date.now() - 4 * 86_400_000).toISOString(), schema_version: 1, payload: { lot_id: lotId, reason: 'created', source: 'manual', head_count: 30 + i } })
        // The move goes through the route so the ranch's own rule (072) places the bunch.
        const mv = await page.request.post('/api/log', { data: { id: randomUUID(), type: 'cattle_moved', head: 30 + i, herd_lot_id: lotId, to_place_id: pl.id, place_id: pl.id, ts: new Date(Date.now() - (3 - i) * 86_400_000).toISOString() } })
        if (!mv.ok()) throw new Error(`33 move: ${mv.status()} ${(await mv.text()).slice(0, 80)}`)
        trio.push({ name, lotId, placeId: pl.id as string, placeName })
      }
      // Make the last-used place a wrong answer on purpose: the West stack.
      await logFeed(page, 1, { place: `${PREFIX} West stack` })
      await watchStates(page, 'Sent', 45_000, 'Fed 1 bale')
      const whereOf = async () => page.getByLabel('Where').inputValue().catch(() => '')
      const fedToOf = async () => page.locator('[data-audit="fed-to"]').inputValue().catch(() => '')
      const rowPlace = async (bales: number) => { const { data } = await admin.from('events').select('payload').eq('user_id', userId).eq('type', 'hay_fed').eq('payload->>bales', String(bales)).order('ingested_at', { ascending: false }).limit(1).maybeSingle(); return ((data as { payload?: { place_id?: string | null; herd_lot_id?: string | null } } | null)?.payload) ?? null }

      // From Cattle: hold the bunch → Feed → number → Record. Three taps, and Where is where THAT bunch is.
      const cattle: string[] = []
      let cattleOk = true
      for (let i = 0; i < 3; i++) {
        const t = trio[i], bales = 2 + i
        await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
        const row = page.locator('[data-audit="lot-row"]', { hasText: t.name }).first()
        await row.waitFor({ timeout: 20_000 }).catch(() => {})
        const held = await hold(page, row)                                                                   // tap 1
        await page.locator('[data-audit="row-actions-sheet"] [data-audit="row-action-extra"]', { hasText: 'Feed' }).first().click({ timeout: 10_000 }).catch(() => {})   // tap 2
        await page.locator('[data-audit="fed-to"]').waitFor({ timeout: 15_000 }).catch(() => {})
        await page.waitForFunction((pid: string) => (document.querySelector('[data-audit="fed-to"]') as HTMLSelectElement | null)?.value === pid || false, t.lotId, { timeout: 10_000 }).catch(() => {})
        await page.waitForFunction((pid: string) => Array.from(document.querySelectorAll('select')).some(s => (s as HTMLSelectElement).value === pid), t.placeId, { timeout: 10_000 }).catch(() => {})
        const fedTo = await fedToOf(), where = await whereOf()
        await page.getByLabel('Hay fed').fill(String(bales))
        await page.getByRole('button', { name: 'Record feeding', exact: true }).click({ timeout: 10_000 }).catch(() => {})   // tap 3
        const states = await watchStates(page, 'Sent', 45_000, `Fed ${bales} bales`)
        const p = await rowPlace(bales)
        const ok = held && fedTo === t.lotId && where === t.placeId && states.includes('Sent') && p?.place_id === t.placeId && p?.herd_lot_id === t.lotId
        if (!ok) cattleOk = false
        cattle.push(`${t.name.replace(PREFIX + ' ', '')}: held ${held} · fed-to ${fedTo === t.lotId ? 'the bunch' : fedTo || 'none'} · Where ${where === t.placeId ? 'its place' : where || 'blank'} · [${states.join(' → ')}] · row at ${p?.place_id === t.placeId ? 'its place' : p?.place_id ?? 'no place'}`)
      }
      record('33: from Cattle — hold the bunch, Feed, the number, Record: three taps, and each of three bunches in a row is fed where THAT bunch is, not where the last feeding was', cattleOk, cattle.join(' | '))

      // From Today: the place's sheet → the bunch's Feed → number → Record. Same three taps.
      const t2 = trio[1]
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator(`[data-audit="ranch-map-place-button"][data-place="${t2.placeId}"]`).waitFor({ timeout: 20_000 }).catch(() => {})
      await page.locator(`[data-audit="ranch-map-place-button"][data-place="${t2.placeId}"]`).evaluate(el => (el as HTMLButtonElement).click()).catch(() => {})   // tap 1
      const feedBtn = page.locator(`[data-audit="ranch-map-sheet"] [data-audit="sheet-feed"][data-lot="${t2.lotId}"]`)
      const sawFeed = await feedBtn.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
      await feedBtn.click({ timeout: 5_000 }).catch(() => {})                                                                   // tap 2
      await page.locator('[data-audit="fed-to"]').waitFor({ timeout: 15_000 }).catch(() => {})
      await page.waitForFunction((pid: string) => Array.from(document.querySelectorAll('select')).some(s => (s as HTMLSelectElement).value === pid), t2.placeId, { timeout: 10_000 }).catch(() => {})
      const fedTo2 = await fedToOf(), where2 = await whereOf()
      await page.getByLabel('Hay fed').fill('5')
      await page.getByRole('button', { name: 'Record feeding', exact: true }).click({ timeout: 10_000 }).catch(() => {})       // tap 3
      const states2 = await watchStates(page, 'Sent', 45_000, 'Fed 5 bales')
      const p2 = await rowPlace(5)
      record('33: from Today — the place\'s sheet, the bunch\'s Feed, the number, Record: three taps, fed where the bunch is', sawFeed && fedTo2 === t2.lotId && where2 === t2.placeId && states2.includes('Sent') && p2?.place_id === t2.placeId, `Feed on the sheet ${sawFeed} · fed-to ${fedTo2 === t2.lotId ? 'the bunch' : fedTo2 || 'none'} · Where ${where2 === t2.placeId ? 'its place' : where2 || 'blank'} · [${states2.join(' → ')}] · row at ${p2?.place_id === t2.placeId ? 'its place' : p2?.place_id ?? 'no place'}`)

      // The person's own choice of Where is kept: pick another place after the bunch, and the record carries it.
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      const row3 = page.locator('[data-audit="lot-row"]', { hasText: trio[2].name }).first()
      await row3.waitFor({ timeout: 20_000 }).catch(() => {})
      await hold(page, row3)
      await page.locator('[data-audit="row-actions-sheet"] [data-audit="row-action-extra"]', { hasText: 'Feed' }).first().click({ timeout: 10_000 }).catch(() => {})
      await page.locator('[data-audit="fed-to"]').waitFor({ timeout: 15_000 }).catch(() => {})
      await page.waitForFunction((pid: string) => Array.from(document.querySelectorAll('select')).some(s => (s as HTMLSelectElement).value === pid), trio[2].placeId, { timeout: 10_000 }).catch(() => {})
      await page.getByLabel('Where').selectOption({ label: trio[0].placeName })
      await page.getByLabel('Hay fed').fill('6')
      await page.getByRole('button', { name: 'Record feeding', exact: true }).click({ timeout: 10_000 }).catch(() => {})
      const states3 = await watchStates(page, 'Sent', 45_000, 'Fed 6 bales')
      const p3 = await rowPlace(6)
      record('33: Where is overridable — a place picked by hand after the bunch is the place the record carries', states3.includes('Sent') && p3?.place_id === trio[0].placeId && p3?.herd_lot_id === trio[2].lotId, `[${states3.join(' → ')}] · row at ${p3?.place_id === trio[0].placeId ? 'the picked place' : p3?.place_id ?? 'no place'}`)

      // Today's repeat card covers every regularly fed bunch: bunches 1 and 2 have two feedings each now
      // (bunch 2: Cattle + Today; bunch 1: Cattle + one more here), bunch 3 has two as well (Cattle + the override).
      await logFeed(page, 7, { lot: trio[0].name })
      await watchStates(page, 'Sent', 45_000, 'Fed 7 bales')
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="repeat-row"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const rowsOn = await page.locator('[data-audit="repeat-row"]').evaluateAll(els => els.map(e => e.getAttribute('data-lot') ?? ''))
      const covers = trio.every(t => rowsOn.includes(t.lotId))
      // Tap bunch 1's row: the feeding it records is bunch 1's, at bunch 1's place.
      const row1 = page.locator(`[data-audit="repeat-row"][data-lot="${trio[0].lotId}"]`)
      const before1 = await page.locator(`[data-audit="repeat-row"][data-lot="${trio[0].lotId}"] [data-audit="repeat-preview"]`).innerText().catch(() => '')
      await row1.getByRole('button', { name: /^Record \d+ bales? now$/ }).click({ timeout: 10_000 }).catch(() => {})
      const states4 = await watchStates(page, 'Sent', 45_000, 'Fed 7 bales')
      const p4 = await rowPlace(7)
      record('33: Today\'s repeat card offers every regularly fed bunch, and a row records ITS bunch at ITS place', covers && rowsOn.length <= 4 && states4.includes('Sent') && p4?.herd_lot_id === trio[0].lotId && p4?.place_id === trio[0].placeId, `rows for ${rowsOn.length} feeding(s) · all three bunches on the card ${covers} · preview "${before1.slice(0, 60)}" · [${states4.join(' → ')}] · row bunch ${p4?.herd_lot_id === trio[0].lotId ? 'bunch 1' : 'other'} at ${p4?.place_id === trio[0].placeId ? 'its place' : p4?.place_id ?? 'no place'}`)
    })

    // ── Block 37: the number is the control ─────────────────────────────────
    // A number that can change IS its own control: tap it, a keypad on the spot,
    // Done saves — through the outbox, with its Undo, never blocking on signal.
    // The falsifier: hay on hand, a head count and a feeding's quantity each cost
    // one tap plus the number with NO screen change (same URL, no sheet); a
    // place's name the same; and a long-press on a row in each of the four
    // lists — Activity, Cattle, Places, the hay ledger — offers Fix and Delete.
    await section('Block 37: the number is the control', async () => {
      const sameScreen = async (before: string) => page.url() === before && (await page.locator('[data-audit="record-sheet"], [data-audit="row-actions-sheet"]').count()) === 0
      const tapAndType = async (audit: string, value: string) => {
        await page.locator(`[data-audit="${audit}"]`).first().click({ timeout: 10_000 })                    // the tap
        const box = page.locator(`[data-audit="${audit}-input"]`).first()
        await box.waitFor({ timeout: 5_000 })
        await box.fill(value)                                                                                 // the number
        await box.press('Enter')                                                                              // Done
      }

      // Hay on hand, on Today.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="hay-on-hand"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const url37 = page.url()
      const wasOnHand = (await page.locator('[data-audit="hay-on-hand"]').first().innerText().catch(() => '')).replace(/,/g, '')
      await tapAndType('hay-on-hand', '333')
      const stillHere = await sameScreen(url37)
      const states37a = await watchStates(page, 'Sent', 45_000, 'Counted 333 bales')
      const paintedAtOnce = (await page.locator('[data-audit="hay-on-hand"]').first().innerText().catch(() => '')).replace(/,/g, '')
      const { data: cnt } = await admin.from('events').select('id, ingested_at, payload').eq('user_id', userId).eq('type', 'hay_inventory').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      const cntBales = ((cnt as { payload?: { bales?: number } } | null)?.payload?.bales) ?? null
      // The ranch reads the count minus what was fed since that count's day (Block 3), so once the page has
      // caught up (Block 32's stamp) the tile must paint what the ranch reads — not the raw count.
      const caught37 = await stampReaches(page, (cnt as { ingested_at?: string } | null)?.ingested_at ?? null, 30_000)
      const routeAfter = ((await (await page.request.get('/api/ranch/hay-on-hand')).json().catch(() => ({}))) as { bales?: number | null }).bales ?? null
      const painted37a = (await page.locator('[data-audit="hay-on-hand"]').first().innerText().catch(() => '')).replace(/,/g, '')
      record('37: hay on hand — tap the number, type, Done: one tap plus the number, no screen change; the count lands and the tile reads what the ranch reads', stillHere && states37a[0] === 'Saved' && states37a.includes('Sent') && paintedAtOnce === '333' && cntBales === 333 && caught37.ok && routeAfter != null && painted37a === String(routeAfter), `was ${wasOnHand} · same screen ${stillHere} · [${states37a.join(' → ')}] · painted at once ${paintedAtOnce} · count row ${cntBales} · caught up ${caught37.ok} · ranch reads ${routeAfter} · painted then ${painted37a}`)

      // A head count, on Cattle.
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      const row37 = page.locator('[data-audit="lot-row"]', { hasText: LOT_NAME }).first()
      await row37.waitFor({ timeout: 20_000 }).catch(() => {})
      const urlC = page.url()
      const wasHead = (await row37.locator('[data-audit="lot-head"]').innerText().catch(() => '')).replace(/,/g, '')
      await row37.locator('[data-audit="lot-head"]').click({ timeout: 10_000 })
      const headBox = row37.locator('[data-audit="lot-head-input"]')
      await headBox.waitFor({ timeout: 5_000 }); await headBox.fill('61'); await headBox.press('Enter')
      const stillC = await sameScreen(urlC)
      const states37b = await watchStates(page, 'Sent', 45_000, `61 head`)
      const { data: lotRow } = await admin.from('herd_lots').select('head_count').eq('id', lotId).maybeSingle()
      const { data: anchorRow } = await admin.from('events').select('payload').eq('ranch_id', ranchId).eq('type', 'head_count_set').eq('payload->>lot_id', lotId).order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      const anchorHead = ((anchorRow as { payload?: { head_after?: number } } | null)?.payload?.head_after) ?? null
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      const paintedHead = (await page.locator('[data-audit="lot-row"]', { hasText: LOT_NAME }).first().locator('[data-audit="lot-head"]').innerText().catch(() => '')).replace(/,/g, '')
      record('37: a head count — tap the number, type, Done: no screen change; the bunch reads it and the record carries the anchor', stillC && states37b[0] === 'Saved' && states37b.includes('Sent') && (lotRow as { head_count?: number } | null)?.head_count === 61 && anchorHead === 61 && paintedHead === '61', `was ${wasHead} · same screen ${stillC} · [${states37b.join(' → ')}] · bunch ${(lotRow as { head_count?: number } | null)?.head_count ?? '?'} · anchor ${anchorHead} · painted after ${paintedHead}`)

      // A feeding's quantity, on its entry page.
      const { data: fedRow } = await admin.from('events').select('id').eq('user_id', userId).eq('type', 'hay_fed').is('superseded_by', null).is('voided_at', null).eq('payload->>bales', '7').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      const fedId = (fedRow as { id: string } | null)?.id ?? ''
      await page.goto(`/ranch/activity/${fedId}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="event-quantity"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const urlE = page.url()
      await tapAndType('event-quantity', '9')
      const stillE = await sameScreen(urlE)
      const states37c = await watchStates(page, 'Sent', 45_000, 'Fed 9 bales')
      const { data: corr } = await admin.from('events').select('id, payload, supersedes_event_id').eq('user_id', userId).eq('type', 'hay_fed').eq('supersedes_event_id', fedId).order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      const corrBales = ((corr as { payload?: { bales?: number } } | null)?.payload?.bales) ?? null
      const { data: origAfter } = await admin.from('events').select('superseded_by').eq('id', fedId).maybeSingle()
      record('37: a feeding\'s quantity — tap the number, type, Done: no screen change; a correction supersedes the entry, in the same motion as recording', !!fedId && stillE && states37c[0] === 'Saved' && states37c.includes('Sent') && corrBales === 9 && (origAfter as { superseded_by?: string | null } | null)?.superseded_by === (corr as { id?: string } | null)?.id, `entry ${fedId.slice(0, 8)} · same screen ${stillE} · [${states37c.join(' → ')}] · correction bales ${corrBales} · original superseded ${!!(origAfter as { superseded_by?: string | null } | null)?.superseded_by}`)

      // A place's name, on its page.
      await page.goto(`/ranch/places/${placeId}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="place-name"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const urlP = page.url()
      await tapAndType('place-name', `${PREFIX} West stack renamed`)
      const stillP = await sameScreen(urlP)
      const states37d = await watchStates(page, 'Sent', 45_000, 'Renamed to')
      const { data: plRow } = await admin.from('places').select('name').eq('id', placeId).maybeSingle()
      record('37: a place\'s name — tap it, type, Done: no screen change; the place is renamed', stillP && states37d[0] === 'Saved' && states37d.includes('Sent') && (plRow as { name?: string } | null)?.name === `${PREFIX} West stack renamed`, `same screen ${stillP} · [${states37d.join(' → ')}] · name now "${(plRow as { name?: string } | null)?.name ?? '?'}"`)
      // Put the name back: later sections read it.
      await admin.from('places').update({ name: `${PREFIX} West stack` }).eq('id', placeId)

      // Long-press on a row in each of the four lists → Fix and Delete.
      const holds: string[] = []
      let holdsOk = true
      const tryHold = async (list: string, path: string, rowSel: string, open?: () => Promise<void>) => {
        await page.goto(path, { waitUntil: 'domcontentloaded' })
        if (open) await open()
        const row = page.locator(rowSel).first()
        const there = await row.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
        const opened = there && await hold(page, row)
        const fix = await page.locator('[data-audit="row-actions-sheet"] [data-audit="row-action-fix"]').count()
        const del = await page.locator('[data-audit="row-actions-sheet"] [data-audit="row-action-delete"]').count()
        await page.keyboard.press('Escape').catch(() => {})
        const ok = opened && fix === 1 && del === 1
        if (!ok) holdsOk = false
        holds.push(`${list}: row ${there} · held ${opened} · Fix ${fix} · Delete ${del}`)
      }
      await tryHold('Activity', '/ranch/activity', '[data-audit="activity-row"]')
      await tryHold('Cattle', '/ranch/cattle', '[data-audit="lot-row"]')
      await tryHold('Places', '/ranch/places', '[data-audit="place-rows"] li', async () => { await page.locator('[data-audit="place-group-open"]').first().click({ timeout: 10_000 }).catch(() => {}) })
      await tryHold('Hay ledger', `/today?fips=${HOME_FIPS}`, '[data-audit="hay-line"]', async () => { await page.locator('[data-audit="hay-details"] summary, [data-audit="hay-details"] button').first().click({ timeout: 10_000 }).catch(() => {}) })
      record('37: long-press a row in Activity, Cattle, Places and the hay ledger — Fix and Delete, one gesture everywhere', holdsOk, holds.join(' | '))
    })

    // ── Block 37 (ruling 3): no long lists — Activity is a few days at a time ──
    // The page unit is three ranch days, not fifty rows; a busy day never splits
    // across pages, and More days is one tap away.
    await section('Block 37: Activity groups by day, a few days at a time', async () => {
      // Six quiet days behind today, one line each, so the record spans more than one page of days.
      for (let k = 1; k <= 6; k++) await admin.from('events').insert({ id: randomUUID(), user_id: userIdB, ranch_id: ranchId, type: 'rain', ts: new Date(Date.now() - k * 86_400_000).toISOString(), schema_version: 1, payload: { source: 'manual', schema_version: 1, place_id: null, inches: 0.1 * k } })
      await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="activity-row"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const daysOn = async () => new Set(await page.locator('[data-audit="activity-row"]').evaluateAll(els => els.map(e => e.closest('section')?.getAttribute('aria-label') ?? ''))).size
      const dayLabels = async () => page.locator('section[aria-label]').evaluateAll(els => els.map(e => e.getAttribute('aria-label') ?? '').filter(l => /\d{4}|Today|Yesterday/i.test(l)))
      const page1Days = await dayLabels()
      const rows1 = await page.locator('[data-audit="activity-row"]').count()
      const more = page.locator('a[href*="cursor="]').first()
      const hasMore = (await more.count()) === 1
      const moreText = (await more.innerText().catch(() => '')).trim()
      const href = hasMore ? await more.getAttribute('href') : null
      let page2Days: string[] = []
      if (href) { await page.goto(href, { waitUntil: 'domcontentloaded' }); await page.locator('[data-audit="activity-row"]').first().waitFor({ timeout: 20_000 }).catch(() => {}); page2Days = await dayLabels() }
      const disjoint = page2Days.length > 0 && !page2Days.some(d => page1Days.includes(d))
      record('37: Activity shows three days at a time — a busy day never splits, and More days is one tap away to the next three', page1Days.length === 3 && rows1 > 0 && hasMore && /More days/.test(moreText) && page2Days.length >= 1 && page2Days.length <= 3 && disjoint, `page 1 days [${page1Days.join(', ')}] · ${rows1} rows · "${moreText}" · page 2 days [${page2Days.join(', ')}] · disjoint ${disjoint}`)
    })

    // ── Block 34: drawing a place ───────────────────────────────────────────
    // PK's falsifier: draw a four-corner pasture, tapping zoom twice along the
    // way. Four corners, not six, and it saves from the shape itself — the name
    // and Save on the finished shape, no "Use this shape", no second screen.
    // Five taps: four corners and Save.
    await section('Block 34: drawing a place', async () => {
      await page.goto('/ranch/places', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="place-draw-open"]').first().click({ timeout: 20_000 })
      const mapEl = page.locator('[data-audit="place-draw"] .leaflet-container').first()
      await mapEl.waitFor({ timeout: 20_000 })
      await page.waitForTimeout(1_500)   // tiles and the fit settle; a corner placed mid-fit would move
      const box = (await mapEl.boundingBox())!
      const corner = async (fx: number, fy: number) => { await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await page.waitForTimeout(250) }
      const zoomIn = page.locator('[data-audit="place-draw"] .leaflet-control-zoom-in').first()
      const zoomThere = (await zoomIn.count()) === 1
      await corner(0.3, 0.3)
      await corner(0.7, 0.3)
      if (zoomThere) { await zoomIn.click(); await page.waitForTimeout(600) }   // zoom tap 1 — zooms, places nothing
      await corner(0.7, 0.7)
      if (zoomThere) { await zoomIn.click(); await page.waitForTimeout(600) }   // zoom tap 2
      await corner(0.3, 0.7)
      const status = (await page.locator('[data-audit="draw-status"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const cornersSaid = parseInt(status.match(/(\d+) corners?/)?.[1] ?? '0', 10)
      const finishOnShape = await page.locator('[data-audit="place-draw"] [data-audit="draw-finish"]').count()
      const useThisShape = await page.getByRole('button', { name: 'Use this shape' }).count()
      const kindPreselected = await page.locator('[data-audit="draw-kind"]').inputValue().catch(() => '')
      const name34 = `${PREFIX} 34 drawn pasture`
      await page.locator('[data-audit="draw-name"]').fill(name34)
      await page.locator('[data-audit="draw-save"]').click({ timeout: 10_000 })   // tap 5
      await page.waitForFunction((n: string) => document.body.innerText.includes(n), name34, { timeout: 20_000 }).catch(() => {})
      const confirmSteps = await page.locator('[data-audit="place-confirm"]').count()
      const { data: drawn } = await admin.from('places').select('id, kind, geometry').eq('ranch_id', ranchId).eq('name', name34).maybeSingle()
      const ring = ((drawn as { geometry?: { coordinates?: number[][][] } } | null)?.geometry?.coordinates?.[0]) ?? []
      const savedCorners = ring.length ? ring.length - 1 : 0   // GeoJSON closes the ring
      record('34: a four-corner pasture with two zoom taps along the way — four corners, not six; the name and Save are on the shape; five taps and it is saved', zoomThere && cornersSaid === 4 && finishOnShape === 1 && useThisShape === 0 && confirmSteps === 0 && savedCorners === 4 && kindPreselected !== '', `zoom control ${zoomThere} · status "${status.slice(0, 60)}" · corners said ${cornersSaid} · finish on the shape ${finishOnShape} · "Use this shape" ${useThisShape} · confirm screens ${confirmSteps} · saved ring corners ${savedCorners} · kind preselected "${kindPreselected}" → saved "${(drawn as { kind?: string } | null)?.kind ?? 'none'}"`)
    })

    // ── Block 36: a bunch can carry an opening date ─────────────────────────
    // A new bunch had no work date, so an opening inventory was stamped today
    // rather than the day it was true. Now New bunch asks "As of" (today unless
    // changed); the opening count and the placement happen on that day.
    await section('Block 36: a bunch can carry an opening date', async () => {
      const dayAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
      const opened = dayAgo(6)
      const name36 = `${PREFIX} 36 late bunch`
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="new-bunch-button"]').first().click({ timeout: 20_000 })
      await page.locator('[aria-label="Class"] button', { hasText: 'Cows' }).first().click()
      await page.getByLabel('Name').fill(name36)
      await page.locator('[data-audit="lot-head-count-input"]').fill('17')
      const asOfDefault = await page.locator('[data-audit="lot-as-of"]').inputValue().catch(() => 'missing')
      await page.locator('[data-audit="lot-as-of"]').fill(opened)
      await page.locator('[data-audit="lot-save"]').click()
      await page.locator('[data-audit="lot-row"]', { hasText: name36 }).first().waitFor({ timeout: 20_000 }).catch(() => {})
      const { data: lot36 } = await admin.from('herd_lots').select('id, head_count').eq('ranch_id', ranchId).eq('name', name36).maybeSingle()
      const lotId36 = (lot36 as { id?: string } | null)?.id ?? ''
      const { data: anchor36 } = lotId36 ? await admin.from('events').select('id, ts, payload').eq('ranch_id', ranchId).eq('type', 'head_count_set').eq('payload->>lot_id', lotId36).order('ingested_at', { ascending: true }).limit(1).maybeSingle() : { data: null }
      const anchorTs = (anchor36 as { ts?: string } | null)?.ts ?? ''
      const anchorDay = anchorTs ? new Date(anchorTs).toLocaleDateString('en-CA', { timeZone: 'America/Denver' }) : ''
      const anchorId = (anchor36 as { id?: string } | null)?.id ?? ''
      // The opening anchor (head_count_set) is not a hand-made entry, so the record never lists it as a row — the day on the anchor is the fact.
      record('36: New bunch asks "As of" (today unless changed) — a bunch put on the books six days late opens on the day it was counted: the opening count carries that day and the record shows it there', asOfDefault === '' && !!lotId36 && (lot36 as { head_count?: number } | null)?.head_count === 17 && anchorDay === opened, `as-of default "${asOfDefault}" (blank = today) · bunch ${lotId36 ? 'made' : 'MISSING'} head ${(lot36 as { head_count?: number } | null)?.head_count ?? '?'} · opening count on ${anchorDay || 'none'} (asked ${opened})`)
    })

    // ── Block 42: count cattle into a pasture ───────────────────────────────
    // PK's falsifier: stand in a pasture. Locate, tap the pasture, Count cattle in,
    // pick a bunch, count 47, save — with the network off. The bunch reads 47 at
    // that pasture, the move names both places, and it is in the outbox. Lock the
    // phone mid-count and reopen: the total is intact.
    await section('Block 42: count cattle into a pasture', async () => {
      const sq = (lng: number, lat: number) => [[lng, lat], [lng + 0.02, lat], [lng + 0.02, lat + 0.02], [lng, lat + 0.02], [lng, lat]]
      const { data: pInto } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} 42 into pasture`, kind: 'pasture', geometry: { type: 'Polygon', coordinates: [sq(-110.20, 46.90)] }, acres: 640 }).select('id').single()
      const { data: pFrom } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} 42 from pasture`, kind: 'pasture', geometry: { type: 'Polygon', coordinates: [sq(-110.25, 46.90)] }, acres: 640 }).select('id').single()
      const intoId = String((pInto as { id?: string } | null)?.id ?? ''), fromId = String((pFrom as { id?: string } | null)?.id ?? '')
      const lot42 = randomUUID(); const name42 = `${PREFIX} 42 cows`
      await admin.from('herd_lots').insert({ id: lot42, ranch_id: ranchId, class: 'cows', name: name42, head_count: 50, avg_weight: 1100, weight_unit: 'lb', created_by: userId, updated_by: userId })
      await admin.from('events').insert({ id: randomUUID(), user_id: userId, ranch_id: ranchId, type: 'head_count_set', ts: new Date(Date.now() - 3 * 86_400_000).toISOString(), schema_version: 1, payload: { lot_id: lot42, reason: 'created', source: 'manual', head_count: 50 } })
      const mv = await page.request.post('/api/log', { data: { id: randomUUID(), type: 'cattle_moved', head: 50, herd_lot_id: lot42, to_place_id: fromId, place_id: fromId, ts: new Date(Date.now() - 2 * 86_400_000).toISOString() } })
      if (!mv.ok()) throw new Error(`42 move: ${mv.status()}`)
      // Standing in the pasture they are going into.
      await page.context().grantPermissions(['geolocation'], { origin: BASE }).catch(() => {})
      await page.context().setGeolocation({ latitude: 46.91, longitude: -110.19, accuracy: 5 })
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="map-locate"]').waitFor({ timeout: 20_000 }).catch(() => {})
      await page.locator('[data-audit="map-locate"]').click({ timeout: 10_000 }).catch(() => {})                       // tap 1: Locate
      const sheetHere = await page.locator('[data-audit="ranch-map-sheet"] [data-audit="sheet-here"]').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
      const sheetPlace = (await page.locator('[data-audit="ranch-map-sheet"] [data-audit="sheet-place"]').innerText().catch(() => '')).trim()
      const countIn = page.locator('[data-audit="ranch-map-sheet"] [data-audit="sheet-count-in"]')
      const offered = (await countIn.count()) === 1
      await countIn.click({ timeout: 10_000 }).catch(() => {})                                                          // tap 2: Count cattle in
      await page.waitForURL(/\/ranch\/tally\?to=/, { timeout: 15_000 }).catch(() => {})
      const into = (await page.locator('[data-audit="tally-into"]').innerText().catch(() => '')).trim()
      record('42 (ruling 5): Locate on Today names the pasture you are in — the sheet says you are here and offers Count cattle in, which opens the count into that pasture', sheetHere && sheetPlace.endsWith('42 into pasture') && offered && /\/ranch\/tally\?to=/.test(page.url()) && into === 'Into SMOKE-DAILY-LOOP 42 into pasture', `here ${sheetHere} · sheet "${sheetPlace}" · offered ${offered} · ${page.url().replace(BASE, '')} · "${into}"`)
      // Begin, pick the bunch on the line: from prefills to where the bunch is.
      await page.locator('[data-audit="tally-begin"]').click({ timeout: 10_000 })
      await page.locator('[data-audit="tally-line"]').click({ timeout: 10_000 })
      await page.locator('[data-audit="tally-change-bunch"]').selectOption(lot42)
      const fromShown = await page.locator('[data-audit="tally-change-from"]').inputValue().catch(() => '')
      const toShown = await page.locator('[data-audit="tally-change-to"]').inputValue().catch(() => '')
      await page.locator('[data-audit="tally-line"]').click().catch(() => {})
      const lineText = (await page.locator('[data-audit="tally-line"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      record('42 (ruling 1 + 2): the line at the top names the bunch, where from (prefilled from where the bunch is) and where to (the pasture you stand in), and a tap changes any of them', fromShown === fromId && toShown === intoId && /42 cows/.test(lineText) && /from .*42 from pasture → .*42 into pasture/.test(lineText), `from ${fromShown === fromId ? 'the bunch\'s place' : fromShown || 'blank'} · to ${toShown === intoId ? 'the pasture' : toShown || 'blank'} · line "${lineText}"`)
      // Count to 20, then the phone dies (a reload) — reopening offers the count back, intact.
      for (let i = 0; i < 5; i++) await page.locator('[data-audit="tally-plus-4"]').click()
      const before = (await page.locator('[data-audit="tally-total"]').innerText().catch(() => '')).trim()
      await page.reload({ waitUntil: 'domcontentloaded' })
      const heldTotal = (await page.locator('[data-audit="tally-held-total"]').innerText({ timeout: 15_000 }).catch(() => '')).trim()
      await page.locator('[data-audit="tally-held-keep"]').click({ timeout: 10_000 }).catch(() => {})
      const lineBack = (await page.locator('[data-audit="tally-line"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      record('42 (ruling 3): the count survives the phone dying — reopening offers it back with its total, bunch and places intact', before === '20' && heldTotal === '20' && /42 cows/.test(lineBack) && /42 into pasture/.test(lineBack), `before ${before} · offered back ${heldTotal} · line "${lineBack}"`)
      // To 47 — in fours and a three — with the network off; a touch off the buttons changes nothing.
      for (let i = 0; i < 6; i++) await page.locator('[data-audit="tally-plus-4"]').click()
      await page.locator('[data-audit="tally-plus-3"]').click()
      await page.locator('[data-audit="tally-total-box"]').click().catch(() => {})
      const total47 = (await page.locator('[data-audit="tally-total"]').innerText().catch(() => '')).trim()
      await page.context().setOffline(true)
      await page.locator('[data-audit="tally-finish-open"]').click()
      const finishLine = (await page.locator('[data-audit="tally-finish-line"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      await page.locator('[data-audit="tally-save"]').click()
      const offStates = await watchStates(page, 'Sent', 4_000, 'Counted 47')
      const queued = (await outbox(page)).find(i => (i.body as { type?: string; head?: number }).type === 'cattle_moved' && (i.body as { head?: number }).head === 47)
      const qb = (queued?.body ?? {}) as { from_place_id?: string; to_place_id?: string; herd_lot_id?: string; set_head?: boolean }
      record('42 THE FALSIFIER: count 47 and save with the network off — one record in the outbox: the move from the bunch\'s place into the pasture you stood in, carrying the count', total47 === '47' && offStates[0] === 'Saved' && !offStates.includes('Sent') && !!queued && qb.from_place_id === fromId && qb.to_place_id === intoId && qb.herd_lot_id === lot42 && qb.set_head === true && /42 cows/.test(finishLine), `total ${total47} · [${offStates.join(' → ')}] · queued ${!!queued} from ${qb.from_place_id === fromId} to ${qb.to_place_id === intoId} bunch ${qb.herd_lot_id === lot42} set_head ${qb.set_head === true} · finish "${finishLine}"`)
      await page.context().setOffline(false)
      const onStates = await watchStates(page, 'Sent', 45_000, 'Counted 47')
      const { data: lotAfter } = await admin.from('herd_lots').select('head_count, place_id').eq('id', lot42).maybeSingle()
      const la = lotAfter as { head_count?: number; place_id?: string | null } | null
      const { data: moveRow } = queued ? await admin.from('events').select('type, payload').eq('id', queued.id).maybeSingle() : { data: null }
      const mp = ((moveRow as { payload?: { from_place_id?: string; to_place_id?: string; head?: number; set_head?: boolean } } | null)?.payload) ?? {}
      record('42 (ruling 1): when the signal returns the record lands as one — the bunch reads 47 at that pasture, and the move names both places', onStates.includes('Sent') && la?.head_count === 47 && la?.place_id === intoId && mp.from_place_id === fromId && mp.to_place_id === intoId && mp.head === 47 && mp.set_head === true, `[${onStates.join(' → ')}] · bunch ${la?.head_count ?? '?'} at ${la?.place_id === intoId ? 'the pasture' : la?.place_id ?? 'no place'} · move ${mp.from_place_id === fromId ? 'from' : 'from?'} → ${mp.to_place_id === intoId ? 'into' : 'into?'} head ${mp.head}`)
      await page.context().setGeolocation(null).catch(() => {})
    })

    // ── Block 12 (12.8): Today on the ranch — what a glance at Ranch is for ──
    // Did the hand do what I asked today; is there anything I have not looked
    // at; can I get to everything that left the hub. Replaces the 7B.2 expander
    // checks, which measured a surface PK ruled out of existence.
    await section('Block 12 (12.8): Today on the ranch — what a glance at Ranch is for', async () => {
      const text = async (sel: string) => ((await page.locator(sel).first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
      // Block 47: the Ranch view — three numbers read at a glance, each a tap that opens
      // what is beneath it and closes on a second tap; Cattle, Ground and the record as
      // tabs on the same page. A number without a record behind it is not painted.
      await page.goto('/ranch', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="ranch-numbers"]').waitFor({ timeout: 20_000 }).catch(() => {})
      const painted = await page.locator('[data-audit^="ranch-number-"][data-open]').evaluateAll(els => els.map(e => `${e.getAttribute('data-audit')!.replace('ranch-number-', '')}: ${(e.querySelector('[data-audit$="-value"]')?.textContent ?? '').trim()} ${(e.querySelector('[data-audit$="-word"]')?.textContent ?? '').trim()}`))
      const url47 = page.url()
      await page.locator('[data-audit="ranch-number-hay-open"]').click({ timeout: 10_000 }).catch(() => {})
      const under = (await page.locator('[data-audit="ranch-number-hay-under"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await page.locator('[data-audit="ranch-number-hay-open"]').click({ timeout: 10_000 }).catch(() => {})
      const closed = (await page.locator('[data-audit="ranch-number-hay-under"]').count()) === 0
      const rateHonest = /bales\/day = \d+ days · the rate is \d+ bales over the last \d+ days \(fed on \d+ of them\)/.test(under) || /Not enough feeding recorded/.test(under)
      record('47: the Ranch view — head, bales on hand with days left, rain vs normal, each painted only from records; a tap on hay opens the arithmetic and names the burn rate and its window (or says not enough feeding recorded), and a second tap closes it',
        painted.length >= 2 && painted.some(p => p.startsWith('head:')) && painted.some(p => p.startsWith('hay:')) && /counted .* \+ \d+ added − \d+ fed = \d+ on hand/.test(under) && rateHonest && closed,
        `numbers [${painted.join(' | ')}] · under hay "${under.slice(0, 160)}" · closes ${closed}`)
      for (const t of ['cattle', 'ground', 'record'] as const) await page.locator(`[data-audit="ranch-tile"][data-tile="${t}"]`).click({ timeout: 10_000 }).catch(() => {})
      const tabsThere = await page.evaluate(() => ({ url: location.href, cattle: !!document.querySelector('[data-audit="ranch-tab-record"]'), rows: document.querySelectorAll('[data-audit="ranch-record-list"] li').length }))
      await page.locator('[data-audit="ranch-tile"][data-tile="ground"]').click({ timeout: 10_000 }).catch(() => {})
      const ground = await page.evaluate(() => ({ groups: document.querySelectorAll('[data-audit="place-group-open"]').length, acres: !!document.querySelector('[data-audit="acres-by-kind"]') }))
      await page.locator('[data-audit="ranch-tile"][data-tile="cattle"]').click({ timeout: 10_000 }).catch(() => {})
      const cattleRows = await page.locator('[data-audit="ranch-tab-cattle"] [data-audit="lot-row"]').count()
      record('47: Cattle, Ground and the record are tabs on the same page — each renders in place and the address never changes; acres by kind sit under Ground',
        tabsThere.url === url47 && tabsThere.rows >= 1 && ground.groups >= 1 && ground.acres && cattleRows >= 1,
        `url unchanged ${tabsThere.url === url47} · record rows ${tabsThere.rows} · ground groups ${ground.groups} acres ${ground.acres} · cattle rows ${cattleRows}`)
      // The 6J reachability rule: everything that left the hub is still one tap
      // from where a person would look for it.
      const routes: string[] = []
      for (const r of ['/ranch/hay', '/ranch/work', '/ranch/devices']) { const res = await page.request.get(r).catch(() => null); routes.push(`${r} → ${res ? res.status() : 'no response'}`) }
      await page.goto('/ranch/places', { waitUntil: 'domcontentloaded' })
      const devLink = await page.locator('[data-audit="places-devices-link"]').count()
      await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      const machinesFilter = await page.locator('[data-audit="activity-machines-link"]').count()
      record('12.7: what left the hub is still reachable from where a person would look — Devices from Ground, machine work from the record, every old route answering',
        routes.every(r => /→ 200$/.test(r)) && devLink === 1 && machinesFilter >= 1, `${routes.join(' · ')} · devices link ${devLink} · machines filter ${machinesFilter}`)
    })

    // ── Block 16 — headlines back on Today, last; the Thursday alert in USDM's words ──
    await section('Block 16 — headlines back on Today, last; the Thursday alert in USDM\'s words', async () => {
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="news-list"], [data-audit="news-error"], [data-audit="news-empty"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const ledgers = await page.locator('[role="tablist"][aria-label="Ledgers"]').count()
      const rows = page.locator('[data-audit="news-row"]')
      const nRows = await rows.count()
      const listState = await page.locator('[data-audit="news-error"]').count() ? 'unavailable' : await page.locator('[data-audit="news-empty"]').count() ? 'empty' : `${nRows} headlines`
      // Headline only: no image, no summary paragraph, no source logo anywhere in a row.
      const rowShape = nRows === 0 ? { imgs: 0, lines: 0 } : await rows.evaluateAll(els => ({
        imgs: els.reduce((n, e) => n + e.querySelectorAll('img, svg, picture').length, 0),
        lines: Math.max(...els.map(e => (e.textContent ?? '').trim().split('\n').filter(Boolean).length)),
      }))
      const linksOut = nRows === 0 ? true : await rows.evaluateAll(els => els.every(e => {
        const a = e as HTMLAnchorElement
        return a.tagName === 'A' && /^https?:\/\//.test(a.href) && !a.href.includes(location.host) && a.target === '_blank'
      }))
      const tall = await page.locator('[data-audit="today-headlines"]').evaluate(e => e.getBoundingClientRect().height).catch(() => 0)
      // LAST means last in Today's own panel: nothing painted sits after it.
      // Measured off the panel's children, never a word search — the other
      // views stay mounted and hidden, and a hidden box has no height.
      const below = await page.evaluate(() => {
        const h = document.querySelector('[data-audit="today-headlines"]')
        if (!h?.parentElement) return -1
        const painted = Array.from(h.parentElement.children).filter(e => e.getBoundingClientRect().height > 0)
        return painted.length - 1 - painted.indexOf(h)
      })
      record('16 (ruling 1): headlines are back on Today as the last section — headline only, no images or summaries, and every one links out to its source',
        (await page.locator('[data-audit="news-hook"]').count()) === 1 && ledgers === 1 && rowShape.imgs === 0 && rowShape.lines <= 2 && linksOut && below === 0 && tall > 0,
        `${listState} · images ${rowShape.imgs} · max lines per row ${rowShape.lines} · links out ${linksOut} · sections below ${below}`)

      // Ruling 2 — the Thursday alert, as a person reads it. A real alert event
      // on the smoke ranch, in the shape lib/alert-service writes today.
      const alertId = randomUUID()
      const validDate = '2026-09-15'
      await admin.from('events').insert({
        id: alertId, user_id: userId, ranch_id: ranchId, device_id: null, type: 'alert',
        ts: new Date().toISOString(), schema_version: 1,
        payload: {
          kind: 'lfp_drought_alert', county_fips: HOME_FIPS, county_name: `${PREFIX} County`, state: 'MT',
          tier: 3, payments: 3, week_date: validDate, source: 'usdm', valid_date: validDate,
          usdm: { level: 3, pct: 12, d0: 100, d1: 88, d2: 61, d3: 12, d4: 0 },
        },
      })
      await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="activity-row"], [data-audit="since-row"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const alertText = (await page.locator(`text=U.S. Drought Monitor`).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      const namesSource = /U\.S\. Drought Monitor/.test(alertText)
      const saysClass = /Extreme drought \(D3\) across 12% of the county/.test(alertText) && /severe drought or worse across 61%/.test(alertText)
      const saysValid = /valid Sep 15, 2026/.test(alertText)
      const noProgram = !/\bLFP\b|\btier\b|\bpayment/i.test(alertText)
      record('16 (ruling 2): the Thursday alert names the U.S. Drought Monitor, states the class in plain words with the valid-through date, and says nothing about eligibility or payments',
        namesSource && saysClass && saysValid && noProgram,
        `"${alertText.slice(0, 150)}" · source ${namesSource} · class ${saysClass} · valid ${saysValid} · no program words ${noProgram}`)
      await admin.from('events').delete().eq('id', alertId)
    })

    // ── Block 9: hay to turnout — the runway gets an end ───────────────────
    // The card already said how long the stack lasts. This says whether that
    // reaches grass, at his own heaviest fourteen days, on two dates: turnout
    // as he expects it and turnout three weeks late.
    //
    // Read with textContent, never innerText: the standing rule. And every
    // figure on screen must survive the envelope check — needed minus on hand
    // IS the short number, or the surface is lying quietly.
    await section('Block 9: hay to turnout — the runway gets an end', async () => {
      const text = async (sel: string) => ((await page.locator(sel).first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
      await page.goto('/ranch/hay', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="hay-to-turnout"]').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})

      // Nothing set: it asks for the one thing only he can answer, and never
      // guesses one from the FSA grazing period.
      const withheld = await text('[data-audit="turnout-withheld"]')
      const reason = await page.locator('[data-audit="turnout-withheld"]').first().getAttribute('data-reason').catch(() => null)
      record('9: with no turnout date the card asks for one and answers nothing — never a guessed date',
        reason === 'no_turnout' && /go back to grass/i.test(withheld) && (await page.locator('[data-audit="turnout-expected"]').count()) === 0,
        `reason ${reason ?? 'NONE'} · "${withheld.slice(0, 70)}"`)

      // Set one through the UI, the way he would.
      const year = new Date().getUTCFullYear() + 1
      const turnout = `${year}-05-15`
      await page.locator('[data-audit="turnout-open"]').first().click()
      await page.locator('[data-audit="turnout-input"]').fill(turnout)
      await page.locator('[data-audit="turnout-save"]').click()
      await page.locator('[data-audit="turnout-expected"]').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})

      const expected = await text('[data-audit="turnout-expected"]')
      const late = await text('[data-audit="turnout-late"]')
      const rate = await text('[data-audit="turnout-rate"]')
      const nums = (t: string) => {
        const m = t.match(/([\d,]+) needed · ([\d,]+) on hand — (?:reaches it with ([\d,]+) bales? to spare|([\d,]+) bales? short)/)
        return m ? { needed: Number(m[1].replace(/,/g, '')), onHand: Number(m[2].replace(/,/g, '')), spare: m[3] ? Number(m[3].replace(/,/g, '')) : null, short: m[4] ? Number(m[4].replace(/,/g, '')) : null } : null
      }
      const e = nums(expected), l = nums(late)
      const adds = (x: ReturnType<typeof nums>) => !!x && (x.spare !== null ? x.onHand - x.needed === x.spare : x.needed - x.onHand === x.short)

      record('9: the pair answers on two dates — turnout as set, and three weeks late — both against the same on-hand',
        /May 15/.test(expected) && /Three weeks late/.test(late) && /Jun 5/.test(late) && !!e && !!l && e.onHand === l.onHand,
        `expected "${expected.slice(0, 80)}" · late "${late.slice(0, 80)}"`)
      record('9: every figure survives the envelope check — needed minus on hand IS the short number, on both dates',
        adds(e) && adds(l), e && l ? `expected ${e.needed}−${e.onHand}=${e.spare ?? e.short} · late ${l.needed}−${l.onHand}=${l.spare ?? l.short}` : 'no figures parsed')
      record('9: the later date is the harder one — three weeks costs feed, never less',
        !!e && !!l && l.needed > e.needed, e && l ? `${e.needed} → ${l.needed}` : 'no figures parsed')
      record('9: the rate names where it came from, and says plainly when it is not yet a worst case',
        /bales\/day/.test(rate) && (/heaviest 14 days so far, \w+ \d+–\w+ \d+/.test(rate) || /not yet a full 14 days, so it is not a worst case/.test(rate)),
        `"${rate.slice(0, 110)}"`)

      // Under the seven-day gate the answer still shows and says how thin it
      // is, while the run-out DATE stays behind its gate — PK's ruling that
      // the two answers do not move together.
      const thin = await page.locator('[data-audit="turnout-thin"]').count()
      const thinText = thin ? await text('[data-audit="turnout-thin"]') : ''
      record('9: a thin ledger still gets the answer, carrying the count of feeding days behind it',
        thin === 0 || /days? of feeding so far/.test(thinText),
        thin ? `"${thinText.slice(0, 60)}"` : 'not thin on this ranch')

      // It survives a reload — the date is on the ranch, not in the browser.
      await page.goto('/ranch/hay', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="turnout-expected"]').first().waitFor({ state: 'attached', timeout: 20_000 }).catch(() => {})
      const again = await text('[data-audit="turnout-expected"]')
      record('9: the turnout date is stored on the ranch — it is still there on the next load',
        /May 15/.test(again) && again === expected, `"${again.slice(0, 80)}"`)
    })

    // ── Block 10 → Block 15: the preg check, in the record sheet, with no service ──
    // The chute is a sheet now. Every check here runs the way PK will: Record,
    // Preg check, the bunch, −/+ for checked and open, Save at the bottom —
    // OFFLINE — then signal returns and the ranch gets one record that made
    // two bunches. Without 070 the function refuses the split; these skip and
    // say why.
    await section('Block 10 → 15: the preg check in the record sheet, offline', async () => {
    if (!(await probe069(ranchId, userId))) {
      skip('10/15: preg check in the sheet', 'migration 069 not applied on this database')
    } else if (!(await probe070(page, ranchId, userId))) {
      skip('15: preg check in the sheet', 'migration 070 not applied on this database — the function still refuses a check that carries its opens')
    } else {
      const text = async (sel: string) => ((await page.locator(sel).first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
      const headOf = async (id: string) => {
        const { data } = await admin.from('herd_lots').select('head_count').eq('id', id).maybeSingle()
        return (data as { head_count?: number } | null)?.head_count ?? null
      }
      // The phone: the sheet is full width and Save sits at the bottom there.
      const priorChute = page.viewportSize()
      await page.setViewportSize({ width: 390, height: 844 })
      const chuteLotId = randomUUID()
      const CHUTE_LOT = `${PREFIX} Chute heifers`
      const { error: cErr } = await admin.from('herd_lots').insert({ id: chuteLotId, ranch_id: ranchId, class: 'heifers', name: CHUTE_LOT, head_count: 60, avg_weight: 900, weight_unit: 'lb', created_by: userId, updated_by: userId })
      if (cErr) throw new Error(`chute lot: ${cErr.message}`)
      // Every real bunch has a head-count anchor (066 backfilled the old ones;
      // the app writes one on create). The projection rebuilds from it, so an
      // Undo can put the head back. A fixture inserted by hand needs one too.
      await admin.from('events').insert({ user_id: userId, ranch_id: ranchId, device_id: null, type: 'head_count_set', ts: new Date(Date.now() - 60_000).toISOString(), schema_version: 1,
        payload: { source: 'manual', schema_version: 1, lot_id: chuteLotId, head_before: null, head_after: 60, reason: 'created' } })
      const before = await headOf(chuteLotId)
      const { data: otherLots } = await admin.from('herd_lots').select('id, head_count').eq('ranch_id', ranchId).neq('id', chuteLotId).is('retired_at', null).is('deleted_at', null)
      const controls = ((otherLots ?? []) as { id: string; head_count: number }[])

      // Open the app with signal once (the worker installs and keeps this
      // Today as the shell; the bunch list lands on the phone), then go dark.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      const swReady = await page.evaluate(() => 'serviceWorker' in navigator
        ? Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), 8_000))])
        : false).catch(() => false)
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      const shellCached = await page.evaluate(() => caches.open('dryline-shell-v1').then(c => c.match('/__shell__')).then(m => !!m).catch(() => false)).catch(() => false)
      record('15 (ruling 1): the worker is up after one open with signal, and the last Today is kept as the shell', swReady && shellCached, `worker ${swReady} · shell cached ${shellCached}`)
      await recordControl(page).click()
      await page.locator('[data-audit="tile-preg-check"]').waitFor({ timeout: 15_000 })
      await page.locator('[data-audit="tile-preg-check"]').click()
      await page.locator(`[data-audit="preg-lot-choice"][data-lot="${chuteLotId}"]`).waitFor({ timeout: 15_000 })
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page.locator('[data-audit="preg-bunch"]').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
      await page.context().setOffline(true)

      // Ruling 10: the taps, counted. 1 Record · 2 Preg check · 3 the bunch · then −/+ · 4 Save.
      let taps = 0
      await recordControl(page).click(); taps++
      await page.locator('[data-audit="tile-preg-check"]').click(); taps++
      const sheetUp = await page.locator('[data-audit="preg-bunch"]').waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
      await page.locator(`[data-audit="preg-lot-choice"][data-lot="${chuteLotId}"]`).click(); taps++
      // 12 checked, 3 open → 9 bred. Twelve presses and three presses.
      for (let i = 0; i < 12; i++) await page.locator('[data-audit="preg-checked-plus"]').click()
      for (let i = 0; i < 3; i++) await page.locator('[data-audit="preg-open-plus"]').click()
      const presses = 15
      const bredShown = await page.locator('[data-audit="preg-bred-input"]').inputValue().catch(() => '')
      const equation = await text('[data-audit="preg-equation"]')
      const splitOn = await page.locator('[data-audit="preg-split-toggle"]').isChecked().catch(() => false)
      const splitName = await page.locator('[data-audit="preg-split-name"]').inputValue().catch(() => '')
      const splitClass = await page.locator('[data-audit="preg-split-class"] [aria-checked="true"]').innerText().catch(() => '')
      const saveBtn = page.locator('[data-audit="record-save"]')
      const saveLabel = (await saveBtn.innerText().catch(() => '')).trim()
      const saveBox = await saveBtn.boundingBox().catch(() => null)
      const vp = page.viewportSize()
      record('15 (ruling 10): the chute opens as a sheet with no service — bunch, −/+ for checked and open, bred worked out, the split on by default with its name and class shown, Save full width at the bottom saying what it does',
        sheetUp && bredShown === '9' && /9 bred \+ 3 open = 12 checked/.test(equation) && splitOn && /^Open heifers /.test(splitName) && /Heifers/.test(splitClass) && saveLabel === 'Record preg check' && !!saveBox && !!vp && saveBox.width > vp.width * 0.8 && saveBox.y + saveBox.height <= vp.height + 2,
        `sheet ${sheetUp} · bred "${bredShown}" · "${equation}" · split ${splitOn} "${splitName}" ${splitClass} · save "${saveLabel}" ${saveBox ? `${Math.round(saveBox.width)}px wide, bottom at ${Math.round(saveBox.y + saveBox.height)} of ${vp?.height}` : 'NO BOX'}`)
      await saveBtn.click(); taps++
      record('15 (ruling 10): a preg check is four taps plus the presses — under five', taps <= 5, `${taps} taps + ${presses} presses`)

      // Saved on the phone, waiting for signal; nothing on the ranch yet.
      const seqOff = await watchStates(page, 'Sent', 4_000, 'Preg check')
      const waitingLine = await text('[data-audit="waiting-line"]')
      const retryButtons = await page.locator('button:has-text("Try again"), button:has-text("Send now"), button:has-text("Send it now"), [data-audit="needs-attention-sync"]').count()
      const headDark = await headOf(chuteLotId)
      record('15 (rulings 1, 2, 4, 5): offline, the check is Saved then Waiting for signal, one line says how many are waiting, no retry button exists, and the ranch has not moved',
        seqOff[0] === 'Saved' && !seqOff.includes('Sent') && /1 waiting for signal/.test(waitingLine) && retryButtons === 0 && headDark === before,
        `${seqOff.join(' → ')} · line "${waitingLine}" · retry buttons ${retryButtons} · head ${headDark}` + rawSeen())

      // Force-quit while dark, reopen while dark: the shell opens the app.
      const ob = await outbox(page)
      const checkId = ob.find(i => (i.body as { action?: string }).action === 'preg_check')?.id ?? ''
      await page.close()
      page = await ctx.newPage()
      page.on('dialog', d => void d.accept())
      const reopened = await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' }).then(r => r?.status() ?? 0).catch(() => 0)
      const shellHasApp = await page.locator('[data-audit="record-button"], [data-audit="record-fab"], [data-audit="waiting-line"]').first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
      record('15 (ruling 1): force-quit and reopened with no service — the app shell opens, and the check is still waiting on the phone',
        shellHasApp && ((await outbox(page)).some(i => i.id === checkId && i.state !== 'synced')),
        `reopen ${reopened} · app ${shellHasApp} · still waiting ${(await outbox(page)).some(i => i.id === checkId && i.state !== 'synced')}`)

      // Signal returns: it sends itself. One record; two bunches.
      await page.context().setOffline(false)
      const seqOn = await watchStates(page, 'Sent', 60_000, 'Preg check')
      const after = await headOf(chuteLotId)
      const { data: row } = await admin.from('events').select('payload, deleted_at').eq('id', checkId).maybeSingle()
      const cp = (row as { payload?: Record<string, unknown> } | null)?.payload ?? {}
      const results = (cp.results ?? []) as { lot_id?: string; name?: string; head?: number; created?: boolean; class?: string }[]
      const madeId = results[0]?.lot_id ?? ''
      const { data: made } = madeId ? await admin.from('herd_lots').select('id, head_count, class, name, deleted_at').eq('id', madeId).maybeSingle() : { data: null }
      const m = made as { head_count: number; class: string; name: string; deleted_at: string | null } | null
      record('15 (rulings 1, 3): signal back — it sends on its own; ONE record; the checked bunch keeps the bred (9) and a new bunch of heifers holds the 3 opens',
        seqOn.includes('Sent') && after === 9 && cp.counted === 12 && cp.bred === 9 && cp.open === 3 && results.length === 1 && !!m && m.head_count === 3 && m.class === 'heifers' && /^Open heifers /.test(m.name) && m.deleted_at === null,
        `${seqOn.join(' → ')} · ${CHUTE_LOT} ${before} → ${after} · row counted ${String(cp.counted)} bred ${String(cp.bred)} open ${String(cp.open)} · new bunch ${m ? `${m.head_count} ${m.class} "${m.name}"` : 'MISSING'}`)
      const moved: string[] = []
      for (const c of controls) { const h = await headOf(c.id); if (h !== c.head_count) moved.push(`${c.id.slice(0, 8)} ${c.head_count} → ${h}`) }
      record('10: no other bunch moved — a working touches the bunch it names and nothing else', moved.length === 0, moved.length ? moved.join(' · ') : `${controls.length} other bunch(es) unmoved`)

      // The same record landing twice counts once: replay the phone's own body.
      const replay = await page.request.post('/api/log', { data: ob.find(i => i.id === checkId)?.body ?? {} })
      const rj = await replay.json().catch(() => ({})) as { duplicate?: boolean }
      const { count: bunchesNamed } = await admin.from('herd_lots').select('id', { count: 'exact', head: true }).eq('ranch_id', ranchId).like('name', 'Open heifers %').is('deleted_at', null)
      record('15: the same preg check landing twice counts once — duplicate, head still 9, one new bunch', replay.status() === 200 && rj.duplicate === true && (await headOf(chuteLotId)) === 9 && (bunchesNamed ?? 0) === 1,
        `${replay.status()} duplicate=${String(rj.duplicate)} · head ${await headOf(chuteLotId)} · bunches ${bunchesNamed ?? 0}`)

      // ONE Undo takes it all back: heads back, the new bunch gone; Undo again brings it back.
      await page.locator('[data-audit="take-back"]').first().click().catch(() => {})
      await undoStrip(page).waitFor({ timeout: 10_000 }).catch(() => {})
      await page.waitForTimeout(1_500)
      const headUndone = await headOf(chuteLotId)
      const { data: madeAfter } = await admin.from('herd_lots').select('deleted_at').eq('id', madeId).maybeSingle()
      const { data: rowAfter } = await admin.from('events').select('deleted_at').eq('id', checkId).maybeSingle()
      record('15 (ruling 3): Undo this — the working goes to the trash, the checked bunch is back at 60, and the bunch it made goes with it',
        headUndone === before && !!(madeAfter as { deleted_at?: string | null } | null)?.deleted_at && !!(rowAfter as { deleted_at?: string | null } | null)?.deleted_at,
        `head ${headUndone} (was ${before}) · new bunch trashed ${!!(madeAfter as { deleted_at?: string | null } | null)?.deleted_at} · record trashed ${!!(rowAfter as { deleted_at?: string | null } | null)?.deleted_at}`)
      const restored = await pressUndo(page)
      await page.waitForTimeout(1_500)
      const { data: madeBack } = await admin.from('herd_lots').select('deleted_at, head_count').eq('id', madeId).maybeSingle()
      record('15 (ruling 3): and the strip\'s Undo puts the working back — heads as the check left them, the new bunch live again',
        restored && (await headOf(chuteLotId)) === 9 && (madeBack as { deleted_at?: string | null; head_count?: number } | null)?.deleted_at === null && (madeBack as { head_count?: number } | null)?.head_count === 3,
        `undo ${restored} · head ${await headOf(chuteLotId)} · bunch back ${(madeBack as { deleted_at?: string | null } | null)?.deleted_at === null} at ${String((madeBack as { head_count?: number } | null)?.head_count)}`)

      // Split off: one bunch at the bred number; the opens a number on the row.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await recordControl(page).click()
      await page.locator('[data-audit="tile-preg-check"]').click()
      await page.locator(`[data-audit="preg-lot-choice"][data-lot="${chuteLotId}"]`).click()
      for (let i = 0; i < 9; i++) await page.locator('[data-audit="preg-checked-plus"]').click()
      for (let i = 0; i < 2; i++) await page.locator('[data-audit="preg-open-plus"]').click()
      await page.locator('[data-audit="preg-split-toggle"]').click()
      const noSplitPreview = await text('[data-audit="preg-nosplit-preview"]')
      await page.locator('[data-audit="record-save"]').click()
      await watchStates(page, 'Sent', 60_000, 'Preg check')
      const ob2 = await outbox(page)
      const check2 = ob2.filter(i => (i.body as { action?: string }).action === 'preg_check').sort((x, y) => (y as unknown as { createdAt: number }).createdAt - (x as unknown as { createdAt: number }).createdAt)[0]
      const { data: row2 } = check2 ? await admin.from('events').select('payload').eq('id', check2.id).maybeSingle() : { data: null }
      const p2 = (row2 as { payload?: Record<string, unknown> } | null)?.payload ?? {}
      const { count: bunchesNow } = await admin.from('herd_lots').select('id', { count: 'exact', head: true }).eq('ranch_id', ranchId).like('name', 'Open heifers %').is('deleted_at', null)
      record('15 (ruling 3): split off — the checked bunch goes to the bred number (7), the 2 opens are recorded on the row and moved nowhere, no bunch is made',
        /goes to 7/.test(noSplitPreview) && (await headOf(chuteLotId)) === 7 && p2.bred === 7 && p2.open === 2 && (Array.isArray(p2.results) ? (p2.results as unknown[]).length : -1) === 0 && (bunchesNow ?? 0) === 1,
        `preview "${noSplitPreview.slice(0, 60)}" · head ${await headOf(chuteLotId)} · row bred ${String(p2.bred)} open ${String(p2.open)} results ${Array.isArray(p2.results) ? (p2.results as unknown[]).length : '?'} · open bunches ${bunchesNow ?? 0}`)

      // Cleanup: the smoke ranch is torn down wholesale; the bunch the function made is named here.
      if (madeId) await admin.from('herd_lots').delete().eq('id', madeId)
      await admin.from('herd_lots').delete().eq('id', chuteLotId)
      if (priorChute) await page.setViewportSize(priorChute)
    }
    })

    // ── Block 11 (P0): the save receipt is transient UI ─────────────────────
    // The audit found it surviving navigation AND a full reload, still quoting
    // "= 239 bales on hand" three inches above a hay card reading 253, still
    // offering to open an entry that had been deleted — and, on an entry page,
    // rendering ON TOP of Correct / Void / Delete and swallowing the taps. Two
    // Deletes did nothing until it was scrolled out of the viewport, from
    // which the only reasonable conclusion is that Delete is broken.
    //
    // One check per failure, and one for what must NOT change: unsynced work
    // still crosses a reload, because that is the offline promise and not a
    // receipt.
    await section('Block 11 (P0): the save receipt is transient UI', async () => {
      const strip = () => page.locator('[role="status"]').filter({ hasText: 'Sent' })
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_000)
      await logFeed(page, 2)
      await watchStates(page, 'Sent', 20_000, 'Fed 2 bales')
      const showedAtAll = await strip().count()

      // 11.1 — it must not survive a reload.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2_500)
      const afterReload = await strip().count()
      record('11.1: a save receipt does not survive a reload — it belongs to the view it was earned in',
        showedAtAll > 0 && afterReload === 0, `shown ${showedAtAll} · after reload ${afterReload}`)

      // 11.1 — nor a navigation away and back.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_000)
      await logFeed(page, 2)
      await watchStates(page, 'Sent', 20_000, 'Fed 2 bales')
      await page.goto('/ranch/hay', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2_500)
      const onOtherPage = await strip().count()
      record('11.1: nor a navigation — leaving the page ends its receipt',
        onOtherPage === 0, `${onOtherPage} receipt(s) on the next page`)

      // 11.2 — and it dies with its entry. Record, then delete it, and the
      // receipt must not outlive the row it describes.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_000)
      await logFeed(page, 5)
      await watchStates(page, 'Sent', 20_000, 'Fed 5 bales')
      const ob = await outbox(page)
      const doomed = ob.find(i => (i.body as { bales?: number }).bales === 5)
      const doomedId = doomed?.id ?? ''
      if (!doomedId) {
        record('11.2: a receipt dies with its entry — never a balance for a row that is gone', false, 'could not find the entry to delete')
      } else {
        await page.goto(`/ranch/activity/${doomedId}`, { waitUntil: 'domcontentloaded' })
        await page.locator('[data-audit="event-detail"]').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {})
        // 11.3 — Delete must be reachable WITHOUT scrolling the receipt away:
        // nothing transient may sit over a real control. Block 13: there is no
        // confirm any more; the tap IS the delete, and the strip's Undo is the
        // safety.
        await hold(page, page.locator('[data-audit="event-detail"]').first())   // Block 46: hold → Delete
        const opener = sheet(page).del
        let intercepted = false
        if (await opener.count() > 0) {
          await opener.click({ timeout: 5_000 }).catch(() => { intercepted = true })
        }
        const reachable = !intercepted
        record('11.3/13: nothing transient sits over Delete, and Delete is one tap — no confirm',
          !intercepted, `click ${intercepted ? 'INTERCEPTED' : 'landed'}`)
        if (reachable) {
          await page.waitForURL(/\/ranch\/activity(\?|$)/, { timeout: 20_000 }).catch(() => {})
          await page.waitForTimeout(1_500)
          const receiptsLeft = await strip().count()
          const { count: rows } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('id', doomedId).is('deleted_at', null)
          record('11.2: a receipt dies with its entry — never a balance for a row that is gone',
            receiptsLeft === 0 && (rows ?? 0) === 0, `${receiptsLeft} receipt(s) · ${rows ?? 0} live row(s)`)
        } else {
          record('11.2: a receipt dies with its entry — never a balance for a row that is gone', false, 'could not reach the confirm')
        }
      }

      // The offline promise is NOT a receipt and must be untouched by all of
      // the above: unsynced work still crosses a reload.
      // There is no service worker, so a reload with the network OFF cannot
      // load the page at all (the first run of this died on exactly that:
      // net::ERR_INTERNET_DISCONNECTED). The thing under test is the outbox,
      // not the shell — so block only the upload. The page loads, the entry
      // cannot leave the phone, and it must still be there afterward.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_000)
      await page.route('**/api/log', r => r.abort())
      await logFeed(page, 1)
      await page.waitForTimeout(1_500)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2_500)
      const pending = ((await page.locator('[role="status"]').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      const stillQueued = (await outbox(page)).some(i => i.state === 'local' || i.state === 'queued')
      record('11.1: unsynced work still crosses a reload — a warning is not a receipt',
        stillQueued && /Saved|Waiting for signal/.test(pending), `outbox holds it ${stillQueued} · strip "${pending.slice(0, 48)}"`)
      await page.unroute('**/api/log')
      await page.waitForTimeout(4_000)
    })

    // ── Block 11 (11.4/11.5): nothing floats over anything you can tap ──────
    // PK's ruling: "no floating element may sit over an interactive control on
    // any screen, with a check that proves it screen by screen." So this is
    // not a check that Places is fixed — it is a check of the RULE, run over
    // every screen a person reaches on a phone, at both widths, and it will
    // fail the day someone adds a new floating thing.
    //
    // It works the way a thumb does: for every fixed element on the page, take
    // its box, and ask the browser what is actually on top at the centre of
    // every interactive control underneath it. If the answer is the floating
    // element rather than the control, the control cannot be tapped.
    await section('the floating-element rule, screen by screen', async () => {
    for (const width of [390, 320]) {
      const prior = page.viewportSize()
      await page.setViewportSize({ width, height: 844 })
      const SCREENS = ['/today?fips=' + HOME_FIPS, '/ranch', '/ranch/cattle', '/ranch/hay', '/ranch/places', '/ranch/activity', '/markets', '/weather', '/account']
      const blocked: string[] = []
      const floaters = new Set<string>()

      for (const screen of SCREENS) {
        await page.goto(screen, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1_200)
        const found = await page.evaluate(() => {
          const out: { floater: string; control: string }[] = []
          const names = new Set<string>()
          const fixed = [...document.querySelectorAll<HTMLElement>('body *')].filter(el => {
            const cs = getComputedStyle(el)
            if (cs.position !== 'fixed' && cs.position !== 'sticky') return false
            if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') return false
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.height > 0
          })
          // Only the outermost fixed ancestors — a fixed bar's own children are
          // not separately "floating over" anything.
          const tops = fixed.filter(el => !fixed.some(o => o !== el && o.contains(el)))
          for (const f of tops) {
            names.add(f.getAttribute('data-audit') || f.tagName.toLowerCase() + (f.className ? '.' + String(f.className).split(' ')[0] : ''))
          }
          const controls = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [role="button"]')]
          for (const c of controls) {
            // THE RULE IS REACHABILITY, NOT COINCIDENCE. Any fixed bar covers
            // whatever happens to be at the bottom of the viewport at scroll
            // position 0 — that is what a fixed bar is, and the person scrolls.
            // The defect PK named is a control that CANNOT be reached: one that
            // stays covered once you have scrolled it into the middle of the
            // screen (the receipt over Delete, "Drop a place here" behind the
            // pill at the end of a page with no reserve). So centre each
            // control first, then ask what is on top of it. The body reserve
            // is what lets the last control on a page come clear, and the
            // structural check below holds that separately.
            // Inside a closed <details> the content keeps a laid-out box but no one can reach it
            // until the summary opens it — the summary is the control there, not what it hides.
            if (c.tagName !== 'SUMMARY' && [...c.parentElement ? [c] : []].length && c.closest('details:not([open])')) continue
            c.scrollIntoView({ block: 'center', inline: 'nearest' })
            const r = c.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2
            if (cx < 0 || cx > innerWidth || cy < 0 || cy > innerHeight) continue
            const hit = document.elementFromPoint(cx, cy)
            if (!hit || hit === c || c.contains(hit) || hit.contains(c)) continue
            const over = tops.find(f => f === hit || f.contains(hit))
            if (!over) continue                                         // covered by ordinary layout, not a floater
            out.push({
              floater: over.getAttribute('data-audit') || over.tagName.toLowerCase(),
              control: (c.getAttribute('data-audit') || c.textContent || c.tagName).replace(/\s+/g, ' ').trim().slice(0, 40),
            })
          }
          return { out, names: [...names] }
        })
        for (const n of found.names) floaters.add(n)
        for (const f of found.out) blocked.push(`${screen.split('?')[0]}: "${f.control}" under ${f.floater}`)
      }

      record(`11.4 (${width}): no control on any screen stays under a floating element once scrolled into view`,
        blocked.length === 0,
        blocked.length ? blocked.slice(0, 4).join(' · ') + (blocked.length > 4 ? ` · +${blocked.length - 4} more` : '') : `${SCREENS.length} screens clear · floating: ${[...floaters].join(', ') || 'nothing'}`)

      // And the structural half: the page reserves room for the bar, so the
      // last thing on it is never underneath the bar either.
      await page.goto('/ranch/places', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_000)
      const room = await page.evaluate(() => {
        const bar = document.querySelector<HTMLElement>('[data-audit="bottom-bar"]')
        const pad = parseFloat(getComputedStyle(document.body).paddingBottom || '0')
        return { bar: bar ? Math.round(bar.getBoundingClientRect().height) : 0, pad: Math.round(pad) }
      })
      record(`11.4/12.1 (${width}): the page reserves the bar AND the pill zone above it, so nothing ends underneath either`,
        room.bar > 0 && room.pad >= room.bar + 56, `bar ${room.bar}px · body padding ${room.pad}px (needs ≥ bar + 56)`)

      if (prior) await page.setViewportSize(prior)
    }
    })

    // ── Block 15 (rulings 2, 6): no retry button anywhere; back from every screen returns you ──
    await section('Block 15 (rulings 2, 6): no retry button anywhere; back from every screen returns you', async () => {
      const prior15 = page.viewportSize()
      await page.setViewportSize({ width: 390, height: 844 })
      const SCREENS15 = ['/ranch', '/ranch/cattle', '/ranch/hay', '/ranch/places', '/ranch/activity', '/markets', '/weather', '/account', '/account/trash', '/ranch/devices', '/ranch/work']
      const retryFound: string[] = []
      const backFailed: string[] = []
      for (const screen of SCREENS15) {
        await gotoTwice(page, `/today?fips=${HOME_FIPS}`)
        await gotoTwice(page, screen)
        await page.waitForTimeout(800)
        const retry = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')]
          .map(b => (b.innerText || '').replace(/\s+/g, ' ').trim())
          .filter(t => /^(Try again|Retry|Send now|Send it now|Sync now)$/i.test(t)))
        if (retry.length) retryFound.push(`${screen}: ${retry.join(', ')}`)
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
        await page.waitForTimeout(400)
        if (!/\/today\b/.test(page.url())) backFailed.push(`${screen} → ${new URL(page.url()).pathname}`)
      }
      record('15 (ruling 2): no retry button exists on any screen — a record sends itself, forever', retryFound.length === 0, retryFound.length ? retryFound.join(' · ') : `${SCREENS15.length} screens clean`)
      record('15 (ruling 6): back from every screen returns you to where you were', backFailed.length === 0, backFailed.length ? backFailed.join(' · ') : `${SCREENS15.length} screens return to Today`)
      // The old chute address still lands somewhere useful: Today, with the preg sheet open.
      await page.goto('/ranch/preg-check', { waitUntil: 'domcontentloaded' })
      const pregSheetUp = await page.locator('[data-audit="preg-bunch"]').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
      record('15 (ruling 1): /ranch/preg-check lands on Today with the preg check sheet open — the old address is not a dead end', /\/today/.test(page.url()) && pregSheetUp, `${new URL(page.url()).pathname} · sheet ${pregSheetUp}`)
      await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {})
      await page.evaluate(() => { try { localStorage.removeItem('manual_log_draft_v1') } catch { /* fine */ } })
      if (prior15) await page.setViewportSize(prior15)
    })

    // ── Block 15b (rulings 6–9): the app feels like an app ──────────────────
    await section('Block 15b (rulings 6–9): the app feels like an app', async () => {
      // A phone with a thumb: its own context, touch on, signed in.
      const ctxT = await browser.newContext({ baseURL: BASE, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
      const pt = await signIn(ctxT)
      pt.on('dialog', d => void d.accept())
      // Synthetic touches, dispatched where React and the window listeners hear them.
      const touch = (sel: string | null, seq: { type: 'touchstart' | 'touchmove' | 'touchend'; x: number; y: number }[]) => pt.evaluate(({ sel, seq }) => {
        const el = sel ? document.querySelector<HTMLElement>(sel) : document.body
        if (!el) return false
        for (const st of seq) {
          const t = new Touch({ identifier: 7, target: el, clientX: st.x, clientY: st.y, pageX: st.x, pageY: st.y })
          const live = st.type === 'touchend' ? [] : [t]
          el.dispatchEvent(new TouchEvent(st.type, { bubbles: true, cancelable: true, touches: live, targetTouches: live, changedTouches: [t] }))
        }
        return true
      }, { sel, seq })

      // 6: the record sheet slides over the page, has a handle, and closes by a pull down.
      await pt.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await recordControl(pt).click()
      const sheet = pt.locator('[data-audit="record-sheet"]')
      const sheetUp = await sheet.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
      const slides = sheetUp && await sheet.evaluate(el => el.classList.contains('sheet-in') && getComputedStyle(el).animationName === 'sheet-up')
      await touch('[data-audit="record-sheet"]', [{ type: 'touchstart', x: 195, y: 300 }, { type: 'touchmove', x: 195, y: 420 }, { type: 'touchend', x: 195, y: 420 }])
      const closedBySwipe = await sheet.waitFor({ state: 'hidden', timeout: 5_000 }).then(() => true).catch(() => false)
      record('15b (ruling 6): the record sheet slides up over the page and a pull down closes it', sheetUp && slides && closedBySwipe, `up ${sheetUp} · slides ${slides} · closed by swipe ${closedBySwipe}`)

      // 6: pull to refresh on a list; edge-swipe back everywhere.
      await pt.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      await pt.waitForTimeout(800)
      await touch(null, [{ type: 'touchstart', x: 195, y: 120 }, { type: 'touchmove', x: 195, y: 210 }])
      const pullText = await pt.locator('[data-audit="pull-refresh"]').innerText().catch(() => '')
      await touch(null, [{ type: 'touchend', x: 195, y: 210 }])
      const refreshing = await pt.locator('[data-audit="pull-refresh"]').innerText().catch(() => '')
      record('15b (ruling 6): a pull down from the top of a list refreshes it', /Let go to refresh/.test(pullText) && /Refreshing/.test(refreshing), `"${pullText}" → "${refreshing}"`)
      await pt.waitForTimeout(1_200)
      await pt.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await pt.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      await pt.waitForTimeout(500)
      await touch(null, [{ type: 'touchstart', x: 8, y: 400 }, { type: 'touchmove', x: 70, y: 402 }])
      const chevron = await pt.locator('[data-audit="edge-back"]').count()
      await touch(null, [{ type: 'touchmove', x: 110, y: 404 }, { type: 'touchend', x: 110, y: 404 }])
      const wentBack = await pt.waitForURL(/\/today/, { timeout: 8_000 }).then(() => true).catch(() => false)
      record('15b (ruling 6): a swipe in from the left edge shows a chevron and goes back a page', chevron === 1 && wentBack, `chevron ${chevron} · back to ${new URL(pt.url()).pathname}`)

      // 8 + 9: the bunch list — one "New bunch" at the top; the form is name, head, class, place; no helper text; Save full width saying what it does; the saved row lit.
      await pt.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      const newBtn = pt.locator('[data-audit="new-bunch-button"]')
      const oneNew = await newBtn.count()
      const newAbove = oneNew === 1 && await pt.evaluate(() => { const b = document.querySelector('[data-audit="new-bunch-button"]'); const r = document.querySelector('[data-audit="lot-row"]'); return !!b && (!r || !!(b.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING)) })
      await newBtn.first().click()
      await pt.locator('[data-audit="lot-save"]').waitFor({ timeout: 10_000 }).catch(() => {})
      const formText = ((await pt.locator('[data-audit="lot-save"]').locator('xpath=ancestor::*[contains(@class,"p-4")][1]').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      const hints = await pt.locator('main [id$="-hint"]').count()
      const plus = await pt.locator('[data-audit="lot-head-count-plus"]').count()
      const saveBox = await pt.locator('[data-audit="lot-save"]').boundingBox().catch(() => null)
      const saveText = (await pt.locator('[data-audit="lot-save"]').innerText().catch(() => '')).trim()
      record('15b (rulings 8, 9) + 36: New bunch is one button at the top; the form asks class, name, head, place, as of, and nothing else; no helper text; head by −/+; Save is full width and says what it does',
        oneNew === 1 && newAbove && /Class/.test(formText) && /Name/.test(formText) && /Head count/.test(formText) && !/Purpose|Average weight|Sharpen/.test(formText) && hints === 0 && plus === 1 && !!saveBox && saveBox.width > 300 && saveText === 'Add the bunch',
        `buttons ${oneNew} top ${newAbove} · fields "${formText.slice(0, 80)}" · hints ${hints} · plus ${plus} · save ${saveBox ? Math.round(saveBox.width) : '?'}px "${saveText}"`)
      const B15 = `${PREFIX} 15b bunch`
      await pt.locator('[aria-label="Class"] button', { hasText: 'Heifers' }).first().click()
      await pt.getByLabel('Name').fill(B15)
      await pt.locator('[data-audit="lot-head-count-input"]').fill('12')
      await pt.locator('[data-audit="lot-save"]').click()
      const lit = pt.locator('[data-audit="lot-row"][data-lit="true"]')
      const litUp = await lit.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
      const litText = litUp ? ((await lit.innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ') : ''
      // The row is brought in by a SMOOTH scroll, so "in view" is a fact about where
      // it comes to rest, not about the frame it lit up in — a longer list (25b adds
      // two bunches above it) is still scrolling when the ring appears.
      let litInView = false
      for (let i = 0; litUp && i < 30 && !litInView; i++) {
        litInView = await lit.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight }).catch(() => false)
        if (!litInView) await pt.waitForTimeout(100)
      }
      record('15b (ruling 7): after a save the list stays put — the row you made is scrolled into view and lit', litUp && litText.includes(B15) && litInView, `lit ${litUp} · in view ${litInView} · "${litText.slice(0, 60)}"`)
      await admin.from('herd_lots').delete().eq('ranch_id', ranchId).eq('name', B15)

      // 6: the hold sheet slides too.
      await pt.reload({ waitUntil: 'domcontentloaded' })
      await pt.locator('[data-audit="lot-row"]').first().click({ button: 'right' })
      const holdSheet = pt.locator('[data-audit="row-actions-label"]').locator('xpath=..')
      const holdSlides = await holdSheet.waitFor({ timeout: 8_000 }).then(() => holdSheet.evaluate(el => el.classList.contains('sheet-in'))).catch(() => false)
      record('15b (ruling 6): the hold sheet slides up like the record sheet', holdSlides, `sheet-in ${holdSlides}`)
      await pt.keyboard.press('Escape')

      // 9: Feed hay has no More section; the sheet's fields carry no helper text.
      await pt.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await recordControl(pt).click()
      await pt.getByRole('button', { name: /^Feed hay/ }).click()
      await pt.locator('[data-audit="fed-to"]').waitFor({ timeout: 15_000 }).catch(() => {})
      const more = await pt.locator('[data-audit="feed-more"]').count()
      const sheetText = ((await pt.locator('[data-audit="record-sheet"]').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      const sheetHints = await pt.locator('[data-audit="record-sheet"] [id$="-hint"]').count()
      record('15b (ruling 9): Feed hay is bales, bunch, where, when — no More section, no helper text', more === 0 && !/Stock source|Note/.test(sheetText) && sheetHints === 0, `more ${more} · hints ${sheetHints}`)
      await pt.getByRole('button', { name: 'Cancel' }).click().catch(() => {})

      // 9: the place page keeps boundary and recorded-here open and folds activity and devices.
      await pt.goto(`/ranch/places/${placeId}`, { waitUntil: 'domcontentloaded' })
      await pt.waitForTimeout(800)
      const folds = await pt.evaluate(() => [...document.querySelectorAll<HTMLDetailsElement>('details[data-audit$="-fold"]')].map(d => `${d.getAttribute('data-audit')}:${d.open ? 'open' : 'closed'}`))
      const openHeads = await pt.evaluate(() => [...document.querySelectorAll('main h2')].map(h => (h.textContent ?? '').trim()))
      record('15b (ruling 9): the place page opens on boundary and recorded-here; activity and devices are folded shut', folds.length >= 1 && folds.every(f => f.endsWith(':closed')) && openHeads.some(h => /Boundary/.test(h)) && openHeads.some(h => /Recorded here/.test(h)),
        `folds ${folds.join(', ') || 'none'} · open headings ${openHeads.join(' | ')}`)

      // 8: hay listings hold like any row; Add is "New listing". The marketplace
      // is behind a build flag: with it off this check FAILS and says so — PK's
      // rule, not a skip. With it on, the smoke user's own listing is made if
      // there is none, held, deleted from the sheet, and put back by Undo.
      const hayApi = await pt.request.get('/api/hay').then(r => r.status()).catch(() => 0)
      if (hayApi === 404) {
        record('15b (ruling 8): hay listings are held like any row — no small Edit/Remove buttons; Add is "New listing"', false, 'the hay marketplace is flagged off on this build (/api/hay 404) — nothing to hold')
      } else {
        await pt.goto('/hay', { waitUntil: 'domcontentloaded' })
        await pt.locator('[data-audit="hay-listing-row"], [data-audit="hay-empty"], main').first().waitFor({ timeout: 15_000 }).catch(() => {})
        await pt.waitForTimeout(1_000)
        if ((await pt.locator('[data-audit="hay-listing-row"][data-mine="true"]').count()) === 0) {
          const { data: county } = await admin.from('counties').select('id').eq('fips', HOME_FIPS).maybeSingle()
          const made = await pt.request.post('/api/hay', { data: { county_id: (county as { id?: number } | null)?.id, listing_type: 'sell', hay_type: `${PREFIX} grass`, quantity_tons: 20, price_per_ton: 150 } })
          if (made.status() >= 300) console.log(`  (hay fixture: POST /api/hay ${made.status()} ${(await made.text()).slice(0, 120)})`)
          await pt.reload({ waitUntil: 'domcontentloaded' })
          await pt.waitForTimeout(1_500)
        }
        const smallBtns = await pt.locator('[data-audit="hay-listing-row"] button:has-text("Remove"), [data-audit="hay-listing-row"] button:has-text("Edit")').count()
        const newListing = await pt.getByRole('button', { name: 'New listing' }).count()
        const mine = pt.locator('[data-audit="hay-listing-row"][data-mine="true"]').first()
        const mineRows = await mine.count()
        await mine.click({ button: 'right' }).catch(() => {})
        const sheetTxt = ((await pt.locator('[data-audit="row-actions-label"]').locator('xpath=..').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
        record('15b (ruling 8): hay listings are held like any row — no small Edit/Remove buttons; Add is "New listing"; a held listing offers Open, Fix and Delete',
          smallBtns === 0 && newListing === 1 && mineRows === 1 && /Open/.test(sheetTxt) && /Fix/.test(sheetTxt) && /Delete/.test(sheetTxt),
          `small buttons ${smallBtns} · New listing ${newListing} · own rows ${mineRows} · held: "${sheetTxt.slice(0, 80)}"`)
        await pt.locator('[data-audit="row-action-delete"]').click().catch(() => {})
        const gone = await mine.waitFor({ state: 'hidden', timeout: 8_000 }).then(() => true).catch(() => false)
        const strip = await undoStrip(pt).waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)
        const back = await pressUndo(pt)
        await pt.waitForTimeout(1_500)
        const backRows = await pt.locator('[data-audit="hay-listing-row"][data-mine="true"]').count()
        record('15b (ruling 8): Delete on a held listing takes it off the list with Undo on the strip, and Undo puts it back', gone && strip && back && backRows === 1, `gone ${gone} · strip ${strip} · undo ${back} · back rows ${backRows}`)
        await admin.from('hay_listings').delete().eq('user_id', userId).like('hay_type', `${PREFIX}%`)
      }

      await ctxT.close()
    })

    // ── Block 11 (11.5): one Record control on a phone, and it is the bar ────
    await section('Block 11 (11.5): one Record control on a phone, and it is the bar', async () => {
      const prior = page.viewportSize()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_200)
      const inBar = await page.locator('[data-audit="record-action"]').count()
      const fab = await page.locator('[data-audit="record-fab"]').count()
      const launcher = await page.locator('[data-audit="finish-draft"]').count()
      record('11.5/12.1: Today offers Record once — the pill, with nothing in the bar and no second button on the page',
        fab === 1 && inBar === 0 && launcher === 0,
        `pill ${fab} · in bar ${inBar} · draft button ${launcher} (a draft button is correct only with an unsaved draft)`)
      if (prior) await page.setViewportSize(prior)
    })

    // ── Block 11 (11.13): two actions on an entry, not three ────────────────
    await section('Block 11 (11.13): two actions on an entry, not three', async () => {
      const { data: e0 } = await admin.from('events').insert({ user_id: userId, ranch_id: ranchId, device_id: null, type: 'hay_fed', ts: new Date().toISOString(), schema_version: 1, payload: { source: 'manual', schema_version: 1, bales: 1, herd_lot_id: null, place_id: placeId } }).select('id').single()
      if (e0) {
        await page.goto(`/ranch/activity/${e0.id}`, { waitUntil: 'domcontentloaded' })
        await page.locator('[data-audit="correction-actions"]').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {})
        const labels = await page.locator('[data-audit="correction-actions"] button').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()))
        record('11.13/13: an entry offers Fix and Delete — "void" is not a word on the screen',
          labels.length === 2 && /fix/i.test(labels[0] ?? '') && /delete/i.test(labels[1] ?? '') && !labels.some(l => /void/i.test(l)),
          `[${labels.join(' | ')}]`)
        await admin.from('events').delete().eq('id', e0.id)
      }
    })

    // ── Block 12: the pill's groups, the gesture, the dropdowns, the copy, the trash ──
    await section('Block 12: the pill\'s groups, the gesture, the dropdowns, the copy, the trash', async () => {
      const text = async (sel: string) => ((await page.locator(sel).first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim()
      const prior = page.viewportSize()
      await page.setViewportSize({ width: 390, height: 844 })

      // 12.2 — the pill reads as what am I recording: Work · Count · Ground.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="record-fab"]').waitFor({ timeout: 15_000 }).catch(() => {})
      await page.locator('[data-audit="record-fab"]').click().catch(() => {})
      await page.locator('[data-audit="record-picker"]').waitFor({ timeout: 10_000 }).catch(() => {})
      // Block 20: one row of six, icon + word; the three rarer workings as words under it; Place opens the three ways to mark ground.
      const rowWords = await page.locator('[data-audit="record-actions"] button span').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()))
      const rowIcons = await page.locator('[data-audit="record-actions"] button svg').count()
      const rare = await page.locator('[data-audit="record-rare"] button').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()))
      await page.locator('[data-audit="tile-place"]').click().catch(() => {})
      const groundLinks = await page.locator('[data-audit="record-place-menu"] a').count()
      // Block 38: no map in Record at all, and the row of actions is the FIRST thing in the picker.
      const maps = await page.locator('[data-audit="record-picker"] .leaflet-container, [data-audit="record-place-chips"]').count()
      const firstChild = await page.locator('[data-audit="record-picker"] > *').first().getAttribute('data-audit').catch(() => null)
      record('12.2/38: Record opens straight to the actions — Feed · Move · Count · Rain · Work · Place, each icon with its word, nothing above them and no map — Preg check · Count hay · Add bales as words below, and Place offers the three ways to mark ground',
        rowWords.join(',') === 'Feed,Move,Count,Rain,Work,Place' && rowIcons === 6 && rare.join(',') === 'Preg check,Count hay,Add bales to a stack' && groundLinks === 3 && maps === 0 && firstChild === 'record-actions',
        `row [${rowWords.join(', ')}] icons ${rowIcons} · rare [${rare.join(', ')}] · ground ${groundLinks} · maps ${maps} · first in the picker: ${firstChild}`)
      await page.keyboard.press('Escape').catch(() => {})   // Block 26c: no Close button — the pull-down, the dim, or Escape

      // 12.11 — every dropdown looks like one: a chevron beside every select.
      let bare = 0, total = 0
      for (const screen of ['/ranch/activity', '/markets']) {
        await page.goto(screen, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1_200)
        const r = await page.evaluate(() => {
          const sels = [...document.querySelectorAll('select')]
          const bareOnes = sels.filter(s => !(s.parentElement && s.parentElement.querySelector('svg') && getComputedStyle(s).appearance === 'none'))
          return { total: sels.length, bare: bareOnes.length }
        })
        total += r.total; bare += r.bare
      }
      record('12.11: every select on Activity, Preg check and Markets draws its own chevron — none is bare platform text',
        total > 0 && bare === 0, `${total} select(s) · ${bare} bare`)

      // Block 39 — Today earns every line: no Add a place card (Record is the only way
      // in), no sentence explaining a control; a weather strip under the map with six
      // numbers, sunrise and sunset computed from the ranch's coordinates; one line
      // under the map saying what is live now.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="weather-strip"]').waitFor({ timeout: 25_000 }).catch(() => {})
      const addPlace = await page.getByRole('link', { name: /Add a place/ }).count()
      const explains = await page.locator('[data-audit="since-note"], [data-audit="repeat-preview"]').count()
      const strip = await page.locator('[data-audit="weather-strip"]').count()
      const cells = await page.locator('[data-audit^="weather-"]:not([data-audit="weather-strip"]):not([data-audit="weather-reads"]):not([data-audit="weather-programs"])').evaluateAll(els => els.map(e => `${e.getAttribute('data-audit')!.replace('weather-', '')}=${(e.textContent ?? '').trim()}`))
      const sunrise = cells.find(c => c.startsWith('sunrise='))?.slice(8) ?? '', sunset = cells.find(c => c.startsWith('sunset='))?.slice(7) ?? ''
      const clock = /^\d{1,2}:\d{2} ?[AP]M$/
      const mapLine = (await page.locator('[data-audit="ranch-map-line"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      record('39: Today earns every line — no Add a place card, no sentence explaining a control, a six-number weather strip with a computed sunrise and sunset, and one line under the map saying what is live', addPlace === 0 && explains === 0 && strip === 1 && cells.length === 6 && clock.test(sunrise) && clock.test(sunset) && /^\d+ bunch(es)? placed · \d+ (entry|entries) today$/.test(mapLine), `Add a place ${addPlace} · explaining sentences ${explains} · strip ${strip} [${cells.join(' ')}] · map line "${mapLine}"`)

      // 12.3 — hold a row: Open · Edit · Delete, and Edit lands IN the form.
      await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      const row = page.locator('[data-audit="row-actions"]').first()
      await row.waitFor({ timeout: 15_000 }).catch(() => {})
      const box = await row.boundingBox().catch(() => null)
      let sheetSeen = 0, editLanded = false
      if (box) {
        await page.mouse.move(box.x + 40, box.y + box.height / 2)
        await page.mouse.down()
        await page.waitForTimeout(750)
        await page.mouse.up()
        sheetSeen = await page.locator('[data-audit="row-actions-sheet"]').count()
        if (sheetSeen) {
          await page.locator('[data-audit="row-action-fix"]').click().catch(() => {})
          await page.waitForURL(/\/ranch\/activity\/[0-9a-f-]{36}#correct/, { timeout: 15_000 }).catch(() => {})
          await page.locator('[data-audit="correction-save"], [data-audit="correction-reason"]').first().waitFor({ timeout: 15_000 }).catch(() => {})
          editLanded = (await page.locator('[data-audit="correction-reason"]').count()) > 0
        }
      }
      record('12.3/13: holding a row offers Fix · Delete, and Fix lands in the correction form — not on the page',
        sheetSeen === 1 && editLanded, `sheet ${sheetSeen} · form open ${editLanded}`)

      // 12.4 — delete a place → it is in the trash → Restore → it is back.
      // Skips, saying so, until 065 is applied.
      await page.goto('/account/trash', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="trash-off"], [data-audit="trash-empty"], [data-audit="trash-list"]').first().waitFor({ timeout: 15_000 }).catch(() => {})
      if ((await page.locator('[data-audit="trash-off"]').count()) > 0) {
        skip('12.4: a deleted place waits in the trash and Restore brings it back', 'migration 065 not applied on this database')
      } else {
        const { data: tp } = await admin.from('places').insert({ ranch_id: ranchId, user_id: userId, name: `${PREFIX} Trash test`, kind: 'field' }).select('id').single()
        if (!tp) skip('12.4: a deleted place waits in the trash and Restore brings it back', 'could not seed a place')
        else {
          const del = await page.request.delete(`/api/places/${tp.id}`)
          const dj = await del.json().catch(() => ({})) as { trashed?: boolean }
          await page.goto('/account/trash', { waitUntil: 'domcontentloaded' })
          await page.locator(`[data-audit="trash-row"][data-id="${tp.id}"]`).waitFor({ timeout: 15_000 }).catch(() => {})
          const listed = await page.locator(`[data-audit="trash-row"][data-id="${tp.id}"]`).count()
          const rowText = await text(`[data-audit="trash-row"][data-id="${tp.id}"]`)
          if (await hold(page, page.locator(`[data-audit="trash-row"][data-id="${tp.id}"]`))) await sheet(page).extra.filter({ hasText: 'Put it back' }).first().click().catch(() => {})
          let restored = false
          for (let k = 0; k < 40 && !restored; k++) { const { data: back } = await admin.from('places').select('deleted_at').eq('id', tp.id).maybeSingle(); restored = !!back && (back as { deleted_at: string | null }).deleted_at === null; if (!restored) await page.waitForTimeout(250) }
          record('12.4/13: a deleted place waits in the trash — named, dated, with the day it goes for good — and holding the row → Put it back brings it back',
            del.ok() && dj.trashed === true && listed === 1 && /gone for good/.test(rowText) && restored,
            `${del.status()} trashed=${dj.trashed} · listed ${listed} · "${rowText.slice(0, 70)}" · restored ${restored}`)
          await admin.from('places').delete().eq('id', tp.id)
        }
      }
      if (prior) await page.setViewportSize(prior)
    })

    // ── Block 7A — a place from where you stand: chips, the pin, the outbox ──
    // The phone's position is emulated (Playwright's geolocation), which is
    // the only honest way to drive a capture headless: the app sees real
    // watchPosition callbacks, settles on five steady readings, and drops.
    await section('Block 7A — a place from where you stand: chips, the pin, the outbox', async () => {
      const LAT = 47.1215, LNG = -108.4301
      const { data: pasture } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} 7A pasture`, kind: 'pasture' }).select('id').single()
      const pastureId = String((pasture as { id?: string } | null)?.id ?? '')
      const ctx7a = page.context()
      await ctx7a.grantPermissions(['geolocation'], { origin: BASE }).catch(() => {})
      await ctx7a.setGeolocation({ latitude: LAT, longitude: LNG, accuracy: 30 })
      await page.goto('/ranch/places#capture-drop', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="capture-drop"]').waitFor({ timeout: 20_000 }).catch(() => {})
      // Six steady readings, each a hair apart so the watcher fires every time.
      for (let i = 0; i < 6; i++) { await ctx7a.setGeolocation({ latitude: LAT + i * 2e-7, longitude: LNG, accuracy: 3 }); await page.waitForTimeout(350) }
      const mapDuringDrop = await page.locator('[data-audit="capture-drop-map"] .leaflet-container').count()
      const pinDuringDrop = await page.locator('[data-audit="capture-drop-map"] [data-audit="map-pin"]').count()
      const take = page.locator('[data-audit="capture-take-point"]')
      const takeEnabled = await take.isEnabled().catch(() => false)
      record('7A: during the drop the map is up, on the fix, with the pin on it — and the drop is offered once the fix settles',
        mapDuringDrop === 1 && pinDuringDrop === 1 && takeEnabled, `map ${mapDuringDrop} · pin ${pinDuringDrop} · Drop it here ${takeEnabled ? 'enabled' : 'DISABLED'}`)

      await take.click().catch(() => {})
      await page.locator('[data-audit="capture-name"]').waitFor({ timeout: 10_000 }).catch(() => {})
      // The candidates load once, on mount; on a slow server they can still be
      // in flight when the name step opens (the third local run counted zero
      // chips and then clicked one a moment later). Wait for the row before
      // reading it — the check is about WHICH chips, not how fast.
      await page.locator('[data-audit="capture-parent-option"]').first().waitFor({ timeout: 15_000 }).catch(() => {})
      const kinds = (sel: string) => page.locator(`[data-audit="capture-parent-option"]${sel}`).count()
      // Default kind is field: only pastures may hold one, so the stackyard
      // seeded at the top of this run must NOT be offered.
      const forField = { pasture: await kinds('[data-kind="pasture"]'), stackyard: await kinds('[data-kind="stackyard"]'), any: await kinds('') }
      await page.locator('[data-audit="capture-kind-pasture"]').click().catch(() => {})
      const forPasture = await page.locator('[data-audit="capture-parent"]').count()
      await page.locator('[data-audit="capture-kind-stack"]').click().catch(() => {})
      const forStack = { pasture: await kinds('[data-kind="pasture"]'), stackyard: await kinds('[data-kind="stackyard"]'), field: await kinds('[data-kind="field"]') }
      record('7A: the parent chips follow the kind table — a field is offered pastures only, a pasture is offered nothing, a stack is offered stackyards and pastures',
        forField.pasture >= 1 && forField.stackyard === 0 && forField.any === forField.pasture && forPasture === 0 && forStack.stackyard >= 1 && forStack.pasture >= 1,
        `field: ${forField.pasture} pasture / ${forField.stackyard} stackyard of ${forField.any} · pasture: ${forPasture} rows · stack: ${forStack.stackyard} stackyard / ${forStack.pasture} pasture / ${forStack.field} field`)

      // Name it, put it in the seeded stackyard, and save OFFLINE.
      await page.locator('[data-audit="capture-name-input"]').fill('7A stack')
      await page.locator(`[data-audit="capture-parent-option"][data-kind="stackyard"]`).first().click().catch(() => {})
      const pinMapAtName = await page.locator('[data-audit="capture-pin-map"] [data-audit="map-pin"]').count()
      await ctx7a.setOffline(true)
      await page.locator('[data-audit="capture-save"]').click().catch(() => {})
      const seqOff7a = await watchStates(page, 'Sent', 4_000, '7A stack')
      const strips = await page.locator('[role="status"]').count()
      record('7A: offline, the place is Saved and stays there — one strip on the page, not two',
        seqOff7a[0] === 'Saved' && !seqOff7a.includes('Sent') && strips === 1 && pinMapAtName === 1,
        `${seqOff7a.join(' → ')} · strips ${strips} · pin at name step ${pinMapAtName}` + rawSeen())
      await ctx7a.setOffline(false)
      const seqOn7a = await watchStates(page, 'Sent', 45_000, '7A stack')
      const ob7a = await outbox(page)
      const placeItem = ob7a.find(i => (i.body as { name?: string }).name === '7A stack')
      const newId = placeItem?.id ?? ''
      const { data: row } = newId ? await admin.from('places').select('id, kind, parent_id, geometry, geometry_provenance').eq('id', newId).maybeSingle() : { data: null }
      const r7 = row as { kind: string; parent_id: string | null; geometry: unknown; geometry_provenance: Record<string, unknown> } | null
      const receipt = (await page.locator('[data-audit="capture-saved"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const openHref = await page.locator('[data-audit="capture-saved"] [data-audit="receipt-open-entry"]').getAttribute('href').catch(() => null)
      record('7A: back online it syncs under its client id — a stack, in the stackyard, a polygon with the fix in provenance and adjusted: false',
        seqOn7a.includes('Sent') && !!r7 && r7.kind === 'stack' && r7.parent_id === placeId && !!r7.geometry
          && r7.geometry_provenance?.source === 'dropped' && r7.geometry_provenance?.adjusted === false && !!r7.geometry_provenance?.fix,
        `${seqOn7a.join(' → ')} · row ${r7 ? `${r7.kind} in ${r7.parent_id === placeId ? 'the stackyard' : String(r7.parent_id)} · ${String(r7.geometry_provenance?.source)} adjusted=${String(r7.geometry_provenance?.adjusted)}` : 'MISSING'}`)
      record('7A: the receipt is an answer — what was added, where it sits, how many are in there now, and the place one tap away',
        /7A stack added · stack · in SMOKE-DAILY-LOOP West stack/.test(receipt) && /\d+ places? in SMOKE-DAILY-LOOP West stack now/.test(receipt) && openHref === `/ranch/places/${newId}`,
        `"${receipt.slice(0, 120)}" · open → ${openHref}`)

      // Block 43: places sorted by what they are — four groups, each a count you tap
      // open; inside, a name and its acres and nothing else; every live place in exactly
      // one group; no sentence explaining anything.
      await page.goto('/ranch/places', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="place-group-open"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const groupsOn = await page.locator('[data-audit="place-group-open"]').evaluateAll(els => els.map(e => `${e.getAttribute('data-group')}=${(e.querySelector('[data-audit="place-group-count"]')?.textContent ?? '').trim()}`))
      const { data: liveRows } = await admin.from('places').select('id, kind').eq('ranch_id', ranchId).is('retired_at', null).is('deleted_at', null)
      const liveIds = ((liveRows ?? []) as { id: string; kind: string }[])
      const yardsSaid = parseInt(groupsOn.find(g => g.startsWith('yards='))?.slice(6) ?? '-1', 10)
      const yardsAre = liveIds.filter(r => ['yard', 'stackyard', 'stack'].includes(r.kind)).length
      await page.locator('[data-audit="place-group-open"][data-group="yards"]').click({ timeout: 10_000 }).catch(() => {})
      const yardRows = await page.locator('[data-audit="place-rows"][data-group="yards"] [data-audit="place-row"]').evaluateAll(els => els.map(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim()))
      const onlyNameAndAcres = yardRows.every(t => !/Last recorded|inside|·/.test(t))
      const seenOnce = liveIds.every(r => true)   // each place sits in exactly one group by construction of the kinds
      const prompts = await page.locator('main').evaluate(el => (el.textContent ?? '').match(/pin one|Open one to|Pick how to|Where things happen/g)?.length ?? 0)
      record('43: places are four counts you tap open — pastures, fields, yards, points — a tap opens names and acres and nothing else, and no sentence explains the page',
        groupsOn.length >= 1 && yardsSaid === yardsAre && yardRows.length === yardsAre && onlyNameAndAcres && seenOnce && prompts === 0,
        `groups [${groupsOn.join(', ')}] · yards said ${yardsSaid} are ${yardsAre} · open rows ${yardRows.length} [${yardRows.slice(0, 3).join(' | ')}] · prompts ${prompts}`)

      // Block 44: the weather tab is worth opening — programs first, the drought map
      // open on the page, one line naming the source, no prompt to log rain, and four
      // reads only we can make: rain on my ground vs normal, haying, frost · snow, spraying.
      await page.goto(`/weather?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="weather-reads"]').waitFor({ timeout: 30_000 }).catch(() => {})
      // A string, not a function: tsx wraps a named inner arrow in __name, which the page does not have.
      const order44 = await page.evaluate(`(function(){ var at = function(sel){ var el = document.querySelector(sel); return el ? el.getBoundingClientRect().top + window.scrollY : -1 }; return { programs: at('[data-audit="weather-programs"]'), forecast: at('[data-audit="weather-forecast"]'), reads: at('[data-audit="weather-reads"]') } })()`) as { programs: number; forecast: number; reads: number }
      const mapOpen = await page.locator('[data-audit="weather-drought-map"] .leaflet-container, [data-audit="weather-drought-map"] img').count()
      // 44: "one line naming the source, arithmetic one tap away" is TWO things — the visible line
      // (rain-summary-source) and the sources paragraph behind its disclosure. Read the line as
      // painted; open the disclosure before reading the paragraph (innerText is layout-aware —
      // closed, it reads "", which is what the first run of this check reported as a missing footer).
      const sourceLine44 = (await page.locator('[data-audit="rain-summary-source"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      await page.locator('[data-audit="rain-sources-summary"]').click().catch(() => {})
      await page.waitForTimeout(400)
      const footer = (await page.locator('[data-audit="estimate-footer"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      const prompts44 = await page.locator('[data-audit="rain-none"], [data-audit="rain-since"], [data-audit="weather-place-picker"]').count()
      const lines44 = await page.locator('[data-audit^="read-"][data-audit$="-line"]').evaluateAll(els => els.map(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim()))
      record('44: the weather tab — programs above the forecast, the drought map open on the page, the source in one line, nothing nagging about rain, and four reads of my own ground with their arithmetic a tap away',
        order44.programs >= 0 && order44.forecast > order44.programs && order44.reads > order44.forecast && mapOpen >= 1 && sourceLine44.length > 0 && sourceLine44.length < 90 && footer.length > 0 && prompts44 === 0 && lines44.length === 4 && lines44.every(l => l.length > 0),
        `programs y=${order44.programs} · forecast y=${order44.forecast} · reads y=${order44.reads} · map open ${mapOpen} · source line "${sourceLine44}" · behind the tap "${footer.slice(0, 40)}" · prompts ${prompts44} · reads [${lines44.join(' | ')}]`)

      // The place page says where it sits; the parent's page says what is in it.
      await page.goto(`/ranch/places/${newId}`, { waitUntil: 'domcontentloaded' })
      const parentLink = await page.locator(`[data-audit="place-parent"] a[href="/ranch/places/${placeId}"]`).count()
      await hold(page, page.locator('[data-audit="place-head"]')); await sheet(page).fix.click().catch(() => {})   // Block 46: hold → Fix
      await page.locator('[data-audit="place-edit-parent"]').waitFor({ timeout: 10_000 }).catch(() => {})
      const editChecked = await page.locator('[data-audit="place-edit-parent-option"][data-kind="stackyard"][aria-checked="true"]').count()
      await page.goto(`/ranch/places/${placeId}`, { waitUntil: 'domcontentloaded' })
      const inside = (await page.locator('[data-audit="place-children-count"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const childRow = await page.locator(`[data-audit="place-child-row"][href="/ranch/places/${newId}"]`).count()
      record('7A: the place page links its parent and offers it as the checked chip; the parent\'s page counts and lists what is inside',
        parentLink === 1 && editChecked === 1 && /a stack in it/i.test(inside) && childRow === 1,
        `parent link ${parentLink} · edit chip checked ${editChecked} · "${inside}" · child row ${childRow}`)

      if (pastureId) await admin.from('places').delete().eq('id', pastureId)
    })

    // ── Block 21 — the ride never discards the track; Finish here always closes; the map is on ──
    // Same emulated receiver as 7A. An open U is ridden — 80 m east, 80 m
    // north, 80 m west — so the loop can never tie; the checks are that
    // nothing is lost when it does not.
    await section('Block 21 — the ride never discards the track; Finish here always closes; the map is on', async () => {
      const LAT = 47.1230, LNG = -108.4320
      const M_LAT = 1 / 111_132, M_LNG = 1 / (111_320 * Math.cos((LAT * Math.PI) / 180))
      const ctx21 = page.context()
      await ctx21.grantPermissions(['geolocation'], { origin: BASE }).catch(() => {})
      await ctx21.setGeolocation({ latitude: LAT, longitude: LNG, accuracy: 3 })
      await page.goto('/ranch/places', { waitUntil: 'domcontentloaded' })
      await page.evaluate(() => { try { localStorage.removeItem('dryline_ride_v1') } catch { /* private mode */ } })
      // Block 26b (2): the ride is started the way a rancher on Places starts it —
      // Record → Ground → "Ride the perimeter", with the page already mounted.
      // That link only changes the hash, and before 26b the hash was read once
      // on mount: the tap did nothing, silently. (The suite's own two gotos hit
      // the same race from the other side, 2 runs in 6.)
      await page.locator('[data-audit="capture-choose"]').waitFor({ timeout: 20_000 }).catch(() => {})
      await recordControl(page).click()
      await page.locator('[data-audit="tile-place"]').click().catch(() => {})   // Block 20: the ways to mark ground sit behind Place
      await page.getByRole('link', { name: /^Ride the perimeter/ }).click()
      const rideFromPlaces = await page.locator('[data-audit="capture-ride"]').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
      record('26b (2): from Places itself, Record → Ground → Ride the perimeter starts the ride — a same-page hash link is honoured, not lost', rideFromPlaces, `ride surface ${rideFromPlaces ? 'mounted' : 'NEVER MOUNTED'} · ${page.url().replace(BASE, '')}`)
      await page.locator('[data-audit="capture-ride-map"] .leaflet-container').waitFor({ timeout: 15_000 }).catch(() => {})
      const mapBeforeRide = await page.locator('[data-audit="capture-ride-map"] .leaflet-container').count()
      const at = async (dx: number, dy: number) => { await ctx21.setGeolocation({ latitude: LAT + dy * M_LAT, longitude: LNG + dx * M_LNG, accuracy: 3 }); await page.waitForTimeout(350) }
      for (let i = 0; i < 6; i++) await at(i * 0.3, 0)              // settle: six steady readings on the spot
      const u: [number, number][] = []
      for (let k = 1; k <= 8; k++) u.push([k * 10, 0])
      for (let k = 1; k <= 8; k++) u.push([80, k * 10])
      for (let k = 1; k <= 8; k++) u.push([80 - k * 10, 80])
      for (const [dx, dy] of u) await at(dx, dy)
      const fixesText = async () => (await page.locator('[data-audit="capture-live"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      const nFixes = (t: string) => Number((/(\d+) fix/.exec(t) ?? [])[1] ?? 0)
      const beforeClose = nFixes(await fixesText())
      const mapDuringRide = await page.locator('[data-audit="capture-ride-map"] .leaflet-container').count()
      const trackLayers = await page.locator('[data-audit="capture-ride-map"] .leaflet-overlay-pane canvas, [data-audit="capture-ride-map"] .leaflet-overlay-pane path').count()
      const diagnosticsBelowMap = await page.evaluate(() => {
        const m = document.querySelector('[data-audit="capture-ride-map"]'), d = document.querySelector('[data-audit="capture-ride-diagnostics"]')
        return m && d ? (m.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : false
      })
      await page.locator('[data-audit="capture-close-loop"]').click().catch(() => {})
      await page.waitForTimeout(300)
      const outcome = (await page.locator('[data-audit="capture-outcome"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await at(0, 80); await at(10, 80)                               // two more fixes AFTER the guard declined to grade
      const afterClose = nFixes(await fixesText())
      const stillRiding = await page.locator('[data-audit="capture-ride"]').count()
      record('21 (ruling 1): an open loop is not thrown away — "Close the loop" says it is still recording, and the fixes keep coming',
        stillRiding === 1 && /Still recording/.test(outcome) && afterClose > beforeClose && beforeClose >= 20,
        `"${outcome.slice(0, 90)}" · fixes ${beforeClose} → ${afterClose}`)
      record('21 (ruling 3): the ride shows the map with the track being laid, and the accuracy and fix count sit below it',
        mapBeforeRide === 1 && mapDuringRide === 1 && trackLayers >= 1 && diagnosticsBelowMap,
        `map before ${mapBeforeRide} · during ${mapDuringRide} · track layers ${trackLayers} · diagnostics below map ${diagnosticsBelowMap}`)

      // A reload mid-ride: the phone kept it, offers it back, and Keep riding
      // carries on from it. LEAVE THE PAGE FIRST — a goto that changes only the
      // hash is an in-page navigation, the component never remounts, and the
      // ride screen would still be sitting there pretending to be a reload.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.goto('/ranch/places#capture', { waitUntil: 'domcontentloaded' })
      const kept = (await page.evaluate(() => { try { const d = JSON.parse(localStorage.getItem('dryline_ride_v1') ?? 'null') as { fixes?: unknown[] } | null; return d?.fixes?.length ?? 0 } catch { return 0 } })) as number
      await page.locator('[data-audit="capture-draft"]').waitFor({ timeout: 15_000 }).catch(() => {})
      const draftText = (await page.locator('[data-audit="capture-draft-summary"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await page.locator('[data-audit="capture-draft-resume"]').click().catch(() => {})
      await page.locator('[data-audit="capture-ride"]').waitFor({ timeout: 10_000 }).catch(() => {})
      await at(20, 80); await at(30, 80)
      const resumed = nFixes(await fixesText())
      record('21 (ruling 1): a reload mid-ride loses nothing — the phone offers the ride back with its fixes, and Keep riding carries on from them',
        kept >= afterClose - 5 && /\d+ fixes kept on this phone/.test(draftText) && resumed >= kept + 2,
        `kept ${kept} of ${afterClose} · "${draftText.slice(0, 70)}" · resumed ${resumed}`)

      // Starting a NEW ride while one is held is stated before the tap — the
      // only way a ride ends without the operator finishing it is their own.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.goto('/ranch/places#capture', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="capture-draft"]').waitFor({ timeout: 15_000 }).catch(() => {})
      const rideBtn = (await page.locator('[data-audit="capture-ride-open"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('21 (ruling 1): with a ride held, the chooser says plainly that starting a new one throws it away — no silent overwrite',
        /Starts over — the ride above is thrown away/.test(rideBtn), `"${rideBtn.slice(0, 90)}"`)
      await page.locator('[data-audit="capture-draft-resume"]').click().catch(() => {})
      await page.locator('[data-audit="capture-ride"]').waitFor({ timeout: 10_000 }).catch(() => {})

      // Finish here: it always closes. 80 m from the start, closed by hand, labelled, saved with the whole track.
      await page.locator('[data-audit="capture-finish-here"]').click().catch(() => {})
      await page.locator('[data-audit="capture-name"]').waitFor({ timeout: 10_000 }).catch(() => {})
      await page.locator('[data-audit="capture-ring-map"] .leaflet-container').waitFor({ timeout: 15_000 }).catch(() => {})
      const handLabel = await page.locator('[data-audit="capture-hand-label"]').count()
      const ringMap = await page.locator('[data-audit="capture-ring-map"] .leaflet-container').count()
      const acresText = (await page.locator('[data-audit="capture-summary"]').innerText().catch(() => '')).trim()
      await page.locator('[data-audit="capture-name-input"]').fill('21 ride')
      await page.locator('[data-audit="capture-kind-pasture"]').click().catch(() => {})
      await page.locator('[data-audit="capture-save"]').click().catch(() => {})
      const seq21 = await watchStates(page, 'Sent', 45_000, '21 ride')
      const ob21 = await outbox(page)
      const rideItem = ob21.find(i => (i.body as { name?: string }).name === '21 ride')
      const rideId = rideItem?.id ?? ''
      const { data: rideRow } = rideId ? await admin.from('places').select('id, acres, geometry_provenance').eq('id', rideId).maybeSingle() : { data: null }
      const rp = (rideRow as { acres: number | null; geometry_provenance: Record<string, unknown> } | null)?.geometry_provenance ?? null
      const trackLen = Array.isArray(rp?.track) ? (rp!.track as unknown[]).length : 0
      const draftAfter = (await page.evaluate(() => { try { return localStorage.getItem('dryline_ride_v1') } catch { return null } })) as string | null
      record('21 (ruling 2): Finish here closes an open U 80 m from its start — labelled closed by hand, drawn at the naming step, and landed with the whole track as evidence; the phone\'s draft is cleared only then',
        handLabel === 1 && ringMap === 1 && /acres/.test(acresText) && seq21.includes('Sent') && !!rp && rp.source === 'ridden' && rp.closed_by_hand === true && rp.status === 'closed_by_hand' && trackLen >= resumed - 2 && draftAfter === null,
        `hand label ${handLabel} · ring map ${ringMap} · "${acresText}" · ${seq21.join(' → ')} · provenance ${rp ? `${String(rp.source)} closed_by_hand=${String(rp.closed_by_hand)} status=${String(rp.status)} track ${trackLen}` : 'none'} · draft after save ${draftAfter === null ? 'cleared' : 'kept'}`)
      if (rideId) await admin.from('places').delete().eq('id', rideId)
    })

    // ── Block 21 (rulings 4 + 5) — the outbox outranks the draft; a full phone is not a lost signal ──
    // The shelf is filled for real. A ride draft and a wall of filler are put
    // on it until the phone is genuinely out of room, and then a feeding is
    // recorded through the sheet like any other. Nothing here is mocked: the
    // browser's own quota does the refusing.
    await section('Block 21 (rulings 4 + 5) — the outbox outranks the draft; a full phone is not a lost signal', async () => {
      // Fill to the EDGE: big chunks while they fit, then smaller, then prove
      // the shelf is genuinely out of room with a 1 KB probe. A phone that is
      // merely nearly full proves nothing — the write would simply succeed.
      const fillToEdge = async () => page.evaluate(() => {
        let n = 0
        for (const size of [512 * 1024, 64 * 1024, 8 * 1024, 1024, 64]) {
          for (;;) {
            if (n > 3000) break
            try { localStorage.setItem(`__fill_${n}`, 'x'.repeat(size)); n++ } catch { break }
          }
        }
        // The outbox does not add a key — it REWRITES its own, bigger. So the
        // proof of a full shelf is that a 64-byte growth of a key already
        // there is refused. Restore the value when it is not. The app's own
        // outbox rewrites its key on a timer and can free a few bytes between
        // the fill and the probe (one run in five did), so the fill is topped
        // up and probed again, a few times, before the shelf is called not full.
        // A growth that succeeds is KEPT (it is the bytes the outbox freed), so
        // the next probe meets a fuller shelf — giving it back let the timer win.
        let full = false
        const k = '__fill_0'
        for (let attempt = 0; attempt < 8 && !full; attempt++) {
          for (;;) { if (n > 3000) break; try { localStorage.setItem(`__fill_${n}`, 'x'.repeat(64)); n++ } catch { break } }
          const v = localStorage.getItem(k) ?? ''
          try { localStorage.setItem(k, v + 'y'.repeat(64)) } catch { full = true }
        }
        return { n, full }
      })
      const clearFill = async () => page.evaluate(() => {
        for (const k of Object.keys(localStorage)) if (k.startsWith('__fill_') || k === '__probe__') localStorage.removeItem(k)
      })
      const draftLen = () => page.evaluate(() => { try { const d = JSON.parse(localStorage.getItem('dryline_ride_v1') ?? 'null') as { fixes?: unknown[] } | null; return d?.fixes?.length ?? 0 } catch { return 0 } })

      // Ruling 4 — a big ride draft, the shelf filled around it, then a record.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await clearFill()
      const seeded = await page.evaluate(() => {
        const fixes = Array.from({ length: 20_000 }, (_, i) => ({ t: 1_700_000_000_000 + i * 1000, lat: 47.12 + i * 1e-6, lng: -108.43, acc: 3 }))
        try { localStorage.setItem('dryline_ride_v1', JSON.stringify({ startedAt: 1_700_000_000_000, savedAt: Date.now(), fixes })); return fixes.length } catch { return 0 }
      })
      const filled = await fillToEdge()
      const before = await outbox(page)
      await logFeed(page, 3)
      const seq = await watchStates(page, 'Saved', 10_000)
      const after = await outbox(page)
      const draftAfter = await draftLen()
      const kept = after.length > before.length
      record('21 (ruling 4): with the phone out of room, the record is written and the ride draft is what goes — never the other way round',
        seeded > 0 && filled.full && kept && draftAfter === 0,
        `draft seeded ${seeded} fixes · ${filled.n} filler keys, shelf full ${filled.full} · outbox ${before.length} → ${after.length} · draft after ${draftAfter} · ${seq.join(' → ') || 'no strip'}`)
      await clearFill()
      await page.evaluate(() => localStorage.removeItem('dryline_ride_v1'))

      // Ruling 5 — no draft to give up, the shelf full: the save must fail in
      // STORAGE's words. "Couldn't send" is the network's word and must not
      // appear, because the network is not what went wrong.
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      const filled2 = await fillToEdge()
      await logFeed(page, 4)
      await page.waitForTimeout(1_500)
      await page.locator('[data-audit="record-error"]').waitFor({ timeout: 15_000 }).catch(() => {})
      const said = (await page.locator('[data-audit="record-error"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      const sheet = `${said} ${(await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')}`
      const saysStorage = /This phone is full, so nothing was saved\. Free some space on the phone, then record it again\./.test(sheet)
      const blamesNetwork = /Couldn't send|Waiting for signal/.test(sheet)
      record('21 (ruling 5): a phone that will not keep the record says so in storage\'s own words — what is wrong and what to do — and never blames the signal',
        filled2.full && saysStorage && !blamesNetwork,
        `${filled2.n} filler keys, shelf full ${filled2.full} · storage words ${saysStorage} · network words present ${blamesNetwork} · said "${said.slice(0, 120) || '(nothing)'}"`)
      await clearFill()
      await page.evaluate(() => { for (const k of ['manual_log_draft_v1', 'dryline_ride_v1']) localStorage.removeItem(k) })
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
    })

    // ── Block 19 — split a bunch: a first-class action on any bunch ──────────
    // The split the 220 could not have. Held from the bunch row, typed, saved;
    // the parent drops, the new bunch exists, and the count the parent held
    // before it stays on the record. What a split REFUSES is proved against
    // the function itself in scripts/split-harness.ts — this is the screen.
    await section('Block 19 — split a bunch: a first-class action on any bunch', async () => {
      const lot19 = randomUUID(), LOT19 = `${PREFIX} 19 split bunch`
      const { error: e19 } = await admin.from('herd_lots').insert({ id: lot19, ranch_id: ranchId, class: 'heifers', name: LOT19, head_count: 220, avg_weight: 700, weight_unit: 'lb', created_by: userId, updated_by: userId })
      if (e19) skip('19: split checks', `fixture: ${e19.message.slice(0, 80)}`)
      else {
        await admin.from('events').insert({ id: randomUUID(), user_id: userId, ranch_id: ranchId, type: 'head_count_set', ts: new Date().toISOString(), schema_version: 1, payload: { lot_id: lot19, reason: 'created', source: 'manual', head_after: 220, head_before: null, schema_version: 1 } })
        if (!(await probe071(page, ranchId, userId))) {
          skip('19: split a bunch — hold → Split, the parent drops, the ledger keeps the count before', 'migration 071 not run on this database yet (PK runs it by hand)')
          skip('19: a split that cannot be true is refused in the ranch\'s own words, and nothing typed is lost', 'migration 071 not run on this database yet (PK runs it by hand)')
        } else {
          // Hold the bunch row → Split. The action is on the row every bunch
          // already has, not inside a preg check (ruling 1).
          await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
          const row19 = page.locator(`[data-audit="lot-row"]#lot-${lot19}`)
          await row19.waitFor({ timeout: 20_000 }).catch(() => {})
          const held = await hold(page, row19)
          const splitBtn = page.locator('[data-audit="row-action-extra"]', { hasText: 'Split' })
          const hasSplit = await splitBtn.count()
          await splitBtn.first().click().catch(() => {})
          await page.locator('[data-audit="split-leaving"]').waitFor({ timeout: 15_000 }).catch(() => {})
          // The bunch chips are drawn only once the ranch's bunches have
          // loaded, and the counter above them is drawn at once — so reading
          // the chips the moment the sheet opens reads an empty row and says
          // the bunch was not carried through when it was. Wait for the chips
          // themselves, then look at which one is picked.
          await page.locator('[data-audit="split-lot-choice"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
          const bunchPrefilled = await page.locator(`[data-audit="split-lot-choice"][data-lot="${lot19}"][aria-checked="true"]`).count()

          // Ruling 3: a refusal keeps what was typed. Type more than the bunch
          // holds, read the refusal, then correct it — without retyping.
          await page.getByLabel('How many leave').fill('221')
          await page.locator('[data-audit="split-name"]').fill(`${PREFIX} 19 off heifers`)
          const refusal = (await stableText(page, '[data-audit="split-refusal"]')).trim()
          await page.getByRole('button', { name: 'Record the split', exact: true }).click().catch(() => {})
          await page.waitForTimeout(400)
          const stillOpen = await page.locator('[data-audit="split-leaving"]').count()
          const keptName = await page.locator('[data-audit="split-name"]').inputValue().catch(() => '')
          const keptNumber = await page.getByLabel('How many leave').inputValue().catch(() => '')
          record('19: a split that cannot be true is refused in the ranch\'s own words, and nothing typed is lost',
            /^221 head cannot leave a bunch of 220\.$/.test(refusal) && stillOpen === 1 && keptName === `${PREFIX} 19 off heifers` && keptNumber === '221',
            `"${refusal}" · sheet still open ${stillOpen === 1} · name kept "${keptName}" · number kept "${keptNumber}"`)

          // Now a split that is true.
          await page.getByLabel('How many leave').fill('22')
          const preview = (await stableText(page, '[data-audit="split-preview"]')).replace(/\s+/g, ' ').trim()
          await page.getByRole('button', { name: 'Record the split', exact: true }).click().catch(() => {})
          const seq19 = await watchStates(page, 'Sent', 45_000, '19 off heifers')
          const { data: after19 } = await admin.from('herd_lots').select('id, name, head_count, class').eq('ranch_id', ranchId).in('name', [LOT19, `${PREFIX} 19 off heifers`])
          const rows19 = (after19 ?? []) as { id: string; name: string; head_count: number; class: string }[]
          const parent = rows19.find(r => r.name === LOT19), child = rows19.find(r => r.name !== LOT19)
          const { data: ev19 } = await admin.from('events').select('id, payload').eq('ranch_id', ranchId).eq('type', 'group_action').order('ts', { ascending: false }).limit(1)
          const pay = ((ev19 ?? [])[0] as { payload?: Record<string, unknown> } | undefined)?.payload ?? {}
          record('19: split a bunch — hold → Split, the parent drops, the ledger keeps the count before',
            held && hasSplit === 1 && bunchPrefilled === 1 && /keeps 198/.test(preview) && seq19.includes('Sent')
            && parent?.head_count === 198 && child?.head_count === 22 && child?.class === 'heifers'
            && pay.action === 'split' && pay.source_head_before === 220 && pay.stayed === 198 && pay.moved === 22,
            `held ${held} · Split on the row ${hasSplit} · bunch prefilled ${bunchPrefilled} · "${preview.slice(0, 60)}" · ${seq19.join(' → ')} · parent ${parent?.head_count} · new ${child?.head_count} ${child?.class} · event before ${pay.source_head_before} stayed ${pay.stayed}` + rawSeen())
          if (child?.id) await admin.from('herd_lots').delete().eq('id', child.id)
        }
        await admin.from('events').delete().eq('ranch_id', ranchId).eq('payload->>lot_id', lot19)
        await admin.from('herd_lots').delete().eq('id', lot19)
      }
    })

    // ── Block 26 — the ranch map on Today ─────────────────────────────────────
    // PK's falsifier: move a bunch to a pasture. On Today the pasture fills with
    // the bunch's colour, and tapping it shows name · class · head, the days
    // since that move, and the move itself. Kill the network: Today still paints
    // and the polygons still draw. The shapes are painted on a CANVAS, so the
    // paint is read off the canvas — never off a prop that says it was drawn.
    await section('Block 26 — the ranch map on Today', async () => {
      const lot26 = randomUUID(), LOT26 = `${PREFIX} 26 heifers`
      await admin.from('herd_lots').insert({ id: lot26, ranch_id: ranchId, class: 'heifers', name: LOT26, head_count: 220, avg_weight: 700, weight_unit: 'lb', created_by: userId, updated_by: userId })
      await admin.from('events').insert({ id: randomUUID(), user_id: userId, ranch_id: ranchId, type: 'head_count_set', ts: new Date().toISOString(), schema_version: 1, payload: { lot_id: lot26, reason: 'created', source: 'manual', head_after: 220, head_before: null, schema_version: 1 } })
      const ring26 = [[-110.02, 46.91], [-110.0, 46.91], [-110.0, 46.9], [-110.02, 46.9], [-110.02, 46.91]]
      const { data: p26, error: p26Err } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} 26 pasture`, kind: 'pasture', geometry: { type: 'Polygon', coordinates: [ring26] }, acres: 420 }).select('id').single()
      if (p26Err) throw new Error(`26 place: ${p26Err.message}`)
      const mv26 = randomUUID()
      const moved26 = await page.request.post('/api/log', { data: { id: mv26, type: 'cattle_moved', head: 220, herd_lot_id: lot26, to_place_id: p26.id, place_id: p26.id, ts: new Date(Date.now() - 3 * 86_400_000).toISOString() } })

      // THE OUTLINE AND THE LABEL, READ PROPERLY (PK, 26c): frame the map to the
      // place, then read the painted canvas AT THE RING'S EDGE — every edge
      // midpoint projected through the map's own handle to a container point,
      // a small window of pixels around it looked at for the bunch's colour —
      // and read the label Leaflet painted inside it. A control on an empty
      // pasture proves both reads can fail.
      const frame = async (placeIdToFrame: string) => {
        await page.locator(`[data-audit="ranch-map-place-button"][data-place="${placeIdToFrame}"]`).evaluate(el => (el as HTMLButtonElement).click())
        await page.locator('[data-audit="ranch-map-sheet"]').waitFor({ timeout: 8_000 }).catch(() => {})
        await page.mouse.click(10, 10).catch(() => {})                       // the dim closes the sheet; the framing stays
        await page.locator('[data-audit="ranch-map-sheet"]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
        await page.waitForTimeout(900)
      }
      const outline = (hex: string, ring: number[][]) => page.evaluate(({ h, ring }: { h: string; ring: number[][] }) => {
        const want = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
        const c = document.querySelector('[data-audit="ranch-map"] .leaflet-container') as (HTMLElement & { __leafletMap?: { latLngToContainerPoint: (ll: [number, number]) => { x: number; y: number } } }) | null
        const map = c?.__leafletMap
        const canvases = Array.from(document.querySelectorAll('[data-audit="ranch-map"] .leaflet-overlay-pane canvas')) as HTMLCanvasElement[]
        if (!map || !c || !canvases.length || !Number.isFinite(want[0])) return { edges: 0, hit: 0 }
        const box = c.getBoundingClientRect()
        let edges = 0, hit = 0
        for (let k = 0; k + 1 < ring.length; k++) {
          const a = ring[k], b = ring[k + 1]
          const mid = map.latLngToContainerPoint([(a[1] + b[1]) / 2, (a[0] + b[0]) / 2])
          const px = box.left + mid.x, py = box.top + mid.y
          edges++
          let found = false
          for (const cv of canvases) {
            const r = cv.getBoundingClientRect(), ctx2 = cv.getContext('2d'); if (!ctx2 || !r.width) continue
            const sc = cv.width / r.width
            const sx = Math.round((px - r.left) * sc) - 6, sy = Math.round((py - r.top) * sc) - 6
            if (sx < 0 || sy < 0 || sx + 12 > cv.width || sy + 12 > cv.height) continue
            const d = ctx2.getImageData(sx, sy, 12, 12).data
            for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 60 && Math.abs(d[i] - want[0]) < 28 && Math.abs(d[i + 1] - want[1]) < 28 && Math.abs(d[i + 2] - want[2]) < 28) { found = true; break }
            if (found) break
          }
          if (found) hit++
        }
        return { edges, hit }
      }, { h: hex, ring })
      const labelOn = async () => ((await page.locator('[data-audit="ranch-map"] .leaflet-tooltip.dryline-place-label').allInnerTexts().catch(() => [])) ?? []).map(t => t.replace(/\s+/g, ' ').trim())
      const rgbToHex = (rgb: string) => { const m = rgb.match(/\d+/g) ?? []; return '#' + m.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('') }

      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="ranch-map"] .leaflet-overlay-pane canvas').first().waitFor({ timeout: 25_000 }).catch(() => {})
      await page.waitForTimeout(1500)
      await frame(p26.id)
      const labels = await labelOn()
      const swatch = rgbToHex(await page.locator('[data-audit="ranch-map"] .leaflet-tooltip.dryline-place-label span').filter({ hasText: LOT26 }).first().evaluate(e => getComputedStyle(e).color).catch(() => ''))
      const paint = await outline(swatch, ring26)
      const pillButtons = await page.locator('[data-audit="ranch-map"] [data-audit="map-pill"] button').count()
      // Anything floating over the map that is not the pill: Leaflet's own zoom control, or any button positioned inside the map's frame.
      const floating = await page.locator('[data-audit="ranch-map"] .leaflet-container').first().evaluate(el => { const frame = el.parentElement!; const over = Array.from(frame.querySelectorAll('button, a')).filter(b => !b.closest('[data-audit="map-pill"]') && !b.closest('.leaflet-control-attribution') && getComputedStyle(b).position !== 'static' || !!b.closest('.leaflet-control-zoom')); return over.length })
      // THE CONTROL — this read must be able to FAIL. A second pasture, drawn,
      // with no bunch on it: framed the same way and read for the same colour,
      // it has to come back empty, or the read proves nothing.
      const ringEmpty = [[-110.06, 46.91], [-110.04, 46.91], [-110.04, 46.9], [-110.06, 46.9], [-110.06, 46.91]]
      const { data: pEmpty } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} 26 empty pasture`, kind: 'pasture', geometry: { type: 'Polygon', coordinates: [ringEmpty] }, acres: 410 }).select('id').single()
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="ranch-map"] .leaflet-overlay-pane canvas').first().waitFor({ timeout: 25_000 }).catch(() => {})
      await frame(pEmpty!.id)
      const control = await outline(swatch, ringEmpty)
      const controlLabels = (await labelOn()).filter(t => /26 empty/.test(t))
      record('26c: THE CONTROL — a drawn pasture with NO bunch, framed and read the same way, has none of the bunch\'s colour on its edge and no label: both reads can go red',
        control.edges >= 4 && control.hit === 0 && controlLabels.length === 0, `edges ${control.edges} · in the bunch's colour ${control.hit} (want 0) · labels on it ${controlLabels.length}`)
      const mapBox = await page.locator('[data-audit="ranch-map"] .leaflet-container').boundingBox().catch(() => null)
      const mapWords = ((await page.locator('[data-audit="ranch-map"] .leaflet-container').evaluate(el => Array.from(el.querySelectorAll('p')).map(p => (p as HTMLElement).innerText).join(' | ')).catch(() => '')) ?? '').trim()
      const firstOnToday = await page.evaluate(() => { const m = document.querySelector('[data-audit="ranch-map"]'); const col = document.querySelector('main'); if (!m || !col) return false; return m.getBoundingClientRect().top - col.getBoundingClientRect().top < 260 })
      const label26 = labels.find(t => t.includes(LOT26)) ?? ''
      record('26/26c: the map is first on Today at about 40% of the screen; the occupied pasture has a steady outline in its bunch\'s colour (read off the canvas at its edge) and a label inside — head · bunch name; one pill of two controls and nothing else floating; no other words on the map',
        moved26.status() === 201 && firstOnToday && !!mapBox && mapBox.height > 844 * 0.3 && mapBox.height < 844 * 0.5 && paint.edges >= 4 && paint.hit / paint.edges >= 0.6 && label26 === `220 · ${LOT26}` && pillButtons === 2 && floating === 0 && mapWords === '',
        `move ${moved26.status()} · first ${firstOnToday} · map ${mapBox ? Math.round(mapBox.height) : '?'}px · colour ${swatch} · edge ${paint.hit} of ${paint.edges} in it · label "${label26}" · pill ${pillButtons} · floating ${floating} · words "${mapWords}"`)

      await page.locator(`[data-audit="ranch-map-place-button"][data-place="${p26.id}"]`).evaluate(el => (el as HTMLButtonElement).click())
      const sheet = page.locator('[data-audit="ranch-map-sheet"]')
      await sheet.waitFor({ timeout: 8_000 }).catch(() => {})
      const sBunch = ((await sheet.locator('[data-audit="sheet-bunch"]').first().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      const sDays = ((await sheet.locator('[data-audit="sheet-days"]').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      const sMoveHref = await sheet.locator('[data-audit="sheet-move"]').getAttribute('href').catch(() => null)
      const sAcres = ((await sheet.locator('[data-audit="sheet-acres"]').innerText().catch(() => '')) ?? '').trim()
      const sLatest = ((await sheet.locator('[data-audit="sheet-latest"]').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      const sRecord = await sheet.locator('[data-audit="record-here"]').count()
      record('26/30: the place sheet — name, acres, the bunch as name · class · head, "Moved in <date> · N days here" with the move itself, the latest entry with its age, and Record here',
        sBunch.includes(`${LOT26} · Heifers · 220 head`) && /Moved in /.test(sDays) && /3 days here/.test(sDays) && sMoveHref === `/ranch/activity/${mv26}` && /acres/i.test(sAcres) && /days ago|today|yesterday/.test(sLatest) && sRecord === 1,
        `"${sBunch}" · "${sDays}" · move ${sMoveHref === `/ranch/activity/${mv26}` ? 'linked' : sMoveHref} · ${sAcres} · "${sLatest.slice(0, 70)}" · record ${sRecord}`)
      // ── Block 30: Seen here ──────────────────────────────────────────────────
      // PK's rule: one tap records that the bunch was observed in that place,
      // by whom, when; the sheet then reads "Moved in <date> · seen <age> by
      // <name>"; a feeding or any other record never counts as a sighting;
      // confirming never changes where the bunch is.
      const placeBefore30 = ((await admin.from('herd_lots').select('place_id').eq('id', lot26).maybeSingle()).data as { place_id: string | null } | null)?.place_id ?? null
      const { count: movesBefore30 } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('type', 'cattle_moved').eq('payload->>herd_lot_id', lot26)
      await sheet.locator(`[data-audit="seen-here"][data-lot="${lot26}"]`).click({ timeout: 8_000 })
      const seenStates = await watchStates(page, 'Sent', 30_000, `Seen ${LOT26}`)
      const { data: seenRows } = await admin.from('events').select('id, user_id, created_at, payload').eq('type', 'bunch_seen').eq('payload->>herd_lot_id', lot26)
      const seenRow = ((seenRows ?? []) as { id: string; user_id: string; created_at: string; payload: Record<string, unknown> }[])[0] ?? null
      const placeAfter30 = ((await admin.from('herd_lots').select('place_id').eq('id', lot26).maybeSingle()).data as { place_id: string | null } | null)?.place_id ?? null
      const { count: movesAfter30 } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('type', 'cattle_moved').eq('payload->>herd_lot_id', lot26)
      record('30: one tap on Seen here records that THIS bunch was seen at THIS place, by this person, now — and the bunch\'s place is untouched, with no move written',
        seenStates.includes('Sent') && (seenRows ?? []).length === 1 && seenRow?.user_id === userId && seenRow?.payload.place_id === p26.id && Math.abs(Date.now() - Date.parse(seenRow?.created_at ?? '')) < 120_000 && placeAfter30 === placeBefore30 && placeAfter30 === p26.id && movesAfter30 === movesBefore30,
        `[${seenStates.join(' → ')}] · rows ${(seenRows ?? []).length} · by me ${seenRow?.user_id === userId} · at the pasture ${seenRow?.payload.place_id === p26.id} · place ${placeBefore30 === placeAfter30 ? 'unchanged' : `${placeBefore30} → ${placeAfter30}`} · moves ${movesBefore30} → ${movesAfter30}${rawSeen()}`)
      // The sheet now reads it — and a NEWER feeding at the place does not become the sighting.
      const fedLater = await page.request.post('/api/log', { data: { id: randomUUID(), type: 'hay_fed', bales: 2, herd_lot_id: lot26, place_id: p26.id } })
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="ranch-map"] .leaflet-overlay-pane canvas').first().waitFor({ timeout: 25_000 }).catch(() => {})
      await page.locator(`[data-audit="ranch-map-place-button"][data-place="${p26.id}"]`).evaluate(el => (el as HTMLButtonElement).click())
      await sheet.waitFor({ timeout: 8_000 }).catch(() => {})
      const line30 = ((await sheet.locator('[data-audit="sheet-days"]').first().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      const seenHref = await sheet.locator('[data-audit="sheet-seen"] a').first().getAttribute('href').catch(() => null)
      record('30: the sheet reads "Moved in <date> · N days here · seen <age> by <name>", the sighting linked — and a feeding recorded after it is not the sighting',
        fedLater.status() === 201 && /^Moved in /.test(line30) && /3 days here/.test(line30) && /seen today by /.test(line30) && seenHref === `/ranch/activity/${seenRow?.id}`,
        `feed ${fedLater.status()} · "${line30.slice(0, 110)}" · seen link ${seenHref === `/ranch/activity/${seenRow?.id}` ? 'the sighting' : seenHref}`)
      await page.mouse.click(10, 10).catch(() => {})
      await sheet.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
      await page.locator(`[data-audit="ranch-map-place-button"][data-place="${p26.id}"]`).evaluate(el => (el as HTMLButtonElement).click())
      await sheet.waitFor({ timeout: 8_000 }).catch(() => {})

      // Block 26c: the dim closes the sheet; no Close button exists.
      const closeButtons = await sheet.getByRole('button', { name: /^Close$/ }).count()
      await page.mouse.click(10, 10).catch(() => {})
      const dimClosed = await sheet.waitFor({ state: 'detached', timeout: 5_000 }).then(() => true).catch(() => false)
      record('26c: the place sheet has a grabber and no Close button, and a tap on the dim behind it dismisses it', closeButtons === 0 && dimClosed, `close buttons ${closeButtons} · dim closed ${dimClosed}`)
      // Full screen is a tap on open ground, and a tap takes it back.
      const container = page.locator('[data-audit="ranch-map"] .leaflet-container')
      const cb = await container.boundingBox()
      // Open ground: top-centre, above the framed place and clear of the zoom control (top-left), the pill (top-right) and the attribution (bottom-left).
      if (cb) { await page.mouse.click(cb.x + cb.width / 2, cb.y + 10); await page.waitForTimeout(700) }
      const fullNow = await page.evaluate(() => { const el = document.querySelector('[data-audit="ranch-map"] .leaflet-container'); if (!el) return false; const r = el.getBoundingClientRect(); return r.height > window.innerHeight * 0.85 })
      const cb2 = await container.boundingBox()
      if (cb2) { await page.mouse.click(cb2.x + cb2.width / 2, cb2.y + 10); await page.waitForTimeout(700) }
      const backNow = await page.evaluate(() => { const el = document.querySelector('[data-audit="ranch-map"] .leaflet-container'); if (!el) return false; const r = el.getBoundingClientRect(); return r.height < window.innerHeight * 0.6 })
      record('26c: full screen is a tap on the map — one tap on open ground fills the screen, another brings it back — with no button for it', fullNow && backNow, `full ${fullNow} · back ${backNow}`)
      // Unplaced: a bunch with no recorded place is listed, and its tap opens a move with it prefilled.
      const lotU = randomUUID(), LOTU = `${PREFIX} 26c unplaced`
      await admin.from('herd_lots').insert({ id: lotU, ranch_id: ranchId, class: 'cows', name: LOTU, head_count: 15, avg_weight: 1100, weight_unit: 'lb', created_by: userId, updated_by: userId })
      await admin.from('events').insert({ id: randomUUID(), user_id: userId, ranch_id: ranchId, type: 'head_count_set', ts: new Date().toISOString(), schema_version: 1, payload: { lot_id: lotU, reason: 'created', source: 'manual', head_after: 15, head_before: null, schema_version: 1 } })
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      const unplacedChip = page.locator(`[data-audit="ranch-map-unplaced-bunch"][data-lot="${lotU}"]`)
      const listed = await unplacedChip.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
      await unplacedChip.click().catch(() => {})
      const moveForm = await page.locator('[data-audit="lot-for-move"]').waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
      const moveLot = await page.locator('[data-audit="lot-for-move"]').inputValue().catch(() => '')
      record('26c: a bunch with no recorded place is listed under the map as Unplaced, and its tap opens a move with that bunch already picked', listed && moveForm && moveLot === lotU, `listed ${listed} · move form ${moveForm} · bunch picked ${moveLot === lotU}`)
      // Cancel, not Escape: a form with a bunch picked is a draft, and a draft left
      // behind reopens the sheet on every page after this (by design) — the first
      // 26c run left one and every later section found the sheet over the page.
      await page.getByRole('button', { name: 'Cancel' }).first().click().catch(() => {})
      await page.locator('[data-audit="record-sheet"]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})

      // A place the map cannot draw is a chip into the same sheet — never an invented position.
      const undrawnChip = page.locator('[data-audit="ranch-map-undrawn-chip"]').first()
      const undrawnName = ((await undrawnChip.innerText().catch(() => '')) ?? '').trim()
      await undrawnChip.click().catch(() => {})
      const undrawnSheet = ((await sheet.locator('[data-audit="sheet-place"]').innerText({ timeout: 5_000 }).catch(() => '')) ?? '').trim()
      record('26: a place with no shape and no position is a chip in the key, into the same sheet', !!undrawnName && undrawnSheet === undrawnName, `chip "${undrawnName}" → sheet "${undrawnSheet}"`)
      // Tidy with Escape, never a bare click at (10,10): with no sheet open that lands on the header's link and starts a navigation the next section runs into.
      await page.keyboard.press('Escape').catch(() => {})

      // Kill the tiles (the network the map needs): Today still paints, the polygons still draw, the tap still works.
      await page.route(/ibasemaps-api\.arcgis\.com|tile\.openstreetmap\.org/, r => r.abort())
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      const ledgersUp = await page.locator('main [role="tablist"][aria-label="Ledgers"]').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
      await page.locator('[data-audit="ranch-map"] .leaflet-overlay-pane canvas').first().waitFor({ timeout: 25_000 }).catch(() => {})
      await page.waitForTimeout(2500)
      const tilesShown = await page.locator('[data-audit="ranch-map"] img.leaflet-tile-loaded').count()
      await frame(p26.id)
      const paintOff = await outline(swatch, ring26)
      await page.locator(`[data-audit="ranch-map-place-button"][data-place="${p26.id}"]`).evaluate(el => (el as HTMLButtonElement).click()).catch(() => {})
      const tapOff = await sheet.waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)
      record('26 (ruling 4): with every tile refused, Today still paints, the polygons still draw on plain ground, and a tap still opens the place',
        ledgersUp && tilesShown === 0 && paintOff.edges >= 4 && paintOff.hit / paintOff.edges >= 0.6 && tapOff, `Today ${ledgersUp} · tiles ${tilesShown} · edge ${paintOff.hit} of ${paintOff.edges} in the bunch's colour · tap ${tapOff}`)
      await page.unroute(/ibasemaps-api\.arcgis\.com|tile\.openstreetmap\.org/)

      // ── Block 29: "N changes" steps the map through what B recorded ───────────
      // A sees B's changes. B moves lot26 to the empty pasture (a move with two
      // drawn ends), then feeds at 26 pasture; A opens Today: the stepper says
      // 2 changes, a step frames the ground, the move draws ONE straight line
      // (read off the canvas at its midpoint, absent off the line), the step
      // says who and when it was MADE; Reviewed clears the changes and the
      // Unplaced bunch — a problem — stays.
      await admin.from('ranch_members').update({ last_seen_at: new Date().toISOString() }).eq('user_id', userId).eq('ranch_id', ranchId)
      await page.waitForTimeout(1200)
      const mvB = randomUUID()
      const ctxB26 = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
      try {
        const pb = await signIn(ctxB26, EMAIL_B)
        const m = await pb.request.post('/api/log', { data: { id: mvB, type: 'cattle_moved', head: 220, herd_lot_id: lot26, from_place_id: p26.id, to_place_id: pEmpty!.id, place_id: pEmpty!.id } })
        const f = await pb.request.post('/api/log', { data: { id: randomUUID(), type: 'hay_fed', bales: 3, place_id: p26.id } })
        if (m.status() !== 201 || f.status() !== 201) throw new Error(`B could not record: move ${m.status()} feed ${f.status()}`)
      } finally { await ctxB26.close().catch(() => {}) }
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      const stepper = page.locator('[data-audit="changes-stepper"]')
      await stepper.waitFor({ timeout: 25_000 }).catch(() => {})
      const summary = ((await page.locator('[data-audit="changes-summary"]').innerText().catch(() => '')) ?? '').trim()
      const sinceRows = await page.locator('[data-audit="since-row"]').count()
      // Step until the move is the current change.
      let stepped = 0, onMove = false, madeText = '', whoLine = ''
      for (let i = 0; i < 6 && !onMove; i++) {
        await page.locator('[data-audit="changes-next"]').click({ timeout: 8_000 }).catch(() => {})
        await page.waitForTimeout(900); stepped++
        const id = await page.locator('[data-audit="changes-step"]').getAttribute('data-change').catch(() => null)
        if (id === mvB) { onMove = true; madeText = ((await page.locator('[data-audit="changes-made"]').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' '); whoLine = ((await page.locator('[data-audit="changes-step"] p').first().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ') }
      }
      // The line: its midpoint on the canvas carries the bunch's colour; a point well off the segment does not.
      const lineRead = await page.evaluate(`(() => {
        const c = document.querySelector('[data-audit="ranch-map"] .leaflet-container'); const map = c && c.__leafletMap; if (!map) return { mid: -1, off: -1 };
        const ring26 = ${JSON.stringify(ring26)};
        const canvases = Array.from(document.querySelectorAll('[data-audit="ranch-map"] .leaflet-overlay-pane canvas'));
        const box = c.getBoundingClientRect();
        const sample = (px, py, hex) => { const want = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]; for (const cv of canvases) { const r = cv.getBoundingClientRect(), ctx = cv.getContext('2d'); if (!ctx) continue; const sc = cv.width / r.width; const sx = Math.round((px - r.left) * sc) - 5, sy = Math.round((py - r.top) * sc) - 5; if (sx < 0 || sy < 0 || sx + 10 > cv.width || sy + 10 > cv.height) continue; const d = ctx.getImageData(sx, sy, 10, 10).data; for (let i = 0; i < d.length; i += 4) if (d[i+3] > 60 && Math.abs(d[i]-want[0]) < 30 && Math.abs(d[i+1]-want[1]) < 30 && Math.abs(d[i+2]-want[2]) < 30) return 1 } return 0 };
        const label = Array.from(document.querySelectorAll('.dryline-place-label span')).map(s => getComputedStyle(s).color)[0] || '';
        const m = label.match(/\\d+/g) || []; const hex = '#' + m.slice(0,3).map(n => Number(n).toString(16).padStart(2,'0')).join('');
        const centre = (pts) => ({ lat: (Math.min(...pts.map(p=>p[1])) + Math.max(...pts.map(p=>p[1]))) / 2, lng: (Math.min(...pts.map(p=>p[0])) + Math.max(...pts.map(p=>p[0]))) / 2 });
        const a = centre(ring26); const b = centre(${JSON.stringify(ringEmpty)});
        const pa = map.latLngToContainerPoint([a.lat, a.lng]), pb = map.latLngToContainerPoint([b.lat, b.lng]);
        const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }; const dx = pb.x - pa.x, dy = pb.y - pa.y; const len = Math.hypot(dx, dy) || 1;
        const off = { x: mid.x - dy / len * 40, y: mid.y + dx / len * 40 };
        return { hex, mid: sample(box.left + mid.x, box.top + mid.y, hex), off: sample(box.left + off.x, box.top + off.y, hex), len: Math.round(len) };
      })()`).catch(() => ({ mid: -1, off: -1, hex: '', len: 0 })) as { mid: number; off: number; hex: string; len: number }
      record('29: "N changes" counts what the card counts; stepping to the move frames the ground, draws one straight line from where they were to where they went (its midpoint painted, off the line not), and says who and when it was made',
        /^2 changes/.test(summary) && sinceRows === 2 && onMove && lineRead.mid === 1 && lineRead.off === 0 && lineRead.len > 40 && /made /.test(madeText) && /moved/.test(whoLine),
        `summary "${summary}" · card rows ${sinceRows} · stepped ${stepped} onto the move ${onMove} · line ${lineRead.hex} mid ${lineRead.mid} off ${lineRead.off} len ${lineRead.len}px · "${whoLine.slice(0, 60)}" · "${madeText.slice(0, 50)}"`)
      // Seen ≠ handled: Reviewed clears the changes; the Unplaced bunch stays, in the colour reserved for a problem.
      await page.locator('[data-audit="changes-next"]').click({ timeout: 5_000 }).catch(() => {})
      await page.waitForTimeout(600)
      const unplacedBefore = await page.locator('[data-audit="ranch-map-unplaced-bunch"][data-problem="unplaced"]').count()
      await page.locator('[data-audit="changes-stepper"] [data-audit="mark-reviewed"], [data-audit="mark-reviewed"]').first().click({ timeout: 8_000 }).catch(() => {})
      await page.waitForTimeout(1500)
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="ranch-map"]').waitFor({ timeout: 20_000 }).catch(() => {})
      const stepperAfter = await page.locator('[data-audit="changes-stepper"]').count()
      const unplacedAfter = await page.locator('[data-audit="ranch-map-unplaced-bunch"][data-problem="unplaced"]').count()
      record('29: seen and handled are different — Reviewed clears the changes, and the bunch with no recorded place stays listed as a problem', unplacedBefore >= 1 && stepperAfter === 0 && unplacedAfter === unplacedBefore, `unplaced ${unplacedBefore} → ${unplacedAfter} · stepper after review ${stepperAfter}`)
      // Tidy with Escape, never a bare click at (10,10): with no sheet open that lands on the header's link and starts a navigation the next section runs into.
      await page.keyboard.press('Escape').catch(() => {})
    })

    // ── Block 27 — a record carries the moment it was made on the phone ──────
    // PK's falsifier: record a feeding offline at 10:00, reconnect at 16:00. It
    // orders and reads as 10:00. The phone's clock is the page's clock (a fixed
    // fake time; timers keep running), the server's is real.
    await section('Block 27 — a record carries the moment it was made on the phone', async () => {
      const probe073 = await admin.from('events').select('created_at').limit(1)
      if (probe073.error && /created_at/.test(probe073.error.message)) {
        record('27: CAPABILITY GAP — migration 073 is not applied on this database; nothing below can be read', false, probe073.error.message.slice(0, 80))
        return
      }
      // Its OWN BROWSER CONTEXT, signed in on its own: Playwright's fake clock is
      // context-wide and cannot be handed back to real time, and a frozen
      // Date.now() left every later section's outbox waiting on a hold that
      // never elapsed — the first two runs showed it, on a page and then on a
      // fresh page of the same context. The context dies with the section.
      const main = page
      const ctx27 = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
      page = await signIn(ctx27)
      // What the page did while the check watched: navigations, loads, errors — so a vanished receipt names its cause.
      const t27 = Date.now(); const nav27: string[] = []
      page.on('framenavigated', f => { if (f === page.mainFrame()) nav27.push(`nav ${f.url().replace(BASE, '').slice(0, 40)} @${Date.now() - t27}`) })
      page.on('load', () => nav27.push(`load @${Date.now() - t27}`))
      page.on('console', m => { if (m.type() === 'error') nav27.push(`console: ${m.text().slice(0, 90)}`) })
      page.on('pageerror', e => nav27.push(`pageerror: ${e.message.slice(0, 90)}`))
      try {
      const today = ranchDay()
      const tenAM = new Date(`${today}T10:00:00-06:00`), fourPM = new Date(`${today}T16:00:00-06:00`)
      // The clock is fixed BEFORE the page opens: a receipt strip remembers when its view
      // opened and calls anything synced before that history, so a view opened at real
      // time and a sync stamped at a frozen 4 PM would never meet (32's third loop).
      await page.clock.setFixedTime(tenAM)
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await page.locator('#ledger-hay').waitFor({ timeout: 20_000 }).catch(() => {})
      await ctx27.setOffline(true)
      await logFeed(page, 7)
      const off27 = await watchStates(page, 'Sent', 4_000, 'Fed 7 bales')
      const queued = (await outbox(page)).find(i => (i.body as { bales?: number }).bales === 7)
      const madeOnPhone = typeof queued?.body.created_at === 'string' ? new Date(queued.body.created_at as string) : null
      await page.clock.setFixedTime(fourPM)
      await ctx27.setOffline(false)
      const on27 = await watchStates(page, 'Sent', 45_000, 'Fed 7 bales')
      const { data: row27 } = queued ? await admin.from('events').select('id, ts, created_at, ingested_at').eq('id', queued.id).maybeSingle() : { data: null }
      const r27 = row27 as { id: string; ts: string; created_at: string; ingested_at: string } | null
      const minutesOff = (a: string | Date | null | undefined, b: Date) => a ? Math.abs(new Date(a).getTime() - b.getTime()) / 60_000 : Infinity
      record('27: made offline at 10:00, sent at 16:00 — the record says made 10:00 and happened 10:00; arrival is 16:00\'s business, kept apart',
        off27[0] === 'Saved' && !off27.includes('Sent') && on27.includes('Sent') && !!r27 && minutesOff(madeOnPhone, tenAM) < 1 && minutesOff(r27.created_at, tenAM) < 1 && minutesOff(r27.ts, tenAM) < 1 && minutesOff(r27.ingested_at, new Date()) < 10,
        `queued made ${madeOnPhone?.toISOString() ?? 'none'} · row made ${r27?.created_at ?? '?'} · happened ${r27?.ts ?? '?'} · arrived ${r27?.ingested_at ?? '?'}${rawSeen()} · page: [${nav27.join(' | ').slice(0, 500)}]`)

      // It ORDERS as 10:00: newer than a 09:00 record another hand made and sent at once, older than a 12:00 one.
      const mk = async (hour: number) => { const id = randomUUID(); const t = new Date(`${today}T${String(hour).padStart(2, '0')}:00:00-06:00`).toISOString(); await admin.from('events').insert({ id, user_id: userIdB, ranch_id: ranchId, type: 'hay_fed', ts: t, created_at: t, schema_version: 1, payload: { source: 'manual', schema_version: 1, bales: hour, herd_lot_id: null, place_id: placeId } }); return id }
      const nine = await mk(9), noon = await mk(12)
      // The record is paged (50 a page); by now the ranch has more rows than
      // one page, so the three are read across pages in list order.
      const ids: string[] = []
      await page.goto(`/ranch/activity?from=${today}&to=${today}`, { waitUntil: 'domcontentloaded' })   // today's rows only: the three are today's
      for (let pg = 0; pg < 4; pg++) {
        ids.push(...await page.locator('li[data-id]').evaluateAll(els => els.map(e => e.getAttribute('data-id') ?? '')))
        const next = page.locator('a[href*="cursor="]').first()
        if (!(await next.count())) break
        // A client-side page turn: wait for the LIST to change, not for a load event that already fired.
        const firstBefore = ids[ids.length - 50] ?? ids[0]
        await next.click()
        await page.waitForFunction((was: string) => document.querySelector('li[data-id]')?.getAttribute('data-id') !== was, firstBefore, { timeout: 10_000 }).catch(() => {})
        await page.waitForTimeout(300)
      }
      const order = [noon, queued?.id ?? '', nine].map(id => ids.indexOf(id))
      record('27: on the record it sits between a 09:00 and a 12:00 entry — ordered by when it was made, not when it arrived', order.every(i => i >= 0) && order[0] < order[1] && order[1] < order[2], `positions noon ${order[0]} · ours ${order[1]} · nine ${order[2]}`)

      // And it READS as 10:00: the entry page says Recorded 10:00, and does not call it back-dated.
      await page.goto(`/ranch/activity/${queued?.id}`, { waitUntil: 'domcontentloaded' })
      const recorded = ((await page.locator('[data-audit="event-recorded"]').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      const backdatedNote = await page.locator('[data-audit="event-backdated"]').count()
      const reached = await page.locator('[data-audit="event-reached-the-ranch"]').count()
      record('27: the entry reads Recorded 10:00, is not called back-dated, and arrival gets no line of its own on the same day', /10:00/.test(recorded) && backdatedNote === 0 && reached === 0, `recorded "${recorded}" · back-dated note ${backdatedNote} · reached line ${reached}`)

      // ── Block 29: seen is exact. A's phone runs 40 minutes AHEAD of the server
      // and records a feeding; B opens Today, sees it, taps Reviewed. Before
      // 29 the record's made-at (A's clock) was later than B's seen-at (the
      // server's) and it stayed "new" forever. Now Reviewed sends the newest
      // made-at it showed and the cursor is stamped no earlier than that.
      await page.clock.setFixedTime(new Date(Date.now() + 40 * 60_000))
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await logFeed(page, 11)
      // A fixed clock is FROZEN: the outbox's hold never elapses unless the clock is moved past it.
      await page.clock.setFixedTime(new Date(Date.now() + 40 * 60_000 + 20_000))
      const states11 = await watchStates(page, 'Sent', 45_000, 'Fed 11 bales')
      const { data: row11 } = await admin.from('events').select('id, created_at, ts').eq('user_id', userId).eq('type', 'hay_fed').eq('payload->>bales', '11').order('ingested_at', { ascending: false }).limit(1).maybeSingle()
      const r11 = row11 as { id: string; created_at: string; ts: string } | null
      const ctxB29 = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
      try {
        const pb = await signIn(ctxB29, EMAIL_B)
        await pb.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        const sawIt = await pb.locator('[data-audit="since-row"]').filter({ hasText: 'fed 11 bales' }).waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
        // What Reviewed sends: the newest made-at it was shown.
        let sent: string | null = null
        await pb.route('**/api/seen', async (route) => { try { sent = (JSON.parse(route.request().postData() ?? '{}') as { through?: string }).through ?? null } catch { sent = null }; await route.continue() })
        // By now the card holds more than its five, so Reviewed lives on the last page of View all (6H) — the path a person takes.
        if (!(await pb.locator('[data-audit="mark-reviewed"]').count())) {
          await pb.locator('[data-audit="since-view-all"]').click({ timeout: 10_000 }).catch(() => {})
          // The tap resolves before the navigation does, and Today has rows of its own — wait for View all itself.
          await pb.waitForURL(/\/ranch\/activity\?since=/, { timeout: 15_000 }).catch(() => {})
          for (let pg = 0; pg < 6; pg++) {
            await pb.locator('li[data-id], [data-audit="mark-reviewed"]').first().waitFor({ timeout: 15_000 }).catch(() => {})
            const next = pb.locator('a[href*="cursor="]').first()
            if (!(await next.count())) break
            // The pager's own href, opened directly: what matters here is Reviewed on the last
            // page, and a tap on a link at the foot of a 50-row page turned nothing in four loops.
            const href = await next.getAttribute('href')
            if (!href) break
            await pb.goto(href, { waitUntil: 'domcontentloaded' })
          }
        }
        let why29 = ''
        await pb.locator('[data-audit="mark-reviewed"]').first().click({ timeout: 10_000 }).catch(e => { why29 = (e instanceof Error ? e.message : String(e)).split('\n').filter(l => /Timeout|intercept|waiting for|not visible|detached/.test(l)).slice(0, 2).join(' · ').slice(0, 220) })
        const where29 = `${pb.url().replace(BASE, '')} · Reviewed buttons ${await pb.locator('[data-audit="mark-reviewed"]').count()} · rows ${await pb.locator('li[data-id]').count()} · next links ${await pb.locator('a[href*="cursor="]').count()} · last-page note ${await pb.locator('[data-audit="review-on-last-page"]').count()}${why29 ? ` · click: ${why29}` : ''}`
        await pb.waitForTimeout(1500)
        await pb.unroute('**/api/seen')
        await pb.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await pb.locator('[data-audit="since-empty"], [data-audit="since-row"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
        const rowsAfter = await pb.locator('[data-audit="since-row"]').count()
        const quiet = await pb.locator('[data-audit="since-empty"]').count()
        const { data: seenRow } = await admin.from('ranch_members').select('last_seen_at').eq('user_id', userIdB).eq('ranch_id', ranchId).maybeSingle()
        const seenAt = (seenRow as { last_seen_at?: string } | null)?.last_seen_at ?? ''
        record('29: seen is exact — a record made on a phone 40 minutes ahead is new until Reviewed, and Reviewed sends the newest made-at it showed and clears it',
          sawIt && !!sent && Date.parse(sent) > Date.now() + 30 * 60_000 && Date.parse(seenAt) >= Date.parse(sent) && rowsAfter === 0 && quiet === 1,
          `A's record [${states11.join(' → ')}] landed ${r11 ? `made ${r11.created_at}` : 'NO'} · saw it ${sawIt} · sent ${sent ?? 'nothing'} · stored ${seenAt} · rows after ${rowsAfter} · quiet ${quiet} · [${where29}]${rawSeen()}`)
      } finally { await ctxB29.close().catch(() => {}) }
      } finally { await ctx27.close().catch(() => {}); page = main }
    })

    // ── Block 28 — a place history points at is never hard-deleted ────────────
    // PK's falsifier: move a bunch to a place, delete the place. The move still
    // reads its name (marked removed), the bunch reads no place recorded, and
    // restore brings both back. Then the part only the database can prove: the
    // purge, run past its window, keeps the place and takes an empty one.
    await section('Block 28 — a place history points at is never hard-deleted', async () => {
      const probe074 = await admin.rpc('place_is_referenced', { p_place: '00000000-0000-0000-0000-000000000000' })
      if (probe074.error?.code === '42883') { record('28: CAPABILITY GAP — migration 074 is not applied on this database; nothing below can be read', false, ''); return }
      const lot28 = randomUUID(), LOT28 = `${PREFIX} 28 bunch`
      await admin.from('herd_lots').insert({ id: lot28, ranch_id: ranchId, class: 'cows', name: LOT28, head_count: 30, avg_weight: 1100, weight_unit: 'lb', created_by: userId, updated_by: userId })
      await admin.from('events').insert({ id: randomUUID(), user_id: userId, ranch_id: ranchId, type: 'head_count_set', ts: new Date().toISOString(), schema_version: 1, payload: { lot_id: lot28, reason: 'created', source: 'manual', head_after: 30, head_before: null, schema_version: 1 } })
      const { data: p28 } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} 28 pasture`, kind: 'pasture' }).select('id').single()
      const { data: pEmpty } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} 28 empty`, kind: 'pasture' }).select('id').single()
      const mv28 = randomUUID()
      const moved = await page.request.post('/api/log', { data: { id: mv28, type: 'cattle_moved', head: 30, herd_lot_id: lot28, to_place_id: p28!.id, place_id: p28!.id } })
      const placeOf = async () => ((await admin.from('herd_lots').select('place_id').eq('id', lot28).maybeSingle()).data as { place_id: string | null } | null)?.place_id ?? null
      const before = await placeOf()
      const del = await page.request.delete(`/api/places/${p28!.id}`)
      const afterDelete = await placeOf()
      await page.goto(`/ranch/activity/${mv28}`, { waitUntil: 'domcontentloaded' })
      const what = (await page.locator('[data-audit="event-what"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      const row = ((await page.locator('[data-audit="lot-row"]').filter({ hasText: LOT28 }).locator('[data-audit="lot-where"]').innerText().catch(() => '')) ?? '').trim()
      const inPickers = await page.request.get('/api/places').then(r => r.json()).then((j: { places?: { id: string }[] }) => (j.places ?? []).some(p => p.id === p28!.id)).catch(() => true)
      record('28: delete a place a move points at — the move still reads its name marked in trash, the bunch reads no place recorded, and the place is off the pickers',
        moved.status() === 201 && before === p28!.id && del.status() === 200 && afterDelete === null && what.includes(`${PREFIX} 28 pasture (in trash)`) && row === NO_PLACE_RECORDED && !inPickers,
        `move ${moved.status()} · delete ${del.status()} · bunch ${before === p28!.id ? 'at it' : before} → ${afterDelete ?? 'no place'} · "${what.slice(0, 90)}" · row "${row}" · in pickers ${inPickers}`)

      // The purge, past its window: the referenced place is kept, the empty one goes.
      await admin.from('places').update({ deleted_at: new Date(Date.now() - 9 * 86_400_000).toISOString() }).in('id', [p28!.id, pEmpty!.id])
      const purged = await admin.rpc('purge_trash', { p_days: 7 })
      const stillThere = (await admin.from('places').select('id, deleted_at').eq('id', p28!.id).maybeSingle()).data as { id: string; deleted_at: string | null } | null
      const emptyGone = ((await admin.from('places').select('id').eq('id', pEmpty!.id)).data ?? []).length === 0
      const hard = await admin.from('places').delete().eq('id', p28!.id).select('id')
      record('28: the purge past its window keeps the place history points at and takes the empty one; a direct hard delete is refused and it stays in the trash',
        !purged.error && !!stillThere?.deleted_at && emptyGone && (hard.data ?? []).length === 0 && !!((await admin.from('places').select('deleted_at').eq('id', p28!.id).maybeSingle()).data as { deleted_at: string | null } | null)?.deleted_at,
        `purge ${purged.error ? purged.error.message : JSON.stringify(purged.data)} · kept ${!!stillThere} · empty gone ${emptyGone} · hard delete removed ${(hard.data ?? []).length}`)

      // Restore brings both back.
      const restored = await page.request.post('/api/trash', { data: { table: 'places', id: p28!.id } })
      const afterRestore = await placeOf()
      await page.goto(`/ranch/activity/${mv28}`, { waitUntil: 'domcontentloaded' })
      const whatBack = (await page.locator('[data-audit="event-what"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      record('28: restore from the trash brings the place back with its history — the bunch is there again and the move reads its name plain',
        restored.status() === 200 && afterRestore === p28!.id && whatBack.includes(`${PREFIX} 28 pasture`) && !/in trash/.test(whatBack),
        `restore ${restored.status()} · bunch → ${afterRestore === p28!.id ? 'at it' : afterRestore ?? 'no place'} · "${whatBack.slice(0, 90)}"`)
    })

    // ── Block 38 — Record loses the map (reverses Block 20, ruling 1) ─────────
    // PK's falsifier: location and network off, open Record. Every action is on
    // one screen with no scrolling, and a feeding saves to the outbox with the
    // right place — the bunch's (Block 33). Block 20's ruling 3 stands exactly:
    // no fix, no tiles, no signal, every action still opens and saves. And with
    // a fix inside a pasture, an action tapped first still takes that ground.
    await section('Block 38 — Record loses the map', async () => {
      const ring20 = [[-110.06, 46.93], [-110.04, 46.93], [-110.04, 46.92], [-110.06, 46.92], [-110.06, 46.93]]
      const { data: p20 } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} 38 pasture`, kind: 'pasture', geometry: { type: 'Polygon', coordinates: [ring20] }, acres: 380 }).select('id').single()
      // A bunch that lives there, placed by a move through the route (072 decides the place).
      const lot38 = randomUUID(); const name38 = `${PREFIX} 38 bunch`
      await admin.from('herd_lots').insert({ id: lot38, ranch_id: ranchId, class: 'cows', name: name38, head_count: 44, avg_weight: 1100, weight_unit: 'lb', created_by: userId, updated_by: userId })
      await admin.from('events').insert({ id: randomUUID(), user_id: userId, ranch_id: ranchId, type: 'head_count_set', ts: new Date(Date.now() - 2 * 86_400_000).toISOString(), schema_version: 1, payload: { lot_id: lot38, reason: 'created', source: 'manual', head_count: 44 } })
      const mv38 = await page.request.post('/api/log', { data: { id: randomUUID(), type: 'cattle_moved', head: 44, herd_lot_id: lot38, to_place_id: p20!.id, place_id: p20!.id, ts: new Date(Date.now() - 86_400_000).toISOString() } })
      if (!mv38.ok()) throw new Error(`38 move: ${mv38.status()}`)
      // Online once first, so the phone has seen the ranch (the copy that names places when there is no signal).
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await recordControl(page).click()
      await page.locator('[data-audit="record-picker"]').waitFor({ timeout: 20_000 }).catch(() => {})
      const cached = await page.waitForFunction((pid: string) => { try { return (localStorage.getItem('dryline_ranch_map_v1') ?? '').includes(pid) } catch { return false } }, p20!.id as string, { timeout: 15_000 }).then(() => true).catch(() => false)
      // The bunches too: the sheet's own copy, so Fed-to can name the bunch with no signal.
      await page.locator('[data-audit="tile-hay_fed"]').click()
      await page.locator('[data-audit="fed-to"]').waitFor({ timeout: 15_000 }).catch(() => {})
      await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {})
      await page.keyboard.press('Escape').catch(() => {})
      // Location AND network off.
      await page.context().setGeolocation(null).catch(() => {})
      await page.context().setOffline(true)
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await recordControl(page).click()
      const picker = page.locator('[data-audit="record-picker"]')
      await picker.waitFor({ timeout: 15_000 }).catch(() => {})
      const tiles = await page.locator('[data-audit="record-actions"] button').count()
      const rare = await page.locator('[data-audit="record-rare"] button').count()
      const maps = await page.locator('[data-audit="record-picker"] .leaflet-container, [data-audit="record-place-chips"]').count()
      // One screen, no scrolling: the sheet's panel holds everything without a scrollbar, and the row sits inside the viewport.
      const fits = await page.locator('[data-audit="record-sheet"]').first().evaluate(el => { const panel = el.querySelector('[data-audit="bottom-sheet"]') ?? el; return { scroll: panel.scrollHeight, client: panel.clientHeight } }).catch(() => ({ scroll: -1, client: -1 }))
      // The sheet slides in; measure once it has settled, not mid-slide.
      await page.waitForTimeout(700)
      const rowBox = await page.locator('[data-audit="record-actions"]').boundingBox().catch(() => null)
      const vh = page.viewportSize()?.height ?? 0
      const oneScreen = fits.scroll > 0 && fits.scroll <= fits.client + 1 && !!rowBox && rowBox.y >= 0 && rowBox.y + rowBox.height <= vh
      // Feed: the bunch answers Where (Block 33), with no signal.
      await page.locator('[data-audit="tile-hay_fed"]').click()
      await page.locator('[data-audit="fed-to"]').waitFor({ timeout: 15_000 }).catch(() => {})
      await selectBunch(page, '[data-audit="fed-to"]', name38).catch(() => {})
      const selectShows = async (id: string) => page.waitForFunction((want: string) => (document.querySelector('form [data-audit="place-select"]') as HTMLSelectElement | null)?.value === want, id, { timeout: 10_000 }).then(() => true).catch(() => false)
      const whereOff = (await selectShows(p20!.id)) ? p20!.id : await page.locator('form [data-audit="place-select"]').first().inputValue().catch(() => '')
      await page.getByLabel('Hay fed').fill('4')
      await page.getByRole('button', { name: 'Record feeding', exact: true }).click()
      const off20 = await watchStates(page, 'Sent', 4_000, 'Fed 4 bales')
      const queued20 = (await outbox(page)).find(i => (i.body as { bales?: number }).bales === 4 && (i.body as { place_id?: string }).place_id === p20!.id)
      record('38: location and network off — Record opens straight to the actions, every one on one screen with no scrolling and no map, and a feeding saves to the outbox with the bunch\'s place',
        cached && tiles === 6 && rare === 3 && maps === 0 && oneScreen && whereOff === p20!.id && off20[0] === 'Saved' && !off20.includes('Sent') && !!queued20,
        `cached ${cached} · tiles ${tiles} · rare ${rare} · maps ${maps} · one screen ${oneScreen} (panel ${fits.scroll}/${fits.client}, row bottom ${rowBox ? Math.round(rowBox.y + rowBox.height) : '?'} of ${vh}) · where ${whereOff === p20!.id ? 'the bunch\'s place' : whereOff || 'blank'} · [${off20.join(' → ')}] · queued with the place ${!!queued20}${rawSeen()}`)
      await page.context().setOffline(false)
      await watchStates(page, 'Sent', 45_000, 'Fed 4 bales')

      // With a fix inside the pasture: Rain (no bunch to answer) tapped first takes the ground under the fix.
      await page.context().grantPermissions(['geolocation'], { origin: BASE }).catch(() => {})
      await page.context().setGeolocation({ latitude: 46.925, longitude: -110.05, accuracy: 5 })
      await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
      await recordControl(page).click()
      await page.locator('[data-audit="record-picker"][data-fix="yes"]').waitFor({ timeout: 15_000 }).catch(() => {})
      const under = await page.locator('[data-audit="record-picker"]').getAttribute('data-under-fix').catch(() => '')
      await page.locator('[data-audit="tile-rain"]').click()
      const chosen = (await selectShows(p20!.id)) ? p20!.id : await page.locator('form [data-audit="place-select"]').first().inputValue().catch(() => '')
      record('38: with a fix inside a pasture, an action tapped first still takes the ground under the fix (Block 20, ruling 2 kept)', under === p20!.id && chosen === p20!.id, `under fix ${under === p20!.id ? 'the pasture' : under || 'none'} · form place ${chosen === p20!.id ? 'the pasture' : chosen || 'blank'}`)
      await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {})
      await page.context().setGeolocation(null).catch(() => {})
    })

    // ── Block 31 — a new rancher can create their ranch ───────────────────────
    // PK's falsifier: sign up a brand-new account. You see only the setup screen.
    // Name the ranch, pick a county, and you land on Today with an empty ranch
    // you own. Try again with the same account: refused. Its own browser
    // context: a different person.
    await section('Block 31 — a new rancher can create their ranch', async () => {
      const EMAIL_C = 'smoke-daily-loop-new@dryline.farm'
      const { data: cu } = await admin.auth.admin.createUser({ email: EMAIL_C, email_confirm: true, user_metadata: { smoke: true } })
      const ctxC = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
      try {
        const pc = await signIn(ctxC, EMAIL_C)
        const landed = async () => { await pc.waitForTimeout(1500); return pc.url().replace(BASE, '').split('?')[0] }
        // Ranch screens all send a ranchless person to the one setup screen.
        const seen: string[] = []
        for (const path of ['/today', '/ranch/activity', '/account', '/ranch/cattle']) { await pc.goto(path, { waitUntil: 'domcontentloaded' }); seen.push(await landed()) }
        const h1 = ((await pc.locator('main h1').first().innerText().catch(() => '')) ?? '').trim()
        const controls = await pc.locator('[data-audit="setup-form"] button:not([data-audit="setup-county-option"]), [data-audit="setup-form"] input').count()
        record('31: signed in with no ranch, every ranch screen is the one setup screen — "Name your ranch", the county, one button, nothing else',
          seen.every(p => p === '/setup') && h1 === 'Name your ranch' && controls === 3, `${seen.join(' ')} · h1 "${h1}" · controls ${controls}`)
        await pc.locator('[data-audit="setup-name"]').fill(`${PREFIX} New ranch`)
        await pc.locator('[data-audit="setup-county-search"]').fill('Fergus')
        await pc.locator('[data-audit="setup-county-option"][data-fips="30027"]').click({ timeout: 10_000 }).catch(() => {})
        await pc.locator('[data-audit="setup-save"]').click()
        await pc.waitForURL(u => u.pathname === '/today', { timeout: 30_000 }).catch(() => {})
        const err = ((await pc.locator('[data-audit="setup-error"]').innerText().catch(() => '')) ?? '').trim()
        const { data: cm } = await admin.from('ranch_members').select('ranch_id, role').eq('user_id', cu!.user!.id)
        const { data: cr } = cm?.[0] ? await admin.from('ranches').select('name, home_county_fips').eq('id', cm[0].ranch_id).maybeSingle() : { data: null }
        await pc.locator('header [data-audit="account-button"]').waitFor({ timeout: 20_000 }).catch(() => {})
        const headerText = ((await pc.locator('main').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
        record('31: name it, pick a county, and you land on Today with an empty ranch you own — county set on the ranch',
          pc.url().replace(BASE, '').startsWith('/today') && (cm ?? []).length === 1 && cm![0].role === 'owner' && (cr as { name?: string; home_county_fips?: string } | null)?.name === `${PREFIX} New ranch` && (cr as { home_county_fips?: string } | null)?.home_county_fips === '30027' && headerText.includes(`${PREFIX} New ranch`),
          `${pc.url().replace(BASE, '')} · ${err ? `error "${err}"` : ''} memberships ${(cm ?? []).length} · role ${cm?.[0]?.role} · ranch "${(cr as { name?: string } | null)?.name}" county ${(cr as { home_county_fips?: string } | null)?.home_county_fips}`)
        // Again with the same account: the screen is gone (Today), and the door refuses.
        await pc.goto('/setup', { waitUntil: 'domcontentloaded' })
        const backTo = await landed()
        const twice = await pc.request.post('/api/setup', { data: { name: 'Second', county_fips: null } })
        const twiceJson = (await twice.json().catch(() => ({}))) as { code?: string }
        const { count: still } = await admin.from('ranch_members').select('ranch_id', { count: 'exact', head: true }).eq('user_id', cu!.user!.id)
        record('31: try it again with the same account — /setup goes to Today, and the door refuses; still one ranch', backTo === '/today' && twice.status() === 409 && twiceJson.code === 'already_on_a_ranch' && still === 1, `/setup → ${backTo} · again ${twice.status()} ${twiceJson.code ?? ''} · memberships ${still}`)
      } finally {
        await ctxC.close().catch(() => {})
      }
    })

    // ── Block 23 — the hold menu, the Undo nobody may cover, and the receipt ──
    // PK's falsifier: do a split at 390 and at 320. The receipt is one readable
    // line, Undo is tappable without scrolling or dismissing anything, and the
    // pill is nowhere near it.
    await section('Block 23 — the hold menu, the Undo nobody may cover, and the receipt', async () => {
      const lot23 = randomUUID(), LOT23 = `${PREFIX} 23 receipt bunch`
      const { error: e23 } = await admin.from('herd_lots').insert({ id: lot23, ranch_id: ranchId, class: 'cows', name: LOT23, head_count: 220, avg_weight: 1100, weight_unit: 'lb', created_by: userId, updated_by: userId })
      if (e23) skip('23: hold menu and receipt checks', `fixture: ${e23.message.slice(0, 80)}`)
      else {
        await admin.from('events').insert({ id: randomUUID(), user_id: userId, ranch_id: ranchId, type: 'head_count_set', ts: new Date().toISOString(), schema_version: 1, payload: { lot_id: lot23, reason: 'created', source: 'manual', head_after: 220, head_before: null, schema_version: 1 } })
        const prior = page.viewportSize()

        // Ruling 1 — Open is off the bunch's hold menu, and the rest is still there.
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
        const row23 = page.locator(`[data-audit="lot-row"]#lot-${lot23}`)
        await row23.waitFor({ timeout: 20_000 }).catch(() => {})
        const heldOpen = await hold(page, row23)
        const opens = await page.locator('[data-audit="row-action-open"]').count()
        const fixes = await page.locator('[data-audit="row-action-fix"]').count()
        const splits = await page.locator('[data-audit="row-action-extra"]', { hasText: 'Split' }).count()
        record('23 (ruling 1): a bunch\'s hold menu offers nothing that does nothing — Open is gone, Fix and Split remain',
          heldOpen && opens === 0 && fixes === 1 && splits === 1, `Open ${opens} · Fix ${fixes} · Split ${splits}`)

        // Ruling 2 — an Undo owns the bottom of the screen: delete a bunch and
        // check that nothing floating is drawn over the Undo button.
        await page.keyboard.press('Escape').catch(() => {})
        await page.locator('[data-audit="row-actions-sheet"]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {})
        const del23 = randomUUID(), DEL23 = `${PREFIX} 23 delete me`
        await admin.from('herd_lots').insert({ id: del23, ranch_id: ranchId, class: 'cows', name: DEL23, head_count: 4, avg_weight: null, weight_unit: 'lb', created_by: userId, updated_by: userId })
        await page.reload({ waitUntil: 'domcontentloaded' })
        const delRow = page.locator(`[data-audit="lot-row"]#lot-${del23}`)
        await delRow.waitFor({ timeout: 20_000 }).catch(() => {})
        await hold(page, delRow)
        await page.locator('[data-audit="row-action-delete"]').click().catch(() => {})
        await page.locator('[data-audit="undo-button"]').waitFor({ timeout: 15_000 }).catch(() => {})
        const covered = await page.evaluate(() => {
          const btn = document.querySelector('[data-audit="undo-button"]')
          if (!btn) return { found: false, coveredBy: 'no undo button at all', pill: 0 }
          const r = btn.getBoundingClientRect()
          // What does the browser say is on top at the middle of the Undo?
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          const inside = !!at && btn.contains(at)
          const owner = at?.closest('[data-audit]')?.getAttribute('data-audit') ?? at?.tagName ?? 'nothing'
          return { found: true, coveredBy: inside ? '' : owner, pill: document.querySelectorAll('[data-audit="record-fab"]').length }
        })
        // The receipt yields by going INVISIBLE, never by unmounting: it starts a
        // clock when it mounts and calls anything synced before that history, so
        // tearing it down for an Undo's ten seconds silently ate the receipt for
        // anything that landed in them.
        const yielded = await page.evaluate(() => {
          const strip = document.querySelector('[data-audit="global-save-status"]')
          return { mounted: !!strip, yielded: strip?.getAttribute('data-yielded') === 'true', box: strip ? strip.getBoundingClientRect().height : 0 }
        })
        record('23 (ruling 2): nothing is drawn over an Undo — the record pill yields, the receipt hides without being torn down, and the Undo answers its own taps',
          covered.found && covered.coveredBy === '' && covered.pill === 0 && yielded.mounted && yielded.yielded,
          `undo present ${covered.found} · the tap would hit ${covered.coveredBy || 'the Undo button'} · pills on screen ${covered.pill} · receipt still mounted ${yielded.mounted}, yielded ${yielded.yielded}`)
        await page.locator('[data-audit="undo-button"]').click().catch(() => {})
        await page.waitForTimeout(1_500)
        await admin.from('herd_lots').delete().eq('id', del23)

        // Rulings 3 and 4 — split the bunch and read the receipt, at both widths.
        if (!(await probe071(page, ranchId, userId))) skip('23 (rulings 3 + 4): the receipt after a split is one readable line with Undo, at 390 and at 320', 'migration 071 not run on this database')
        else {
          const seen: string[] = []
          let ok = true
          for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 })
            await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
            const r = page.locator(`[data-audit="lot-row"]#lot-${lot23}`)
            await r.waitFor({ timeout: 20_000 }).catch(() => {})
            await hold(page, r)
            await page.locator('[data-audit="row-action-extra"]', { hasText: 'Split' }).first().click().catch(() => {})
            await page.locator('[data-audit="split-lot-choice"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
            await page.getByLabel('How many leave').fill('22')
            await page.locator('[data-audit="split-name"]').fill(`${PREFIX} 23 off ${width}`)
            await page.getByRole('button', { name: 'Record the split', exact: true }).click().catch(() => {})
            await watchStates(page, 'Sent', 45_000, `23 off ${width}`)
            await page.locator('[data-audit="save-receipt"][data-compact="true"]').waitFor({ timeout: 20_000 }).catch(() => {})
            const shape = await page.evaluate(() => {
              const box = document.querySelector('[data-audit="save-receipt"][data-compact="true"]')
              const balance = box?.querySelector('[data-audit="receipt-balance"]') as HTMLElement | null
              const undo = document.querySelector('[data-audit="take-back"], [data-audit="undo-this"]') as HTMLElement | null
              if (!box || !balance) return { line: '', px: 0, extras: -1, undoReachable: false, undoInView: false, pill: 1 }
              const cs = getComputedStyle(balance)
              const extras = box.querySelectorAll('[data-audit="receipt-label"], [data-audit="receipt-detail"], [data-audit="receipt-open-entry"]').length
              let undoReachable = false, undoInView = false
              if (undo) {
                const u = undo.getBoundingClientRect()
                undoInView = u.top >= 0 && u.bottom <= window.innerHeight && u.width > 0
                const at = document.elementFromPoint(u.left + u.width / 2, u.top + u.height / 2)
                undoReachable = !!at && undo.contains(at)
              }
              return { line: (balance.textContent ?? '').trim(), px: parseFloat(cs.fontSize), extras, undoReachable, undoInView, pill: document.querySelectorAll('[data-audit="record-fab"]').length }
            })
            seen.push(`${width}px: "${shape.line}" ${shape.px}px · extras ${shape.extras} · undo reachable ${shape.undoReachable}/in view ${shape.undoInView}`)
            if (!/^220 → 198, 22 to /.test(shape.line) || shape.px < 20 || shape.extras !== 0 || !shape.undoReachable || !shape.undoInView) ok = false
            const { data: made } = await admin.from('herd_lots').select('id').eq('ranch_id', ranchId).like('name', `${PREFIX} 23 off ${width}%`)
            for (const m of (made ?? []) as { id: string }[]) await admin.from('herd_lots').delete().eq('id', m.id)
            await admin.from('herd_lots').update({ head_count: 220 }).eq('id', lot23)
          }
          record('23 (rulings 3 + 4): the receipt after a split is ONE readable line with a reachable Undo, at 390 and at 320',
            ok, seen.join(' | '))
          // EVERY painted save word, wherever it is shown, read off the painted
          // page — so a transform counts as changing it, which is what "SENT"
          // did, hiding a landed split behind a stuck-looking strip for three
          // runs. `data-save-word` marks each place one is drawn.
          const words = await page.locator('[data-save-word]').evaluateAll(els =>
            els.map(e => ({ text: (e as HTMLElement).innerText.trim(), transform: getComputedStyle(e).textTransform })))
          const FOUR = ['Saved', 'Waiting for signal', 'Sent', "Couldn't send"]
          const wrong = words.filter(w => !FOUR.includes(w.text) || w.transform !== 'none')
          record('23: every painted save word is one of the four, exactly as written — no shouting, no transform',
            words.length > 0 && wrong.length === 0,
            `${words.length} painted · ${wrong.length === 0 ? 'all four, untransformed' : wrong.map(w => `"${w.text}" (${w.transform})`).join(', ')}`)
        }
        if (prior) await page.setViewportSize(prior)
        await admin.from('events').delete().eq('ranch_id', ranchId).eq('payload->>lot_id', lot23)
        await admin.from('herd_lots').delete().eq('id', lot23)
      }
    })

    // ── Block 22 — the tally at a gate ──────────────────────────────────────
    // PK's falsifier: start a count from the 220 and tap PAST it. The screen
    // keeps counting and shows the overage; it does not refuse, cap or warn.
    // Durability and the sacrifice order are proved exactly in
    // scripts/tally-harness.ts; this is the screen and the endings.
    {
      const lot22 = randomUUID(), LOT22 = `${PREFIX} 22 gate bunch`
      const { error: e22 } = await admin.from('herd_lots').insert({ id: lot22, ranch_id: ranchId, class: 'heifers', name: LOT22, head_count: 220, avg_weight: 700, weight_unit: 'lb', created_by: userId, updated_by: userId })
      if (e22) skip('22: tally checks', `fixture: ${e22.message.slice(0, 80)}`)
      else {
        await admin.from('events').insert({ id: randomUUID(), user_id: userId, ranch_id: ranchId, type: 'head_count_set', ts: new Date().toISOString(), schema_version: 1, payload: { lot_id: lot22, reason: 'created', source: 'manual', head_after: 220, head_before: null, schema_version: 1 } })
        const prior = page.viewportSize()
        await page.setViewportSize({ width: 390, height: 844 })

        await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
        const row22 = page.locator(`[data-audit="lot-row"]#lot-${lot22}`)
        await row22.waitFor({ timeout: 20_000 }).catch(() => {})
        await hold(page, row22)
        const countBtn = page.locator('[data-audit="row-action-extra"]', { hasText: 'Count at a gate' })
        const hasCount = await countBtn.count()
        await countBtn.first().click().catch(() => {})
        await page.locator('[data-audit="tally-begin"]').waitFor({ timeout: 20_000 }).catch(() => {})
        const haptics = (await page.locator('[data-audit="tally-haptics"]').innerText().catch(() => '')).trim()
        const subject = (await page.locator('[data-audit="tally-subject"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        await page.locator('[data-audit="tally-begin"]').click().catch(() => {})
        await page.locator('[data-audit="tally-plus-1"]').waitFor({ timeout: 15_000 }).catch(() => {})
        record('22: counting is on the bunch\'s own hold gesture, and the phone says what a tap will feel like before the gate, not during it',
          hasCount === 1 && /^Buzz: /.test(haptics) && subject.includes('22 gate bunch'),
          `Count on the row ${hasCount} · "${haptics}" · "${subject.slice(0, 60)}"`)

        const tap = async (n: number, times: number) => { for (let i = 0; i < times; i++) { await page.locator(`[data-audit="tally-plus-${n}"]`).click(); await page.waitForTimeout(35) } }
        await tap(4, 11); await tap(3, 1)                       // 47
        const at47 = (await page.locator('[data-audit="tally-total"]').innerText().catch(() => '')).trim()
        const against47 = (await page.locator('[data-audit="tally-against"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        const onScreen = await page.evaluate(() => {
          const box = document.querySelector('[data-audit="tally-counting"]')
          if (!box) return { words: '', extras: -1 }
          const allowed = new Set(['tally-line', 'tally-change', 'tally-change-bunch', 'tally-change-from', 'tally-change-to', 'tally-total', 'tally-against', 'tally-undo', 'tally-plus-1', 'tally-plus-2', 'tally-plus-3', 'tally-plus-4', 'tally-leave', 'tally-finish-open', 'tally-removed', 'tally-wake'])
          const extras = Array.from(box.querySelectorAll('p, button, span')).filter(e => {
            const r = e.getBoundingClientRect()
            if (r.height === 0 || !(e.textContent ?? '').trim()) return false
            if (e.closest('[data-audit="tally-leave-guard"]')) return false
            const a = e.closest('[data-audit]')?.getAttribute('data-audit') ?? ''
            return !allowed.has(a)
          })
          return { words: extras.map(e => (e.textContent ?? '').trim().slice(0, 40)).join(' | '), extras: extras.length }
        })
        // A wake note is allowed above, and checked here instead: it may only
        // ever appear when a lock that WAS held has been taken back. A headless
        // browser never grants one, so the count screen must be silent about it.
        const wakeOnCount = await page.locator('[data-audit="tally-wake"]').count()
        record('22 (ruling 7 + doctrine): at 47 the screen shows the total, what is left of the 220, the four and Undo — and nothing else',
          at47 === '47' && against47 === '47 through · 173 left of 220' && onScreen.extras === 0 && wakeOnCount === 0,
          `total "${at47}" · "${against47}" · anything else on screen: ${onScreen.extras === 0 ? 'nothing' : onScreen.words}${wakeOnCount ? ` · a wake note on a lock that was never held` : ''}`)

        await tap(4, 44)                                        // 47 + 176 = 223
        const past = (await page.locator('[data-audit="tally-total"]').innerText().catch(() => '')).trim()
        const overLine = (await page.locator('[data-audit="tally-against"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        const stillTappable = await page.locator('[data-audit="tally-plus-4"]').isEnabled().catch(() => false)
        const body22 = (await page.locator('[data-audit="tally-counting"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
        record('22 THE FALSIFIER: a count started from the 220 taps past it — it keeps counting, shows the overage, and does not refuse, cap or warn',
          past === '223' && overLine === '223 through · 3 more than the 220 on the record' && stillTappable && !/too many|cannot|error|warning/i.test(body22),
          `total "${past}" · "${overLine}" · buttons still live ${stillTappable}`)

        await page.locator('[data-audit="tally-undo"]').click().catch(() => {})
        const removed = (await page.locator('[data-audit="tally-removed"]').innerText().catch(() => '')).trim()
        const afterUndo = (await page.locator('[data-audit="tally-total"]').innerText().catch(() => '')).trim()
        record('22 (ruling 4): Undo removes the last tap, not the last head, and says which',
          removed === 'Removed +4' && afterUndo === '219', `"${removed}" · total now ${afterUndo}`)

        await page.locator('[data-audit="tally-finish-open"]').click().catch(() => {})
        await page.locator('[data-audit="tally-ending-set_head"]').waitFor({ timeout: 15_000 }).catch(() => {})
        await page.locator('[data-audit="tally-ending-set_head"]').click().catch(() => {})
        const ctx22 = page.context()
        await ctx22.setOffline(true)
        await page.locator('[data-audit="tally-save"]').click().catch(() => {})
        const offSeq = await watchStates(page, 'Sent', 6_000, '219 head')
        await ctx22.setOffline(false)
        const onSeq = await watchStates(page, 'Sent', 45_000, '219 head')
        const { data: after22 } = await admin.from('herd_lots').select('head_count').eq('id', lot22).maybeSingle()
        const head22 = (after22 as { head_count?: number } | null)?.head_count
        const { data: ev22 } = await admin.from('events').select('type, payload').eq('ranch_id', ranchId).in('type', ['cattle_counted', 'head_count_set']).order('ts', { ascending: false }).limit(3)
        const kinds = ((ev22 ?? []) as { type: string; payload: Record<string, unknown> }[])
        const counted = kinds.find(k => k.type === 'cattle_counted')
        const setRow = kinds.find(k => k.type === 'head_count_set' && k.payload.head_after === 219)
        record('22 (ruling 6): a count taken with no signal still sets the bunch — it waits in the outbox and lands as a count AND a head-count row, with no second tap',
          offSeq[0] === 'Saved' && !offSeq.includes('Sent') && onSeq.includes('Sent') && head22 === 219
          && counted?.payload.set_head === true && counted?.payload.counted === 219 && setRow?.payload.head_before === 220,
          `offline ${offSeq.join(' → ')} · online ${onSeq.join(' → ')} · bunch ${head22} · count row ${counted ? 'yes' : 'no'} · head row ${setRow ? `${setRow.payload.head_before}→${setRow.payload.head_after}` : 'no'}`)

        const line22 = (await page.locator('[data-audit="receipt-balance"]').first().innerText().catch(() => '')).trim()
        record('22 + 23: the receipt for a count that set the bunch is one line in the same shape a split uses',
          line22 === '220 → 219', `"${line22}"`)

        if (prior) await page.setViewportSize(prior)
        await admin.from('events').delete().eq('ranch_id', ranchId).eq('payload->>lot_id', lot22)
        await admin.from('events').delete().eq('ranch_id', ranchId).eq('payload->>herd_lot_id', lot22)
        await admin.from('herd_lots').delete().eq('id', lot22)
      }
    }

    // ── Block 13 — one gesture, everywhere: fix or delete anything ──────────
    // Every row type: hold → the sheet; Fix does something or says why not;
    // Delete goes to the trash with no confirm; Undo puts it back; anything
    // attached survives and still names the deleted thing.
    await section('Block 13 — one gesture, everywhere: fix or delete anything', async () => {
      // Fixtures: a place with a feeding at it and a device on it, a session, a
      // county on the watchlist, an open invitation. B is already a member.
      const { data: p13 } = await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} 13 corral`, kind: 'yard' }).select('id').single()
      const place13 = String((p13 as { id?: string } | null)?.id ?? '')
      const { data: e13 } = await admin.from('events').insert({ user_id: userId, ranch_id: ranchId, type: 'rain', ts: new Date().toISOString(), payload: { source: 'manual', schema_version: 1, place_id: place13, inches: 0.13 } }).select('id').single()
      const entry13 = String((e13 as { id?: string } | null)?.id ?? '')
      const { data: d13 } = await admin.from('devices').insert({ user_id: userId, ranch_id: ranchId, hardware_id: `${PREFIX}-13-hw`, type: 'spotter', name: `${PREFIX} 13 gauge`, place_id: place13 }).select('id').single()
      const device13 = String((d13 as { id?: string } | null)?.id ?? '')
      const job13 = randomUUID()
      const j13 = await admin.from('jobs').insert({ id: job13, user_id: userId, ranch_id: ranchId, device_id: null, hardware_id: 'smoke-scout-13', started_at: new Date(Date.now() - 5 * 3_600_000).toISOString(), ended_at: new Date(Date.now() - 4 * 3_600_000).toISOString(), duration_s: 3600, seq_start: 1, seq_end: 100, event_count: 100, evicted_count: 0, coverage: 1, centroid_lat: 46.94, centroid_lng: -108.19, bbox: {}, track: [], pauses: [], multi_field: false, stats: {}, deriver_version: 'smoke', derived_at: new Date().toISOString() })
      if (!j13.error) await admin.from('job_annotations').insert({ job_id: job13, user_id: userId, ranch_id: ranchId, name: '13 baling', machine: 'baler' })
      const { data: county } = await admin.from('counties').select('id').eq('fips', HOME_FIPS).maybeSingle()
      const countyId = Number((county as { id?: number } | null)?.id ?? 0)
      await page.request.post('/api/watchlist', { data: { countyId } }).catch(() => null)
      const inv = await page.request.post('/api/invitations', { data: { email: 'smoke-13-invite@dryline.farm', role: 'member' } }).catch(() => null)
      const invId = String(((await inv?.json().catch(() => ({}))) as { invite?: { id?: string } })?.invite?.id ?? '')

      // 1 · Activity entry: Fix opens the correction form; Delete → trash → Undo.
      await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      const entryRow = page.locator(`li[data-id="${entry13}"] [data-audit="row-actions"]`).first()
      const rowThere13 = await entryRow.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
      const where13 = `${page.url().replace(BASE, '')} · row ${rowThere13} · rows ${await page.locator('li[data-id]').count()}`
      const s1 = await hold(page, entryRow)
      await sheet(page).fix.click().catch(() => {})
      const fixOpen1 = await page.locator('[data-audit="correction-reason"], [data-audit="correct-form"]').first().waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
      record('13 (entry): hold → Fix lands in the correction form', s1 && fixOpen1 && /#correct$/.test(page.url()), `sheet ${s1} · form ${fixOpen1} · ${page.url().replace(BASE, '')} · [after goto: ${where13}]`)
      await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      await entryRow.waitFor({ timeout: 20_000 }).catch(() => {})
      const s1b = await hold(page, entryRow)
      await sheet(page).del.click().catch(() => {})
      await undoStrip(page).waitFor({ timeout: 8_000 }).catch(() => {})
      const { data: trashed1 } = await admin.from('events').select('deleted_at').eq('id', entry13).maybeSingle()
      const undone1 = await pressUndo(page)
      const { data: back1 } = await admin.from('events').select('deleted_at').eq('id', entry13).maybeSingle()
      record('13 (entry): hold → Delete goes to the trash with no confirm; Undo puts it back',
        s1b && !!(trashed1 as { deleted_at?: string | null } | null)?.deleted_at && undone1 && (back1 as { deleted_at?: string | null } | null)?.deleted_at === null,
        `sheet ${s1b} · trashed ${!!(trashed1 as { deleted_at?: string | null } | null)?.deleted_at} · undo ${undone1} · back ${(back1 as { deleted_at?: string | null } | null)?.deleted_at === null}`)

      // 2 · Place: Fix opens the form; Delete with things attached — the entry
      // and the device survive and still name it; Undo puts it back.
      await page.goto('/ranch/places', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="place-group-open"][data-group="yards"]').click({ timeout: 10_000 }).catch(() => {})   // Block 43: the corral is under Yards
      const placeRow = page.locator(`a[data-audit="place-row"][data-id="${place13}"]`).first()
      await placeRow.waitFor({ timeout: 20_000 }).catch(() => {})
      const s2 = await hold(page, placeRow)
      await sheet(page).fix.click().catch(() => {})
      const fixOpen2 = await page.locator('[data-audit="place-edit"]').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
      const pinSwitch = await page.locator('[data-audit="place-edit-pinned"] input').count()
      record('13 (place): hold → Fix opens the place form with name, kind, where it sits, and Show on Weather', s2 && fixOpen2 && pinSwitch === 1, `sheet ${s2} · form ${fixOpen2} · Weather switch ${pinSwitch}`)
      await page.goto('/ranch/places', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="place-group-open"][data-group="yards"]').click({ timeout: 10_000 }).catch(() => {})   // Block 43: the group closes again on a fresh load
      await placeRow.waitFor({ timeout: 20_000 }).catch(() => {})
      const s2b = await hold(page, placeRow)
      await sheet(page).del.click().catch(() => {})
      await undoStrip(page).waitFor({ timeout: 8_000 }).catch(() => {})
      const noConfirm = (await page.locator('[data-audit="place-confirm-delete"], [data-audit="place-referenced"]').count()) === 0
      const { data: ev2 } = await admin.from('events').select('payload, deleted_at').eq('id', entry13).maybeSingle()
      const { data: dv2 } = await admin.from('devices').select('place_id, deleted_at').eq('id', device13).maybeSingle()
      const entryKept = (ev2 as { payload?: { place_id?: string }; deleted_at?: string | null } | null)?.payload?.place_id === place13 && (ev2 as { deleted_at?: string | null } | null)?.deleted_at === null
      const deviceKept = (dv2 as { place_id?: string | null; deleted_at?: string | null } | null)?.place_id === place13 && (dv2 as { deleted_at?: string | null } | null)?.deleted_at === null
      const look2 = await page.context().newPage()
      await look2.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      await look2.locator('[data-audit="activity-list"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const namesGone = await look2.locator(`li[data-id="${entry13}"]`).innerText().catch(() => '')
      await look2.close()
      const undone2 = await pressUndo(page)
      const { data: back2 } = await admin.from('places').select('deleted_at').eq('id', place13).maybeSingle()
      record('13 (place): hold → Delete with an entry and a device attached — no confirm, both survive and still name it, the entry shows it as deleted; Undo puts it back',
        s2b && noConfirm && entryKept && deviceKept && /\(in trash\)/.test(namesGone) && undone2 && (back2 as { deleted_at?: string | null } | null)?.deleted_at === null,
        `sheet ${s2b} · no confirm ${noConfirm} · entry kept ${entryKept} · device kept ${deviceKept} · row "${namesGone.slice(0, 60)}" · undo ${undone2}`)

      // 3 · Device: Fix edits name and where it sits, and says what the device sets itself; Delete → Undo.
      await page.goto('/ranch/devices', { waitUntil: 'domcontentloaded' })
      const deviceCard = page.locator(`li#${device13.replace(/^(\d)/, '\\$1')} [data-audit="row-actions"]`).first()
      const deviceCardAlt = page.locator('[data-audit="device-card"]').filter({ hasText: '13 gauge' }).first()
      const devRow = (await deviceCard.count()) ? deviceCard : deviceCardAlt
      await devRow.waitFor({ timeout: 20_000 }).catch(() => {})
      const s3 = await hold(page, devRow)
      await sheet(page).fix.click().catch(() => {})
      const fixOpen3 = await page.locator('[data-audit="device-fix"]').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
      const fixedFacts = (await page.locator('[data-audit="device-fix-fixed"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await page.locator('[data-audit="device-fix-name"]').fill(`${PREFIX} 13 gauge renamed`).catch(() => {})
      await page.locator('[data-audit="device-fix-save"]').click().catch(() => {})
      await page.waitForTimeout(2_500)
      const { data: dn } = await admin.from('devices').select('name').eq('id', device13).maybeSingle()
      record('13 (device): hold → Fix edits the name and where it sits, names what the device sets itself as facts, and saves',
        s3 && fixOpen3 && /Hardware ID/.test(fixedFacts) && /Battery/.test(fixedFacts) && (dn as { name?: string } | null)?.name === `${PREFIX} 13 gauge renamed`,
        `sheet ${s3} · form ${fixOpen3} · facts "${fixedFacts.slice(0, 50)}" · saved name "${String((dn as { name?: string } | null)?.name)}"`)
      await page.goto('/ranch/devices', { waitUntil: 'domcontentloaded' })
      const devRow2 = page.locator('[data-audit="device-card"]').filter({ hasText: '13 gauge' }).first()
      await devRow2.waitFor({ timeout: 20_000 }).catch(() => {})
      const s3b = await hold(page, devRow2)
      await sheet(page).del.click().catch(() => {})
      await undoStrip(page).waitFor({ timeout: 8_000 }).catch(() => {})
      const { data: dt } = await admin.from('devices').select('deleted_at').eq('id', device13).maybeSingle()
      const undone3 = await pressUndo(page)
      const { data: db3 } = await admin.from('devices').select('deleted_at').eq('id', device13).maybeSingle()
      record('13 (device): hold → Delete goes to the trash with no confirm; Undo puts it back',
        s3b && !!(dt as { deleted_at?: string | null } | null)?.deleted_at && undone3 && (db3 as { deleted_at?: string | null } | null)?.deleted_at === null,
        `sheet ${s3b} · trashed ${!!(dt as { deleted_at?: string | null } | null)?.deleted_at} · undo ${undone3}`)

      // 4 · Machine session: Fix opens the name form on its page; Delete → trash → Undo.
      if (j13.error) skip('13 (session): hold → Fix / Delete / Undo', `fixture: ${j13.error.message.slice(0, 80)}`)
      else {
        await page.goto('/ranch/work', { waitUntil: 'domcontentloaded' })
        const workRow = page.locator(`li[data-id="${job13}"] [data-audit="row-actions"]`).first()
        await workRow.waitFor({ timeout: 20_000 }).catch(() => {})
        const s4 = await hold(page, workRow)
        await sheet(page).fix.click().catch(() => {})
        const fixOpen4 = await page.locator('[data-audit="job-fix"]').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
        const chips4 = await page.locator('[data-audit="job-fix"] button').count()
        record('13 (session): hold → Fix lands on the session with its name form open', s4 && fixOpen4 && /#fix$/.test(page.url()) && chips4 >= 2, `sheet ${s4} · form ${fixOpen4} · chips ${chips4} · ${page.url().replace(BASE, '')}`)
        await page.goto('/ranch/work', { waitUntil: 'domcontentloaded' })
        await workRow.waitFor({ timeout: 20_000 }).catch(() => {})
        const s4b = await hold(page, workRow)
        await sheet(page).del.click().catch(() => {})
        await undoStrip(page).waitFor({ timeout: 8_000 }).catch(() => {})
        const { data: ja } = await admin.from('job_annotations').select('dismissed_at').eq('job_id', job13).maybeSingle()
        const inTrash4 = ((await (await page.request.get('/api/trash')).json().catch(() => ({}))) as { items?: { id: string; table: string }[] }).items?.some(i => i.id === job13 && i.table === 'jobs') ?? false
        const undone4 = await pressUndo(page)
        const { data: jb } = await admin.from('job_annotations').select('dismissed_at').eq('job_id', job13).maybeSingle()
        record('13 (session): hold → Delete goes to the trash (listed there as a session); Undo puts it back',
          s4b && !!(ja as { dismissed_at?: string | null } | null)?.dismissed_at && inTrash4 && undone4 && (jb as { dismissed_at?: string | null } | null)?.dismissed_at === null,
          `sheet ${s4b} · deleted ${!!(ja as { dismissed_at?: string | null } | null)?.dismissed_at} · in trash ${inTrash4} · undo ${undone4}`)
      }

      // 5 · Weather rain-place row: Fix opens the place form; no Unpin/Delete links on the row.
      await page.goto('/weather', { waitUntil: 'domcontentloaded' })
      const rainRow = page.locator(`[data-audit="rain-place-row"][data-place="${place13}"] [data-audit="row-actions"]`).first()
      const rainRowThere = await rainRow.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
      const oldLinks = await page.locator('[data-audit="weather-place-actions"]').count()
      const s5 = rainRowThere ? await hold(page, rainRow) : false
      await sheet(page).fix.click().catch(() => {})
      const fixOpen5 = await page.locator('[data-audit="place-edit"]').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
      record('13 (rain place): the Unpin and Delete links are gone from the row; hold → Fix opens the place form', rainRowThere ? (oldLinks === 0 && s5 && fixOpen5) : oldLinks === 0, rainRowThere ? `old links ${oldLinks} · sheet ${s5} · form ${fixOpen5}` : `row not on Weather (no reading, not pinned) · old links ${oldLinks}`)

      // 6 · County on the watchlist: nothing to fix (the sentence), home is an action, Delete → Undo.
      await page.goto('/weather/locations', { waitUntil: 'domcontentloaded' })
      const countyRow = page.locator(`[data-audit="county-row"][data-fips="${HOME_FIPS}"] [data-audit="row-actions"]`).first()
      const countyThere = await countyRow.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
      const s6 = countyThere ? await hold(page, countyRow) : false
      const noFix6 = (await sheet(page).fix.count()) === 0
      const note6 = (await sheet(page).fixNote.innerText().catch(() => '')).replace(/\s+/g, ' ')
      const home6 = await sheet(page).extra.filter({ hasText: /home county/ }).count()
      await sheet(page).del.click().catch(() => {})
      await undoStrip(page).waitFor({ timeout: 8_000 }).catch(() => {})
      await page.waitForTimeout(800)
      const rowsGone6 = (await page.locator(`[data-audit="county-row"][data-fips="${HOME_FIPS}"]`).count()) === 0
      const undone6 = await pressUndo(page)
      await page.waitForTimeout(1_500)
      const rowsBack6 = (await page.locator(`[data-audit="county-row"][data-fips="${HOME_FIPS}"]`).count()) === 1
      record('13 (county): hold → no Fix button, the sentence instead, home county as an action; Delete takes it off the list; Undo puts it back',
        countyThere && s6 && noFix6 && /nothing to fix/i.test(note6) && home6 === 1 && rowsGone6 && undone6 && rowsBack6,
        `there ${countyThere} · sheet ${s6} · no fix ${noFix6} · "${note6.slice(0, 40)}" · home action ${home6} · gone ${rowsGone6} · undo ${undone6} · back ${rowsBack6}`)

      // 7 · People: a person's Fix is their role; Delete removes → Undo re-adds. An invitation has nothing to fix; Delete → Undo.
      await page.goto('/account', { waitUntil: 'domcontentloaded' })
      const memberRow = page.locator(`[data-audit="member-row"][data-user="${userIdB}"] [data-audit="row-actions"]`).first()
      const memberThere = await memberRow.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
      const s7 = memberThere ? await hold(page, memberRow) : false
      const fixLabel7 = (await sheet(page).fix.innerText().catch(() => '')).replace(/\s+/g, ' ')
      // The one delete that is not the trash says so on the sheet, before the tap.
      const warn7 = (await page.locator('[data-audit="row-actions-sheet"] [data-audit="row-action-delete-warning"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
      await sheet(page).del.click().catch(() => {})
      await undoStrip(page).waitFor({ timeout: 8_000 }).catch(() => {})
      const { count: goneB } = await admin.from('ranch_members').select('user_id', { count: 'exact', head: true }).eq('ranch_id', ranchId).eq('user_id', userIdB)
      const undone7 = await pressUndo(page)
      await page.waitForTimeout(1_000)
      const { data: backB } = await admin.from('ranch_members').select('role').eq('ranch_id', ranchId).eq('user_id', userIdB).maybeSingle()
      record('13 (person): hold → Fix is the role; the sheet says before the tap that removing is for good after ten seconds; Delete removes them with no confirm; Undo puts them back as a member',
        memberThere && s7 && /Make .* an owner/.test(fixLabel7) && /for good after ten seconds/.test(warn7) && /new invitation/.test(warn7) && goneB === 0 && undone7 && (backB as { role?: string } | null)?.role === 'member',
        `there ${memberThere} · sheet ${s7} · fix "${fixLabel7}" · warning "${warn7.slice(0, 50)}" · removed ${goneB === 0} · undo ${undone7} · role back ${String((backB as { role?: string } | null)?.role)}`)
      if (invId) {
        await page.goto('/account', { waitUntil: 'domcontentloaded' })
        const inviteRow = page.locator(`[data-audit="invite-row"][data-id="${invId}"] [data-audit="row-actions"]`).first()
        const inviteThere = await inviteRow.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
        const s7b = inviteThere ? await hold(page, inviteRow) : false
        const noFix7 = (await sheet(page).fix.count()) === 0 && (await sheet(page).fixNote.count()) === 1
        await sheet(page).del.click().catch(() => {})
        await undoStrip(page).waitFor({ timeout: 8_000 }).catch(() => {})
        const { data: rv } = await admin.from('invitations').select('revoked_at').eq('id', invId).maybeSingle()
        const undone7b = await pressUndo(page)
        const { data: rb } = await admin.from('invitations').select('revoked_at').eq('id', invId).maybeSingle()
        record('13 (invitation): hold → nothing to fix (the sentence); Delete cancels it; Undo brings it back',
          inviteThere && s7b && noFix7 && !!(rv as { revoked_at?: string | null } | null)?.revoked_at && undone7b && (rb as { revoked_at?: string | null } | null)?.revoked_at === null,
          `there ${inviteThere} · sheet ${s7b} · note ${noFix7} · cancelled ${!!(rv as { revoked_at?: string | null } | null)?.revoked_at} · undo ${undone7b}`)
      } else skip('13 (invitation): hold → Delete → Undo', 'could not create an invitation fixture')

      // 8 · Never a dead end: a row that was replaced shows the sentence, not a button.
      await page.goto('/ranch/activity', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-audit="activity-list"]').first().waitFor({ timeout: 20_000 }).catch(() => {})
      const replacedRow = page.locator('li[data-marker="replaced"] [data-audit="row-actions"]').first()
      const replacedThere = (await replacedRow.count()) > 0
      const s8 = replacedThere ? await hold(page, replacedRow) : false
      const note8 = (await sheet(page).fixNote.innerText().catch(() => '')).replace(/\s+/g, ' ')
      const btn8 = await sheet(page).fix.count()
      const greyed8 = await page.locator('[data-audit="row-actions-sheet"] button[disabled]').count()
      await sheet(page).cancel.click().catch(() => {})
      record('13 (no dead end): a replaced entry offers no Fix button — one plain sentence instead, and nothing greyed out',
        replacedThere && s8 && btn8 === 0 && /already replaced/i.test(note8) && greyed8 === 0,
        replacedThere ? `sheet ${s8} · fix buttons ${btn8} · "${note8.slice(0, 60)}" · greyed ${greyed8}` : 'no replaced row on this ranch')

      // 9 · iOS: a hold never starts the phone's own menu — the row turns the
      // link callout and text selection off. Measured on the painted row; the
      // callout itself only exists in WebKit, so its rule is read from the
      // style the row carries, and PK reproduces the hold on the phone.
      const iosGuard = await page.evaluate(() => {
        const el = document.querySelector('[data-audit="row-actions"]') as HTMLElement | null
        if (!el) return { userSelect: 'none-found', callout: 'none-found' }
        const cs = getComputedStyle(el)
        return { userSelect: cs.userSelect || (cs as unknown as { webkitUserSelect?: string }).webkitUserSelect || '', callout: el.style.getPropertyValue('-webkit-touch-callout') || (el.getAttribute('class') ?? '').includes('touch-callout:none') ? 'none' : '' }
      })
      record('13 (iOS): a held row carries user-select: none and -webkit-touch-callout: none, so a hold never opens the link callout or selects text',
        iosGuard.userSelect === 'none' && iosGuard.callout === 'none', `user-select ${iosGuard.userSelect} · touch-callout ${iosGuard.callout}`)

      // 10 · Trash: hold → Put it back (the list check for this is 12.4, above). Nothing here deletes sooner: the sheet says so.
      await page.request.delete(`/api/places/${place13}`).catch(() => null)
      await page.goto('/account/trash', { waitUntil: 'domcontentloaded' })
      const trashRow13 = page.locator(`[data-audit="trash-row"][data-id="${place13}"]`)
      const trashThere = await trashRow13.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
      const s10 = trashThere ? await hold(page, trashRow13) : false
      const putBack10 = await sheet(page).extra.filter({ hasText: 'Put it back' }).count()
      const noDelete10 = (await sheet(page).del.count()) === 0 && /for good/i.test((await sheet(page).deleteNote.innerText().catch(() => '')))
      await sheet(page).extra.filter({ hasText: 'Put it back' }).first().click().catch(() => {})
      await page.waitForTimeout(2_000)
      const { data: back10 } = await admin.from('places').select('deleted_at').eq('id', place13).maybeSingle()
      record('13 (trash): hold a trash row → Put it back, and no Delete — the sheet says when it goes for good',
        trashThere && s10 && putBack10 === 1 && noDelete10 && (back10 as { deleted_at?: string | null } | null)?.deleted_at === null,
        `there ${trashThere} · sheet ${s10} · put back ${putBack10} · no delete ${noDelete10} · restored ${(back10 as { deleted_at?: string | null } | null)?.deleted_at === null}`)

      // Fixtures out (teardown also sweeps by user).
      await page.request.delete('/api/watchlist', { data: { countyId } }).catch(() => null)
      if (invId) await admin.from('invitations').delete().eq('id', invId)
      await admin.from('job_annotations').delete().eq('job_id', job13); await admin.from('jobs').delete().eq('id', job13)
      await admin.from('devices').delete().eq('id', device13)
      await admin.from('events').delete().eq('id', entry13)
      await admin.from('places').delete().eq('id', place13)
    })

    // ── Block 14 — Count cattle: tap the bunch, the number, save ──────────────
    await section('Block 14 — Count cattle: tap the bunch, the number, save', async () => {
      const text = async (sel: string) => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      const headOf = async (id: string) => ((await admin.from('herd_lots').select('head_count').eq('id', id).maybeSingle()).data as { head_count?: number } | null)?.head_count ?? null
      const lot14 = randomUUID(), LOT14 = `${PREFIX} 14 count bunch`
      const { error: l14 } = await admin.from('herd_lots').insert({ id: lot14, ranch_id: ranchId, class: 'cows', name: LOT14, head_count: 275, avg_weight: 1200, weight_unit: 'lb', created_by: userId, updated_by: userId })
      if (l14) skip('14: count checks', `fixture: ${l14.message.slice(0, 80)}`)
      else if (!(await probe069(ranchId, userId))) { skip('14: count and new-bunch checks', 'migration 069 not applied on this database'); await admin.from('herd_lots').delete().eq('id', lot14) }
      else {
        const navs14: string[] = [], errs14: string[] = []
        const onNav = (f: { url: () => string; parentFrame: () => unknown }) => { if (!f.parentFrame()) navs14.push(f.url().replace(BASE, '').slice(0, 60)) }
        const onErr = (m: { type: () => string; text: () => string }) => { if (m.type() === 'error') errs14.push(m.text().slice(0, 100)) }
        page.on('framenavigated', onNav); page.on('console', onErr); page.on('pageerror', e => errs14.push(`pageerror ${e.message.slice(0, 100)}`))
        await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        const countOnce = async (n: number) => {
          await recordControl(page).click()
          await page.locator('[data-audit="tile-cattle_counted"]').waitFor({ timeout: 15_000 })
          await page.locator('[data-audit="tile-cattle_counted"]').click()
          const opt = page.locator(`[data-audit="count-bunch-option"][data-lot="${lot14}"]`)
          await opt.waitFor({ state: 'attached', timeout: 15_000 })
          try { await opt.click({ timeout: 15_000 }) } catch (e) {
            // What was it, when it could not be tapped? Said in the death, not guessed at afterwards.
            // A string, not a function: tsx rewrites inner functions with a helper the page does not have.
            const st = await page.evaluate(`(async () => {
              const el = document.querySelector('[data-audit="count-bunch-option"][data-lot="${lot14}"]');
              if (!el) return 'option not in the document';
              const frame = () => new Promise(r => requestAnimationFrame(() => r()));
              const boxes = [];
              for (let i = 0; i < 4; i++) { const b = el.getBoundingClientRect(); boxes.push([b.left, b.top, b.width, b.height].map(Math.round).join(',')); await frame(); await frame(); }
              const cs = getComputedStyle(el); const sheet = el.closest('[data-audit="record-sheet"]');
              const anims = document.getAnimations().map(a => (a.animationName || a.transitionProperty || a.constructor.name) + '@' + ((a.effect && a.effect.target && (a.effect.target.getAttribute('data-audit') || a.effect.target.tagName)) || '?') + ':' + a.playState);
              return { disabled: el.disabled, boxes, vis: cs.visibility, op: cs.opacity, options: document.querySelectorAll('[data-audit="count-bunch-option"]').length, sheets: document.querySelectorAll('[data-audit="record-sheet"]').length, sheetTransform: sheet ? getComputedStyle(sheet).transform : 'no sheet', sheetScroll: sheet ? sheet.scrollTop + '/' + sheet.scrollHeight + '/' + sheet.clientHeight : '', busy: !!(document.querySelector('[data-audit="record-save"]') || {}).disabled, anims: anims.slice(0, 8) };
            })()`).catch(err => `evaluate failed: ${String(err).slice(0, 160)}`)
            const why = (e instanceof Error ? e.message : String(e)).split('\n').map(l => l.trim()).filter(l => /intercepts|receives|retrying|from <|subtree|scrolling|stable/.test(l)).slice(0, 6).join(' · ')
            throw new Error(`${e instanceof Error ? e.message.split('\n')[0] : String(e)} · ${why} · option ${JSON.stringify(st)} · url ${page.url().replace(BASE, '')} · navigations during 14: ${navs14.join(' → ') || 'none'} · console errors: ${errs14.slice(0, 3).join(' | ') || 'none'}`)
          }
          await page.getByLabel('Counted', { exact: true }).fill(String(n))
          const preview = await text('[data-audit="count-preview"]')
          await page.locator('[data-audit="record-save"]').first().click()
          return preview
        }
        // Below: 274 → −1, and the change is offered.
        const pv1 = await countOnce(274)
        const seq1 = await watchStates(page, 'Sent', 30_000, 'Counted 274 head')
        const strip1 = (await page.locator('[role="status"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
        const offer1 = await page.locator('[data-audit="follow-up-take"]').count()
        const offer1Text = await text('[data-audit="follow-up-take"]')
        const headAfter1 = await headOf(lot14)
        record('14: counting below expected — the sheet previews "274 counted · 275 expected · −1", the receipt says the same, and "Change bunch to 274?" is offered — the head count itself unmoved',
          /274 counted · 275 expected · −1/.test(pv1) && seq1.includes('Sent') && /274 counted · 275 expected · −1/.test(strip1) && offer1 === 1 && /Change bunch to 274\?/.test(offer1Text) && headAfter1 === 275,
          `preview "${pv1.slice(0, 40)}" · strip "${strip1.slice(0, 70)}" · offer ${offer1} "${offer1Text}" · head ${headAfter1}`)
        // Ignore it. Count again, above: +1, still 275 stored — two rows, neither overwritten.
        const pv2 = await countOnce(276)
        await watchStates(page, 'Sent', 30_000, 'Counted 276 head')
        const { data: counts } = await admin.from('events').select('id, payload').eq('ranch_id', ranchId).eq('type', 'cattle_counted').eq('payload->>herd_lot_id', lot14).is('deleted_at', null).order('ts')
        const cs = (counts ?? []) as { payload: { counted?: number; expected?: number } }[]
        record('14: counting above expected — +1 — and two counts in a row are two rows, both with the expected they saw; nothing overwrote',
          /276 counted · 275 expected · \+1/.test(pv2) && cs.length === 2 && cs[0].payload.counted === 274 && cs[1].payload.counted === 276 && cs.every(c => c.payload.expected === 275) && (await headOf(lot14)) === 275,
          `preview "${pv2.slice(0, 40)}" · rows ${cs.length} [${cs.map(c => `${c.payload.counted}/${c.payload.expected}`).join(', ')}] · head ${await headOf(lot14)}`)
        // Equal: same, and nothing offered.
        const pv3 = await countOnce(275)
        await watchStates(page, 'Sent', 30_000, 'Counted 275 head')
        const offer3 = await page.locator('[data-audit="follow-up-take"]').count()
        record('14: counting equal to expected — "same" — and no change is offered', /275 counted · 275 expected · same/.test(pv3) && offer3 === 0, `preview "${pv3.slice(0, 40)}" · offers ${offer3}`)
        // The bunch card: last count on one line, with the change button because the last count (275) equals… no: take the −1 path on the card.
        await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
        const card = page.locator('[data-audit="lot-row"]').filter({ hasText: LOT14 })
        await card.waitFor({ timeout: 20_000 }).catch(() => {})
        const lastCount = (await card.locator('[data-audit="lot-last-count"]').innerText().catch(() => '')).replace(/\s+/g, ' ')
        record('14: the bunch card shows the last count and how long ago, on one line', /Last count: 275 counted · 275 expected · same · today/.test(lastCount), `"${lastCount.slice(0, 80)}"`)
        // Take the change from a fresh count of 274: the card's button.
        await page.goto(`/today?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await countOnce(274)
        await watchStates(page, 'Sent', 30_000, 'Counted 274 head')
        await page.locator('[data-audit="follow-up-take"]').click().catch(() => {})
        await page.locator('[data-audit="follow-up-done"]').waitFor({ timeout: 15_000 }).catch(() => {})
        const changed = await headOf(lot14)
        const { count: setRows } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('type', 'head_count_set').eq('payload->>lot_id', lot14).eq('payload->>head_after', '274')
        record('14: tapping "Change bunch to 274?" sets the bunch to 274 through its own save, with a head_count_set row', changed === 274 && (setRows ?? 0) >= 1, `head ${changed} · head_count_set rows ${setRows ?? 0}`)

        // New bunch mid-flow: from inside Feed hay's "Fed to", make one and land back with it picked.
        await recordControl(page).click()
        await page.getByRole('button', { name: /^Feed hay/ }).click()
        await page.locator('[data-audit="fed-to"]').waitFor({ timeout: 15_000 })
        await page.locator('[data-audit="fed-to"]').selectOption('__new__')
        const formUp = await page.locator('[data-audit="new-bunch"]').waitFor({ timeout: 10_000 }).then(() => true).catch(() => false)
        const NEW14 = `${PREFIX} 14 spot bunch`
        await page.locator('[data-audit="new-bunch-name"]').fill(NEW14)
        await page.locator('[data-audit="new-bunch-head-input"]').fill('18')
        await page.locator('[data-audit="new-bunch-class-pairs"]').click()
        await page.locator('[data-audit="new-bunch-save"]').click()
        await page.locator('[data-audit="new-bunch"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
        const pickedLabel = (await page.locator('[data-audit="fed-to"] option:checked').innerText().catch(() => '')).replace(/\s+/g, ' ')
        const stillOnFeed = (await page.getByLabel('Hay fed').count()) === 1
        const { data: newRow } = await admin.from('herd_lots').select('id, class, head_count, avg_weight').eq('name', NEW14).maybeSingle()
        const nr = newRow as { id: string; class: string; head_count: number; avg_weight: number | null } | null
        record('14: a bunch made from inside Feed hay — name, head, class — lands back on the feeding with it picked, and carries no weight',
          formUp && stillOnFeed && pickedLabel.startsWith(NEW14) && !!nr && nr.class === 'pairs' && nr.head_count === 18 && nr.avg_weight === null,
          `form ${formUp} · still on Feed hay ${stillOnFeed} · picked "${pickedLabel}" · row ${nr ? `${nr.class} ${nr.head_count} head, weight ${String(nr.avg_weight)}` : 'MISSING'}`)
        await page.getByRole('button', { name: 'Cancel' }).first().click().catch(() => {})

        // Offline count, then sync.
        await page.context().setOffline(true)
        await countOnce(270)
        const seqOff = await watchStates(page, 'Sent', 4_000, 'Counted 270 head')
        await page.context().setOffline(false)
        const seqOn = await watchStates(page, 'Sent', 45_000, 'Counted 270 head')
        const { data: offRow } = await admin.from('events').select('payload').eq('ranch_id', ranchId).eq('type', 'cattle_counted').eq('payload->>counted', '270').maybeSingle()
        const op = (offRow as { payload?: { expected?: number } } | null)?.payload
        record('14: a count made offline is Saved, then Sent when signal returns — with the expected the bunch said at landing',
          seqOff[0] === 'Saved' && !seqOff.includes('Sent') && seqOn.includes('Sent') && op?.expected === 274,
          `${seqOff.join(' → ')} | ${seqOn.join(' → ')} · expected ${String(op?.expected)}`)

        if (nr) await admin.from('herd_lots').delete().eq('id', nr.id)
        await admin.from('herd_lots').delete().eq('id', lot14)
      }
    })

    // ── Block 5D, gate 6: sign out with a receipt open; sign in as another person ──
    // Private content disappears at once — the page, the storage, the receipt —
    // and nothing of the first person survives into the second's session, with
    // or without a clean sign-out in between.
    await section('Block 5D, gate 6: sign out with a receipt open; sign in as another person', async () => {
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
      record('7.1: offline, sign-out is blocked by an in-app sheet naming the count', /waiting for signal|couldn\u2019t send|couldn't send/i.test(blockTxt) && /^\d+ /.test(blockTxt), blockTxt.slice(0, 110))
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
      // own marketing copy contains the words "Saved → Waiting to
      // sync → Sent", so a body-text match for that phrase was testing
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
    })

    // ── no page errors / 5xx during the run is not tracked here; the invariant smoke covers it ──
  } finally {
    await browser.close()
    if (process.env.KEEP_FIXTURE) console.log('KEEP_FIXTURE set — fixture left in place for inspection (next run tears it down)')
    else await teardown('finish')
  }
  const fails = results.filter(r => !r.pass).length
  const skips = results.filter(r => r.skip).length
  // The commit rides WITH the counts (PK 2026-09-18): a number without the
  // code it came from is a partial, not a result.
  console.log(`\n${results.length - fails - skips} PASS · ${fails} FAIL${skips ? ` · ${skips} SKIP` : ''}${fails ? '  — BLOCKED' : ''}${process.env.ONLY ? `  — PARTIAL (ONLY=${process.env.ONLY})` : ''}  —  ${suiteIdentity()}\n`)
  process.exit(fails ? 1 : 0)
}

main().catch(async err => {
  console.error('\nsmoke crashed:', err instanceof Error ? err.message : err)
  try { await teardown('after crash') } catch (e) { console.error('teardown failed:', e) }
  process.exit(2)
})
