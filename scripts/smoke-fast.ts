// ─── The fast tier — the screens almost every change touches ─────────────────
//
//   BASE=https://<preview>.vercel.app npx tsx scripts/smoke-fast.ts
//
// About a minute. It is NOT a small daily loop: it does not try to cover the
// ranch, and passing it means only that nothing obvious is broken on the
// surfaces a UI change lands on. The full daily loop still runs once before a
// merge and is the thing that decides green.
//
// What is in it, and why each earns its second:
//   1. SIGN-IN STICKS. Every other check is worthless if this is wrong, and a
//      cold preview failing here has eaten whole runs.
//   2. EVERY SCREEN PAINTS. Each surface answers and shows its own landmark —
//      not a 200, which a Vercel error page also returns.
//   3. A RECORD SAVES AND SENDS. One feeding, all the way to Sent.
//   4. THE SAVE WORDS ARE THE FOUR, UNTRANSFORMED, wherever they are painted.
//      A CSS transform once turned Sent into SENT and hid a landed record.
//   5. THE HOLD MENU OFFERS NOTHING DEAD. Open came off; Fix and Split stay.
//   6. AN UNDO IS REACHABLE. Delete a bunch and check that the thing the
//      browser would hand the tap to is the Undo button, not a floating pill.
//
// Its own account and ranch, swept by scripts/teardown-fixtures.ts like every
// other fixture: smoke-fast@dryline.farm, SMOKE-FAST ranch.

import { chromium, type Page } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { guardWorktree, suiteIdentity } from './lib/suite-guard'

for (const f of ['.env', '.env.local', 'e2e/.env.e2e']) {
  const p = resolve(process.cwd(), f)
  if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

guardWorktree('smoke-fast')

const BASE = process.env.BASE ?? 'https://www.dryline.farm'
const BYPASS = BASE.includes('vercel.app') ? process.env.VERCEL_BYPASS : undefined
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
const EMAIL = 'smoke-fast@dryline.farm'
const PREFIX = 'SMOKE-FAST'
const FOUR = ['Saved', 'Waiting for signal', 'Sent', "Couldn't send"]

const results: { name: string; ok: boolean; detail: string }[] = []
const record = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

let userId = '', ranchId = '', lotId = ''

async function sweep() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const ids = (users?.users ?? []).filter(u => u.email === EMAIL).map(u => u.id)
  for (const t of ['events', 'places', 'herd_lots', 'ranch_members', 'profiles']) {
    const col = t === 'herd_lots' ? 'created_by' : t === 'profiles' ? 'id' : 'user_id'
    if (ids.length) await admin.from(t).delete().in(col, ids)
  }
  const { data: ranches } = await admin.from('ranches').select('id, name')
  const junk = ((ranches ?? []) as { id: string; name: string }[]).filter(r => r.name.startsWith(PREFIX)).map(r => r.id)
  if (junk.length) await admin.from('ranches').delete().in('id', junk)
  for (const id of ids) await admin.auth.admin.deleteUser(id)
}

async function seed() {
  const { data: created, error } = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true, user_metadata: { smoke: true } })
  if (error || !created.user) throw new Error(`createUser: ${error?.message}`)
  userId = created.user.id
  await admin.from('profiles').upsert({ id: userId, email: EMAIL })
  const { data: ranch, error: rErr } = await admin.from('ranches').insert({ name: `${PREFIX} ranch` }).select('id').single()
  if (rErr) throw new Error(`ranch: ${rErr.message}`)
  ranchId = ranch.id as string
  await admin.from('ranch_members').insert({ ranch_id: ranchId, user_id: userId, role: 'owner' })
  await admin.from('places').insert({ user_id: userId, ranch_id: ranchId, name: `${PREFIX} stack`, kind: 'stackyard' })
  lotId = randomUUID()
  await admin.from('herd_lots').insert({ id: lotId, ranch_id: ranchId, class: 'cows', name: `${PREFIX} bunch`, head_count: 40, avg_weight: 1100, weight_unit: 'lb', created_by: userId, updated_by: userId })
  await admin.from('events').insert({ id: randomUUID(), user_id: userId, ranch_id: ranchId, type: 'head_count_set', ts: new Date().toISOString(), schema_version: 1, payload: { lot_id: lotId, reason: 'created', source: 'manual', head_after: 40, head_before: null, schema_version: 1 } })
}

async function hold(page: Page, sel: string): Promise<boolean> {
  const box = await page.locator(sel).first().boundingBox()
  if (!box) return false
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(24, box.height / 2))
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.up()
  return (await page.locator('[data-audit="row-actions-sheet"]').count()) > 0
}

