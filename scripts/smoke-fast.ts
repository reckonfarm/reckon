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
//   7. THE MANIFEST IS WHOLE and /start lands by session (Block 48).
//   8. THE INSTALL ASK waits for a second day and never shows in the
//      installed app (Block 48, R3).
//   9. INSIDE FACEBOOK the ask says open Safari, with a Copy link (Block 48).
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
      // Today has no heading, and its headlines need a home county this
      // fixture ranch does not have. The ledger tabs are on Today either way.
      ['/today', 'main [role="tablist"][aria-label="Ledgers"]'],
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

    // 2b — Session 1 (3): the header is right from the FIRST byte. The server
    // paints Account for a signed-in member; "Sign in" never shows for a beat.
    // Read off the HTML as sent, not the hydrated page.
    {
      const cookie = (await ctx.cookies()).map(c => `${c.name}=${c.value}`).join('; ')
      const hdr: Record<string, string> = { cookie, ...(BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {}) }
      const wrong: string[] = []
      for (const path of ['/ranch?tab=ground', '/today', '/account']) {   // Session 3b: Places is Ground now
        const html = await fetch(`${BASE}${path}`, { headers: hdr, redirect: 'manual' }).then(r => r.status === 200 ? r.text() : `status ${r.status}`)
        const head = html.slice(0, html.indexOf('</header>') + 9)
        const account = /data-audit="account-button"/.test(head), signin = /href="\/signin"/.test(head)
        if (!account || signin) wrong.push(`${path}: ${account ? 'Account' : 'no Account'}${signin ? ' + Sign in' : ''}${/^status/.test(html) ? ` (${html})` : ''}`)
      }
      record('the header says Account from the first byte on every private screen — never Sign in for a beat', wrong.length === 0, wrong.length ? wrong.join(' · ') : '/ranch?tab=ground /today /account')
    }

    // 2c — Session 1 (1): something's wrong — one tap, any screen, and PK gets
    // the screen and the words. The flag is in the header; the sheet takes the
    // words; Send lands a row with the page it came from. The email is proved
    // by the route's code and PK's inbox, not by a suite that would mail him.
    {
      await page.goto('/ranch/cattle', { waitUntil: 'domcontentloaded' })
      await page.locator('header [data-audit="something-wrong"]').click()
      await page.locator('[data-audit="something-wrong-words"]').fill('SMOKE-FAST: the count is off by one')
      await page.locator('[data-audit="something-wrong-send"]').click()
      const sent = await page.locator('[data-audit="something-wrong-sent"]').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
      const { data: rows } = await admin.from('feedback').select('id, message, page_path, user_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
      const row = rows?.[0] ?? null
      record('something\'s wrong: one tap in the header, the words, Send — "Sent" on screen and the row carries the page', sent && !!row && row.page_path === '/ranch/cattle' && /off by one/.test(row.message ?? ''), `sent ${sent} · row ${row ? `page ${row.page_path} · "${row.message}"` : 'none'}`)
      if (row) await admin.from('feedback').delete().eq('id', row.id)
    }

    // 2d — Session 1 (2), moved by Block 48 (R3): the home-screen walkthrough
    // lives under Help on Account now, never painted on a first load of Today.
    // An iPhone gets the line there, with the three steps and two pictures
    // behind one tap; Today paints no line at all.
    const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    // serviceWorkers: 'block' — once the worker claims a page, ITS fetch of a
    // navigation carries Chromium's own user agent, not the context's, so a
    // server-side phone read painted nothing (both Today and Account, through
    // the worker, came back as a desktop). A real phone's worker carries the
    // real phone. The phone contexts here talk to the server directly.
    const phone = (ua: string) => browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: ua, serviceWorkers: 'block', extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
    {
      const ios = await phone(IPHONE_UA)
      // The same session, carried over: a second magic link for one address
      // trips the sign-in limit (f011074), and a page that lands on /signin
      // has no line to find. Identity first: the page must be Account.
      await ios.addCookies(await ctx.cookies())
      const ip = await ios.newPage()
      await ip.goto('/today', { waitUntil: 'domcontentloaded' })
      await ip.locator('main [role="tablist"][aria-label="Ledgers"]').waitFor({ timeout: 15_000 }).catch(() => {})
      const onToday = await ip.locator('[data-audit="install-line"]').count()
      await ip.goto('/account', { waitUntil: 'domcontentloaded' })
      const landed = new URL(ip.url()).pathname
      const line = await ip.locator('[data-audit="install-line"]').first().waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)
      await ip.locator('[data-audit="install-line"]').first().click().catch(() => {})
      await ip.locator('[data-audit="install-steps"]').waitFor({ timeout: 8_000 }).catch(() => {})
      const steps = await ip.locator('[data-audit="install-steps"] li').count()
      const pictures = await ip.locator('[data-audit="install-steps"] svg').count()
      const words = ((await ip.locator('[data-audit="install-steps"]').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ')
      record('home-screen walkthrough: an iPhone gets the line under Help on Account, Share → Add to Home Screen → Add with two pictures; Today paints no line',
        landed === '/account' && line && steps === 3 && pictures === 2 && /Share/.test(words) && /Add to Home Screen/.test(words) && onToday === 0,
        `page ${landed} · line ${line} · steps ${steps} · pictures ${pictures} · line on Today ${onToday}`)
      await ios.close()
    }

    // 7 — Block 48: the manifest is whole, and /start lands where the person
    // works. Read as served: the JSON itself, every shortcut answering with
    // our own page, both screenshots answering as PNG, and the redirect by
    // session — signed out to Markets, signed in to Today.
    {
      const cookie = (await ctx.cookies()).map(c => `${c.name}=${c.value}`).join('; ')
      const bypass: Record<string, string> = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {}
      const faults: string[] = []
      const res = await fetch(`${BASE}/manifest.webmanifest`, { headers: bypass })
      const m = res.ok ? await res.json().catch(() => null) as null | { id?: string; scope?: string; start_url?: string; display?: string; icons?: { src: string; sizes: string; purpose?: string }[]; shortcuts?: { name: string; url: string }[]; screenshots?: { src: string; form_factor?: string }[] } : null
      if (!m) faults.push(`manifest ${res.status}`)
      else {
        if (m.id !== '/') faults.push(`id ${m.id}`)
        if (m.scope !== '/') faults.push(`scope ${m.scope}`)
        if (m.start_url !== '/start?source=pwa') faults.push(`start_url ${m.start_url}`)
        if (m.display !== 'standalone') faults.push(`display ${m.display}`)
        if (!(m.icons ?? []).some(i => i.purpose === 'maskable' && i.sizes === '512x512')) faults.push('no 512 maskable icon')
        if ((m.icons ?? []).filter(i => i.purpose === 'any').length < 2) faults.push('the any icons are gone')
        const names = (m.shortcuts ?? []).map(x => x.name)
        if (names.join('|') !== 'Record feed|Count cattle|Markets') faults.push(`shortcuts ${names.join(', ') || 'none'}`)
        // Each shortcut's own landmark, as painted: the tally has no header.
        const landmark: Record<string, RegExp> = { 'Record feed': /aria-label="Ledgers"/, 'Count cattle': /Count at a gate/, 'Markets': />Markets</ }
        for (const sc of m.shortcuts ?? []) {
          const r = await fetch(`${BASE}${sc.url}`, { headers: { cookie, ...bypass }, redirect: 'follow' })
          const html = r.ok ? await r.text() : ''
          if (!r.ok || !(landmark[sc.name] ?? /data-audit="column"/).test(html)) faults.push(`${sc.name} → ${sc.url} answered ${r.status}${r.ok ? ', not its screen' : ''}`)
        }
        const shots = (m.screenshots ?? []).filter(x => x.form_factor === 'narrow')
        if (shots.length !== 2) faults.push(`${shots.length} narrow screenshots`)
        for (const sh of shots) {
          const r = await fetch(`${BASE}${sh.src}`, { headers: bypass })
          if (!r.ok || !/image\/png/.test(r.headers.get('content-type') ?? '')) faults.push(`${sh.src} answered ${r.status} ${r.headers.get('content-type') ?? ''}`)
        }
        for (const [who, hdr, want] of [['signed out', bypass, '/markets'], ['signed in', { cookie, ...bypass }, '/today']] as const) {
          const r = await fetch(`${BASE}/start?source=pwa`, { headers: hdr, redirect: 'manual' })
          const to = r.headers.get('location') ?? ''
          if (!(r.status >= 300 && r.status < 400) || new URL(to, BASE).pathname !== want) faults.push(`/start ${who} → ${r.status} ${to || 'no location'}`)
        }
      }
      record('the manifest is whole — id, scope, start_url, maskable icon, three shortcuts at our screens, two narrow screenshots — and /start sends a signed-out phone to Markets, a signed-in one to Today',
        faults.length === 0, faults.length ? faults.join(' · ') : 'manifest ok · shortcuts answer · screenshots png · /start → /markets, /today')
    }

    // 8 — Block 48 (R3): the install ask never shows on a first load and never
    // inside the installed app. Three readings on one signed-in iPhone: a
    // fresh phone on its first load (no sheet); the same phone on its second
    // day (the sheet, with the steps — the proof the check can see one at
    // all); and that second day opened from the home screen (no sheet).
    const SECOND_DAY = JSON.stringify({ days: ['2026-01-01'], saves: 0, checks: 0, dismissedAt: null, installedAt: null })
    const nudgeOn = async (opts: { ua: string; seed?: string; standalone?: boolean }) => {
      const c = await phone(opts.ua)
      await c.addCookies(await ctx.cookies())
      // Strings, not functions: under tsx a function arrives with an esbuild
      // helper (__name) the page does not have, and the override never runs.
      if (opts.seed) await c.addInitScript(`try{localStorage.setItem('dryline_install',${JSON.stringify(opts.seed)})}catch(e){}`)
      if (opts.standalone) await c.addInitScript("Object.defineProperty(navigator,'standalone',{get:function(){return true}})")
      const p = await c.newPage()
      await p.goto('/today', { waitUntil: 'domcontentloaded' })
      await p.locator('main [role="tablist"][aria-label="Ledgers"]').waitFor({ timeout: 15_000 }).catch(() => {})
      const shown = await p.locator('[data-audit="install-nudge"]').waitFor({ state: 'visible', timeout: 6_000 }).then(() => true).catch(() => false)
      const text = shown ? ((await p.locator('[data-audit="install-nudge"]').innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ') : ''
      const steps = shown ? await p.locator('[data-audit="install-nudge-steps"] li').count() : 0
      const inApp = shown ? await p.locator('[data-audit="install-nudge-inapp"]').count() : 0
      const copy = shown ? await p.locator('[data-audit="install-nudge-copy"]').count() : 0
      const page_ = new URL(p.url()).pathname
      await c.close()
      return { shown, text, steps, inApp, copy, page: page_ }
    }
    {
      const first = await nudgeOn({ ua: IPHONE_UA })
      const second = await nudgeOn({ ua: IPHONE_UA, seed: SECOND_DAY })
      const installed = await nudgeOn({ ua: IPHONE_UA, seed: SECOND_DAY, standalone: true })
      record('the install ask: nothing on a first load, the sheet with the three steps on a second day, nothing when opened from the home screen',
        first.page === '/today' && !first.shown && second.shown && second.steps === 3 && /home screen/.test(second.text) && /no signal/.test(second.text) && !installed.shown,
        `first load ${first.shown ? 'SHOWN' : 'none'} · second day ${second.shown ? `shown, ${second.steps} steps` : 'NOT shown'} · home-screen app ${installed.shown ? 'SHOWN' : 'none'} (page ${first.page})`)
    }

    // 9 — Block 48: an iPhone inside Facebook cannot add anything to its home
    // screen; the ask says to open Safari and offers the link to carry over.
    {
      const fb = await nudgeOn({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0.0.0;FBDV/iPhone15,2]', seed: SECOND_DAY })
      record('inside Facebook, the ask says "Open this in Safari" and offers a Copy link button',
        fb.shown && fb.inApp === 1 && /Open this in Safari to add it to your home screen/.test(fb.text) && fb.copy === 1 && fb.steps === 0,
        fb.shown ? `"${fb.text.slice(0, 110)}" · copy button ${fb.copy} · steps ${fb.steps}` : `not shown (page ${fb.page})`)
    }

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
    // `data-save-word` marks every place one is drawn — the same read the
    // daily loop makes. Zero painted is a FAIL, never a pass.
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
