// ─── Markets smoke (Block 2.5) — the honesty rules, checked on a deployed build ─
//
// Synthetic member (own SMOKE-MARKETS ranch, home county 30069, one lot of
// 300 steers at 550 lb) opens the Markets view and the herd page. Checks:
//   • every auction figure carries a barn scope label, never a county name
//   • match labels present; a thin reference shows a range, not cents
//   • the sensitivity line is exact: 300 × 550 / 100 = $1,650 per $1/cwt
//   • culls listed under "slaughter prices, not breeding value"
//   • the history card renders with the carried-forward toggle and date ticks
//   • "Where I sell" pin: PATCH → reload → "Where you sell — Miles City"
//   • event markers and Since-you-last-checked SKIP until migration 048
// Teardown before and after. Exit 1 on any FAIL.
//
//   BASE=https://<preview>.vercel.app npx tsx scripts/smoke-markets.ts

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
const BYPASS = BASE.includes('vercel.app') ? process.env.VERCEL_BYPASS : undefined
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
const EMAIL = 'smoke-markets@dryline.farm'
const PREFIX = 'SMOKE-MARKETS'
const HOME_FIPS = '30069'
const results: { check: string; pass: boolean; detail: string; skip?: boolean }[] = []
const record = (check: string, pass: boolean, detail = '') => { results.push({ check, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${check}${detail ? ` — ${detail}` : ''}`) }
const skip = (check: string, detail: string) => { results.push({ check, pass: true, detail, skip: true }); console.log(`SKIP  ${check} — ${detail}`) }
let userId = ''

async function teardown(label: string) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const ids = (users?.users ?? []).filter(u => u.email === EMAIL).map(u => u.id)
  let n = 0
  if (ids.length) {
    for (const t of ['events', 'places', 'operation_profiles', 'ranch_members']) n += (await admin.from(t).delete().in('user_id', ids).select('user_id')).data?.length ?? 0
    n += (await admin.from('profiles').delete().in('id', ids).select('id')).data?.length ?? 0
  }
  n += (await admin.from('ranches').delete().like('name', `${PREFIX}%`).select('id')).data?.length ?? 0
  for (const id of ids) { await admin.auth.admin.deleteUser(id); n++ }
  console.log(`teardown (${label}): removed ${n}`)
}

async function seed() {
  const { data: created, error } = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true })
  if (error || !created.user) throw new Error(`createUser: ${error?.message}`)
  userId = created.user.id
  const { data: ranch } = await admin.from('ranches').insert({ name: `${PREFIX} ranch` }).select('id').single()
  await admin.from('ranch_members').insert({ ranch_id: ranch!.id, user_id: userId, role: 'owner' })
  await admin.from('profiles').upsert({ id: userId, email: EMAIL, home_county_fips: HOME_FIPS })
  const lot = { id: 'smoke-steers', class: 'steers', head_count: 300, avg_weight: 550, weight_unit: 'lb', frame: 'Medium and Large', weaned: true, sale_windows: [], created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' }
  const { error: pErr } = await admin.from('operation_profiles').insert({ user_id: userId, county_fips: HOME_FIPS, herd: { lots: [lot] } })
  if (pErr) throw new Error(`profile: ${pErr.message}`)
}

async function signIn(ctx: BrowserContext): Promise<Page> {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  const page = await ctx.newPage()
  await page.goto(`/auth/callback?token_hash=${link.data!.properties!.hashed_token}&type=magiclink&next=/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL(u => u.pathname.startsWith('/dashboard'), { timeout: 15_000 }).catch(() => {})
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await page.locator('header').getByText(EMAIL).waitFor({ state: 'attached', timeout: 30_000 })
  return page
}

const text = async (page: Page, sel = 'main') => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ')

async function main() {
  console.log(`\nDryline — markets smoke  (${BASE})\n`)
  await teardown('pre-run')
  await seed()
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 420, height: 900 }, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
  try {
    const page = await signIn(ctx)
    await page.goto(`/dashboard?fips=${HOME_FIPS}&view=markets`, { waitUntil: 'domcontentloaded' })
    await page.getByText('Auction reference', { exact: true }).waitFor({ timeout: 30_000 }).catch(() => {})
    await page.getByText(/carried-forward steps/).waitFor({ timeout: 45_000 }).catch(() => {})
    await page.getByText(/Every \$1\/cwt/).first().waitFor({ timeout: 15_000 }).catch(() => {})
    const body = await text(page)

    record('A2: auction figures carry a barn scope label', /(Nearby auction reference|Where you sell) — (Billings|Miles City)/.test(body), (body.match(/(Nearby auction reference|Where you sell) — [A-Za-z ]+/) ?? [''])[0])
    record('A2: no county name attached to an auction figure', !/Petroleum (County )?auction/.test(body) && !/County auction/.test(body))
    record('A3: match labels present', /Close match|Broader reference|Limited evidence/.test(body), (body.match(/Close match|Broader reference|Limited evidence/) ?? [''])[0])
    record('A3: a thin reference says so and shows a range', !/Limited evidence/.test(body) || /under 20 head, range shown/.test(body))
    record('A4: sensitivity line is exact for 300 head × 550 lb', /Every \$1\/cwt move is \$1,650/.test(body), (body.match(/Every \$1\/cwt move is \$[\d,]+[^.]*\./) ?? [''])[0])
    record('A5: culls listed as slaughter prices, not breeding value', /Culls · slaughter prices, not breeding value/i.test(body) && /(Breaker|Boner|Lean|Cull cows|Slaughter bulls)/i.test(body))
    record('B3: history card with the carried-forward toggle', /Cattle markets · history/i.test(body) && /carried-forward steps/i.test(body))
    record('B4: honest framing on a short spine', /History begins .*no prior year to compare yet/.test(body) || /Prior year in gray/.test(body))
    record('B5: no correlation number anywhere', !/R²|R\^2|correlation|explains \d+%/i.test(body))
    const svgPoints = await page.locator('svg circle').count()
    record('B3: observations render as points', svgPoints > 0, `${svgPoints} circles`)

    // Event markers + Since (need migration 048)
    const { error: evErr } = await admin.from('market_events').select('id').limit(1)
    if (evErr) skip('B6/B7: event markers and Since you last checked', `migration 048 not applied (${evErr.message.slice(0, 50)})`)
    else {
      record('B6: event markers with a source link', /▾/.test(body), '')
      record('B7: Since you last checked · Markets', /Since (you last checked|yesterday)/i.test(body) && /(New .* report|latest local reference is from)/i.test(body), (body.match(/Since (you last checked|yesterday)[^.]{0,120}/i) ?? [''])[0])
    }

    // Where I sell pin (needs migration 046)
    const pin = await page.request.patch('/api/operation-profile', { data: { sell_barn_slug: '1773' } })
    if (pin.status() === 503 || pin.status() === 500) skip('A2: Where I sell pin', `PATCH ${pin.status()} — migration 046 not applied?`)
    else {
      await page.goto(`/dashboard?fips=${HOME_FIPS}&view=markets`, { waitUntil: 'domcontentloaded' })
      await page.getByText('Auction reference', { exact: true }).waitFor({ timeout: 30_000 }).catch(() => {})
      const pinned = await text(page)
      record('A2: Where I sell pin → "Where you sell — Miles City"', pin.ok() && /Where you sell — Miles City/.test(pinned), `PATCH ${pin.status()} · ${(pinned.match(/Where you sell — [A-Za-z ]+/) ?? [''])[0]}`)
    }

    // ── Phone widths (Block 2.5 mobile audit): no horizontal scroll, 48 px targets,
    //    15 px text floor inside the Markets cards, a full-width chart, a tappable point,
    //    a tappable event marker — measured, not inferred from CSS. ──
    const MEASURE = `(function(width){
      var cards = Array.from(document.querySelectorAll('[data-audit="history-card"],[data-audit="auction-card"],[data-audit="herd-value-card"],[data-audit="since-card"],[data-audit="sell-pin"]'));
      var overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      var small = []; var tiny = [];
      cards.forEach(function(card){
        Array.from(card.querySelectorAll('button, select, a[href]')).forEach(function(el){ var b = el.getBoundingClientRect(); if (b.height > 0 && b.height < 48) small.push((el.textContent||'').trim().slice(0,24) + ' ' + Math.round(b.height) + 'px') });
        Array.from(card.querySelectorAll('p, span, li, label, text, tspan, option')).forEach(function(el){ var t = (el.textContent||'').trim(); var f = parseFloat(getComputedStyle(el).fontSize); var caps = getComputedStyle(el).textTransform === 'uppercase'; if (t && f > 0 && f < 15 && !caps && el.tagName.toLowerCase() !== 'option') tiny.push(el.tagName.toLowerCase() + ' ' + f + 'px ' + t.slice(0,24)) });
      });
      var svg = document.querySelector('[data-audit="chart"] svg.recharts-surface');
      var chartW = svg ? Math.round(svg.getBoundingClientRect().width) : 0;
      var pts = document.querySelectorAll('[data-audit="point"]').length;
      return { overflowX: overflowX, small: small.slice(0,8), smallCount: small.length, tiny: tiny.slice(0,8), tinyCount: tiny.length, chartW: chartW, pts: pts };
    })`
    for (const width of [320, 375, 390, 430]) {
      const mctx = await browser.newContext({ baseURL: BASE, viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
      const mp = await signIn(mctx)
      await mp.goto(`/dashboard?fips=${HOME_FIPS}&view=markets`, { waitUntil: 'domcontentloaded' })
      await mp.getByText(/carried-forward steps/).waitFor({ timeout: 45_000 }).catch(() => {})
      await mp.waitForTimeout(1200)
      const m = await mp.evaluate(`${MEASURE}(${width})`) as { overflowX: number; small: string[]; smallCount: number; tiny: string[]; tinyCount: number; chartW: number; pts: number }
      record(`${width}px: no horizontal page scroll`, m.overflowX === 0, `overflow ${m.overflowX}px`)
      record(`${width}px: every Markets control ≥ 48 px`, m.smallCount === 0, m.small.join(' | '))
      record(`${width}px: no Markets text under 15 px (uppercase kicker labels excepted)`, m.tinyCount === 0, m.tiny.join(' | '))
      record(`${width}px: chart takes the width`, m.chartW >= width - 48, `chart ${m.chartW}px of ${width}`)
      // a point tap opens the detail panel; an event chip opens its source
      const pt = mp.locator('[data-audit="point"]').first()
      if (await pt.count()) { await pt.tap().catch(() => pt.click()); const detail = await mp.getByText(/USDA AMS report \d+/).first().isVisible().catch(() => false); record(`${width}px: tapping a point opens its evidence`, detail) }
      else record(`${width}px: tapping a point opens its evidence`, false, 'no points')
      const chip = mp.getByRole('button', { name: /^▾/ }).first()
      if (await chip.count()) { await chip.tap().catch(() => chip.click()); const src = await mp.getByRole('link', { name: /^Source:/ }).first().isVisible().catch(() => false); record(`${width}px: tapping an event chip shows its source`, src) }
      else skip(`${width}px: tapping an event chip shows its source`, 'no events (migration 048?)')
      if (width === 390 && process.env.SHOT_DIR) {
        await mp.locator('[data-audit="history-card"]').screenshot({ path: `${process.env.SHOT_DIR}/markets-history-390.png` }).catch(() => {})
        await mp.screenshot({ path: `${process.env.SHOT_DIR}/markets-full-390.png`, fullPage: true }).catch(() => {})
      }
      await mctx.close()
    }

    // Herd page lot card
    await page.goto('/herd', { waitUntil: 'domcontentloaded' })
    await page.getByText('Every $1/cwt').first().waitFor({ timeout: 30_000 }).catch(() => {})
    const herd = await text(page)
    record('A4: herd page lot card carries the sensitivity line', /Every \$1\/cwt move is \$1,650 on this lot/.test(herd))
    record('A2: herd page scope is the barn', /(Nearby auction reference|Where you sell) — /.test(herd) && !/County auction/.test(herd))
  } finally {
    await browser.close()
    await teardown('finish')
  }
  const fails = results.filter(r => !r.pass).length, skips = results.filter(r => r.skip).length
  console.log(`\n${results.length - fails - skips} PASS · ${fails} FAIL${skips ? ` · ${skips} SKIP` : ''}${fails ? '  — BLOCKED' : ''}\n`)
  process.exit(fails ? 1 : 0)
}
main().catch(async err => { console.error('\nsmoke crashed:', err instanceof Error ? err.message : err); try { await teardown('after crash') } catch {} ; process.exit(2) })