async function main() {
  const t0 = Date.now()
  console.log(`\nDryline — fast tier  (${BASE})\n`)
  await sweep()
  await seed()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    baseURL: BASE, viewport: { width: 390, height: 844 },
    extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {},
  })
  const page = await ctx.newPage()
  try {
    // 1 — sign-in sticks
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
    const tokenHash = link.data?.properties?.hashed_token
    if (!tokenHash) throw new Error(`generateLink: ${link.error?.message}`)
    await page.goto(`/auth/callback?token_hash=${tokenHash}&type=magiclink&next=/today`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(u => !u.pathname.startsWith('/auth/callback'), { timeout: 20_000 }).catch(() => {})
    await page.goto('/today', { waitUntil: 'domcontentloaded' })
    // The header paints "Sign in" first and swaps to the account button once
    // the browser client has read the session — wait for the SWAP, not the
    // first paint, or this reads a signed-in page as a signed-out one.
    await page.locator('header [data-audit="account-button"]').waitFor({ timeout: 25_000 }).catch(() => {})
    const signedIn = await page.locator('header [data-audit="account-button"]').count()
    record('sign-in sticks and Today paints', signedIn === 1, signedIn === 1 ? 'account button present' : 'no account button — every check below is meaningless')
    if (signedIn !== 1) throw new Error('not signed in')

    // 2 — every screen paints its own landmark, not just a 200
    const screens: [string, string][] = [
      ['/today', 'main h1, main h2'],
      ['/ranch/cattle', '[data-audit="lot-row"]'],
      ['/ranch/places', '[data-audit="place-row"], #places-unplaced, [data-audit="capture-choose"]'],
      ['/ranch/activity', 'main h1, [data-audit="activity-row"]'],
      ['/hay', 'main h1'],
      ['/account', 'main h1'],
    ]
    const bad: string[] = []
    for (const [path, landmark] of screens) {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => null)
      // waitFor, not isVisible: isVisible answers immediately, so it asks
      // whether the page had painted BEFORE it had a chance to.
      const painted = await page.locator(landmark).first().waitFor({ state: 'visible', timeout: 12_000 }).then(() => true).catch(() => false)
      if (!res || res.status() >= 400 || !painted) bad.push(`${path} (${res?.status() ?? 'no answer'}${painted ? '' : ', nothing painted'})`)
    }
    record(`every screen paints — ${screens.length} of them`, bad.length === 0, bad.length ? bad.join(' · ') : screens.map(s => s[0]).join(' '))

    // 3 — a record saves and reaches Sent
    await page.goto('/today', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-audit="record-fab"], [data-audit="record-control"]').first().click().catch(() => {})
    await page.getByRole('button', { name: /^Feed hay/ }).click().catch(() => {})
    await page.getByLabel('Hay fed').fill('2')
    await page.getByRole('button', { name: 'Record feeding', exact: true }).click().catch(() => {})
    let strip = ''
    for (let i = 0; i < 60 && !/Sent/.test(strip); i++) {
      strip = ((await page.locator('[role="status"]').first().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      if (!/Sent/.test(strip)) await page.waitForTimeout(500)
    }
    record('a feeding saves and reaches Sent', /Sent/.test(strip), `"${strip.slice(0, 70)}"`)

    // 4 — the save words, as painted
    const words = await page.locator('[data-save-word]').evaluateAll(els =>
      els.map(e => ({ text: (e as HTMLElement).innerText.trim(), transform: getComputedStyle(e).textTransform })))
    const wrong = words.filter(w => !FOUR.includes(w.text) || w.transform !== 'none')
    record('every painted save word is one of the four, untransformed',
      words.length > 0 && wrong.length === 0,
      `${words.length} painted · ${wrong.length ? wrong.map(w => `"${w.text}" (${w.transform})`).join(', ') : 'all four, untransformed'}`)

    // 5 — the hold menu offers nothing dead
    await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-audit="lot-row"]').first().waitFor({ timeout: 15_000 }).catch(() => {})
    const held = await hold(page, `[data-audit="lot-row"]#lot-${lotId}`)
    const opens = await page.locator('[data-audit="row-action-open"]').count()
    const fixes = await page.locator('[data-audit="row-action-fix"]').count()
    const extras = await page.locator('[data-audit="row-action-extra"]').count()
    record('the hold menu offers nothing that does nothing', held && opens === 0 && fixes === 1 && extras >= 1,
      `held ${held} · Open ${opens} · Fix ${fixes} · other actions ${extras}`)

    // 6 — an Undo is reachable: nothing is drawn over it
    await page.locator('[data-audit="row-action-delete"]').click().catch(() => {})
    await page.locator('[data-audit="undo-button"]').waitFor({ timeout: 12_000 }).catch(() => {})
    const reach = await page.evaluate(() => {
      const btn = document.querySelector('[data-audit="undo-button"]')
      if (!btn) return { found: false, hits: 'no undo at all', pills: 0 }
      const r = btn.getBoundingClientRect()
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { found: true, hits: at && btn.contains(at) ? '' : (at?.closest('[data-audit]')?.getAttribute('data-audit') ?? at?.tagName ?? 'something'), pills: document.querySelectorAll('[data-audit="record-fab"]').length }
    })
    record('an Undo is reachable — nothing is drawn over it', reach.found && reach.hits === '' && reach.pills === 0,
      `undo present ${reach.found} · the tap would hit ${reach.hits || 'the Undo button'} · pills ${reach.pills}`)
    await page.locator('[data-audit="undo-button"]').click().catch(() => {})
    await page.waitForTimeout(1_200)
  } catch (e) {
    record('the fast tier ran to the end', false, e instanceof Error ? e.message.slice(0, 120) : String(e))
  } finally {
    await browser.close().catch(() => {})
    await sweep()
  }

  const fails = results.filter(r => !r.ok).length
  console.log(`\n${results.length - fails} PASS · ${fails} FAIL${fails ? '  — BLOCKED' : ''}  ·  ${Math.round((Date.now() - t0) / 1000)}s  —  ${suiteIdentity()}\n`)
  process.exit(fails ? 1 : 0)
}

main().catch(e => { console.error('fast tier crashed:', e instanceof Error ? e.message : e); process.exit(2) })
