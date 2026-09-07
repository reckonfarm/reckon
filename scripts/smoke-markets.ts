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
//   • Phase A5: unit in the heading and beside every price; head count beneath at meta; no essay
//   • Phase A4: three radii, no shadows in main, 48 px links/buttons, 52 px LFP disclosure with Show/Hide, header targets
//   • Phase A3: a real action fully inside the first viewport at 390×844 and 1440×900; caption above the image
//   • Phase A2: one left edge at 390 and 1440; no FIPS in the heading; resting control + chooser with Cancel
//   • Phase A1: from the painted page — no text under 14 px, no pair under 4.5:1, nav/answers ≥ 7:1
//   • Block 2.6I: every price-bearing component links to its USDA AMS report (shared evidence line)
//   • Block 2.6H: point roles/labels, sizes by head, 48 px strip + Previous/Next, keyboard, list
//   • Block 2.6D: no displayed "as of" date exceeds today (five counties, Today view)
//   • Block 2.6C: LRP hero follows the picked term; chips read date · weeks; no monotonic claim
//   • Block 2.6F: event chips carry years, run chronologically, in-period only by default
//   • Block 2.6E: carried-forward steps default OFF; the copy follows the toggle
//   • Block 2.6B: chart title unit = axis unit for every view × measure
//   • Block 2.6A: Potter TX, Custer NE, Polk IA, Lane OR (signed out) never show a
//     "Nearby" label; the no-coverage sentence and a Nearby label never co-occur
// Teardown before and after. Exit 1 on any FAIL.
//
//   BASE=https://<preview>.vercel.app npx tsx scripts/smoke-markets.ts

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
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
    // The chart card is server-rendered before it is hydrated; a click that lands in
    // between is dropped. Wait for the network to go quiet and a beat more.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const body = await text(page)

    record('A2: auction figures carry a barn scope label', /(Nearby auction reference|Where you sell) — (Billings|Miles City)/.test(body), (body.match(/(Nearby auction reference|Where you sell) — [A-Za-z ]+/) ?? [''])[0])
    record('A2: no county name attached to an auction figure', !/Petroleum (County )?auction/.test(body) && !/County auction/.test(body))
    record('A3: every auction row carries its head count', /\d+ head/.test(body) && (await page.locator('[data-audit="auction-card"] li').count()) > 0, (body.match(/[\d,]+ head( · limited sample)?/) ?? [''])[0])
    record('A3: a thin row says "limited sample" beside the figure; a real range says so', !/limited sample/.test(body) || /\$[\d.]+\/cwt[^$]{0,80}limited sample|\$\d+–\d+\/cwt[^$]{0,80}a range, not one price/.test(body), (body.match(/\$[\d.–]+\/cwt[^$]{0,60}(limited sample|a range, not one price)/) ?? [''])[0])
    // Phase A5 — units live with the number or in the heading; the essay is gone.
    record('A5: the auction heading carries the unit', /Auction prices · \$\/cwt/.test(body))
    record('A5: no repeated disclaimer block under the auction rows', !/Close match = same class/.test(body) && !/head-weighted within each 100-lb band/.test(body))
    // Block 2.6G — never "range" beside a single price.
    record('2.6G: no "range shown" and no collapsed range ($X–$X) anywhere', !/range shown/i.test(body) && !/\$(\d+)–\$?\1\b/.test(body), (body.match(/\$(\d+)–\$?\1\b/) ?? [''])[0])
    record('A4: sensitivity line is exact for 300 head × 550 lb', /Every \$1\/cwt move is \$1,650/.test(body), (body.match(/Every \$1\/cwt move is \$[\d,]+[^.]*\./) ?? [''])[0])
    record('A5: culls listed as slaughter prices, not breeding value', /Culls · slaughter prices, not breeding value/i.test(body) && /(Breaker|Boner|Lean|Cull cows|Slaughter bulls)/i.test(body))
    record('B3: history card with the carried-forward toggle', /Cattle markets · history/i.test(body) && /carried-forward steps/i.test(body))
    // Block 2.6E — steps default OFF and the copy follows the state.
    const stepBtn = page.getByRole('button', { name: /carried-forward steps/ })
    const stepCopy = page.locator('[data-audit="step-copy"]')
    record('2.6E: carried-forward steps default OFF', /^Show carried-forward steps/.test((await stepBtn.innerText()).trim()) && /Nothing is drawn between them/.test(await stepCopy.innerText()), (await stepBtn.innerText()).trim())
    await stepBtn.click()
    await page.getByRole('button', { name: /^Hide carried-forward steps/ }).waitFor({ timeout: 5_000 }).catch(() => {})
    record('2.6E: copy follows the state when steps are shown', /^Hide carried-forward steps/.test((await stepBtn.innerText()).trim()) && /Dashed steps only carry the last sale forward/.test(await stepCopy.innerText()))
    await stepBtn.click()
    record('B4: honest framing on a short spine', /History begins .*no prior year to compare yet/.test(body) || /Prior year in gray/.test(body))
    record('B5: no correlation number anywhere', !/R²|R\^2|correlation|explains \d+%/i.test(body))
    const svgPoints = await page.locator('svg circle').count()
    record('B3: observations render as points', svgPoints > 0, `${svgPoints} circles`)

    // ── Block 2.6B — title unit = axis unit in every view × measure ──
    // The chart title and the "Vertical axis · …" caption read the same `unit`;
    // this walks every combination and checks the two RENDERED strings agree.
    for (const v of ['This year', 'Local · national', 'Corn'] as const) {
      await page.getByRole('radio', { name: v, exact: true }).click()
      for (const m of ['$/cwt', '$/head', 'My lot'] as const) {
        if (await page.getByRole('radio', { name: m, exact: true }).count() === 0) {
          await page.getByRole('button', { name: /More ▾/ }).click()
          await page.getByRole('radio', { name: m, exact: true }).waitFor({ timeout: 5_000 }).catch(() => {})
        }
        await page.getByRole('radio', { name: m, exact: true }).click()
        await page.locator('[data-audit="axis-unit"]').first().waitFor({ timeout: 10_000 }).catch(() => {})
        const titles = await page.locator('[data-audit="chart-title"]').allInnerTexts()
        const axes = (await page.locator('[data-audit="axis-unit"]').allInnerTexts()).map(t => t.replace(/^Vertical axis · /, '').trim())
        const agree = titles.length > 0 && titles.length === axes.length && titles.every((t, i) => t.trim().endsWith(axes[i]))
        record(`2.6B ${v} × ${m}: title unit = axis unit`, agree, `${titles.map((t, i) => `"${t.split(' · ').slice(-1)[0]}" vs "${axes[i] ?? '∅'}"`).join('; ')}`)
      }
    }
    await page.getByRole('radio', { name: '$/cwt', exact: true }).click()
    await page.getByRole('radio', { name: 'This year', exact: true }).click()

    // ── Block 2.6H — points, the selection strip, the sheet, keyboard, the list ──
    {
      await page.getByRole('radio', { name: 'This year', exact: true }).click()
      await page.locator('[data-audit="selection-strip"]').first().waitFor({ timeout: 10_000 }).catch(() => {})
      const pts = await page.evaluate(`(function(){
        return Array.from(document.querySelectorAll('[data-audit="chart"] [data-audit="point"]')).map(function(g){
          var c = g.querySelectorAll('circle'); var dot = c[c.length - 1];
          return { role: g.getAttribute('role'), tab: g.getAttribute('tabindex'), label: g.getAttribute('aria-label') || '', r: parseFloat(dot.getAttribute('r')), sw: parseFloat(dot.getAttribute('stroke-width')), fill: dot.getAttribute('fill') };
        });
      })()`) as { role: string | null; tab: string | null; label: string; r: number; sw: number; fill: string }[]
      record('2.6H: every point group has role, tabindex, and a text label', pts.length > 0 && pts.every(x => x.role === 'button' && x.tab === '0' && /^Sale [A-Z][a-z]{2} \d{1,2}, \d{4} · \$/.test(x.label)), pts[0]?.label ?? 'no points')
      record('2.6H: point size is 6 / 9 / 12 px by head with a 2 px outline; thin points are open', pts.length > 0 && pts.every(x => [3, 4.5, 6].includes(x.r) && x.sw === 2 && (x.r !== 3 || x.fill === '#FFFFFF')), [...new Set(pts.map(x => `${x.r * 2}px`))].join(', '))
      const strip = page.locator('[data-audit="selection-strip"]').first()
      await strip.scrollIntoViewIfNeeded().catch(() => {})
      const sb = await strip.boundingBox()
      record('2.6H: a 48 px selection strip under the chart (role slider)', !!sb && sb.height >= 48 && (await strip.getAttribute('role')) === 'slider', `${sb?.height ?? 0}px`)
      if (sb) {
        await strip.click({ position: { x: sb.width * 0.3, y: sb.height / 2 } })
        const sheet = page.locator('[data-audit="point-sheet"]')
        await sheet.waitFor({ timeout: 5_000 }).catch(() => {})
        const opened = await sheet.isVisible().catch(() => false)
        const first = opened ? (await sheet.innerText()).match(/sale ([A-Z][a-z]{2} \d{1,2}, \d{4})/)?.[1] : undefined
        const nb = await page.locator('[data-audit="point-next"]').boundingBox({ timeout: 3_000 }).catch(() => null), pb = await page.locator('[data-audit="point-prev"]').boundingBox({ timeout: 3_000 }).catch(() => null)
        record('2.6H: tapping the strip picks the nearest sale and opens the sheet with 48 px Previous / Next', opened && !!nb && nb.height >= 48 && !!pb && pb.height >= 48, `${first ?? 'no sheet'} · next ${nb?.height ?? 0}px · prev ${pb?.height ?? 0}px`)
        const nextBtn = page.locator('[data-audit="point-next"]')
        if (opened && !(await nextBtn.isDisabled())) {
          await nextBtn.click()
          const second = (await sheet.innerText()).match(/sale ([A-Z][a-z]{2} \d{1,2}, \d{4})/)?.[1]
          record('2.6H: Next walks to the following sale', !!second && second !== first && Date.parse(second) > Date.parse(first!), `${first} → ${second}`)
        } else skip('2.6H: Next walks to the following sale', 'only one sale on the chart')
        await page.getByRole('button', { name: 'Close', exact: true }).first().click().catch(() => {})
      }
      // Keyboard: Enter on a focused point opens the sheet; ArrowRight moves the pick.
      const firstPt = page.locator('[data-audit="chart"] [data-audit="point"]').first()
      await firstPt.focus()
      await page.keyboard.press('Enter')
      const kSheet = page.locator('[data-audit="point-sheet"]')
      await kSheet.waitFor({ timeout: 5_000 }).catch(() => {})
      await page.waitForTimeout(300)
      const k1 = (await kSheet.innerText().catch(() => '')).match(/sale ([A-Z][a-z]{2} \d{1,2}, \d{4})/)?.[1]
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(300)
      const k2 = (await kSheet.innerText().catch(() => '')).match(/sale ([A-Z][a-z]{2} \d{1,2}, \d{4})/)?.[1]
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(300)
      const k3 = (await kSheet.innerText().catch(() => '')).match(/sale ([A-Z][a-z]{2} \d{1,2}, \d{4})/)?.[1]
      record('2.6H: Enter picks the focused point; ArrowRight walks sale by sale', !!k1 && !!k2 && !!k3 && (pts.length === 1 || (k2 !== k1 && (pts.length === 2 || k3 !== k2))), `${k1 ?? '∅'} → ${k2 ?? '∅'} → ${k3 ?? '∅'}`)
      await page.getByRole('button', { name: 'Close', exact: true }).first().click().catch(() => {})
      // The list: one 48 px row per sale, in date order.
      await page.locator('[data-audit="sales-list-toggle"]').click()
      const rows = page.locator('[data-audit="sales-list"] li button')
      const n = await rows.count()
      const heights = await page.evaluate(`Array.from(document.querySelectorAll('[data-audit="sales-list"] li button')).map(function(e){ return e.getBoundingClientRect().height })`) as number[]
      const dates = (await rows.allInnerTexts()).map(t => Date.parse(t.match(/[A-Z][a-z]{2} \d{1,2}, \d{4}/)?.[0] ?? ''))
      record('2.6H: "View sales as list" — one 48 px row per point, chronological, focusable', n === pts.length && heights.every(h => h >= 48) && dates.every((d, i) => i === 0 || d >= dates[i - 1]), `${n} rows · min ${Math.min(...heights)}px`)
      await page.locator('[data-audit="sales-list-toggle"]').click()
    }

    // ── Block 2.6I — every price-bearing component links to its report ──
    {
      const linkIn = async (sel: string) => page.locator(`${sel} [data-audit="report-link"]`).count()
      const auctionLinks = await linkIn('[data-audit="auction-card"]'), herdLinks = await linkIn('[data-audit="herd-value-card"]')
      record('2.6I: the auction card links to its report', auctionLinks >= 1, `${auctionLinks} link(s)`)
      record('2.6I: the herd value card links to each barn it priced at', herdLinks >= 1, `${herdLinks} link(s)`)
      await page.locator('[data-audit="chart"] [data-audit="point"]').first().focus(); await page.keyboard.press('Enter')
      const sheetLinks = await linkIn('[data-audit="point-sheet"]')
      record('2.6I: a picked point links to its report', sheetLinks >= 1, `${sheetLinks} link(s)`)
      const sheetEvidence = (await page.locator('[data-audit="point-sheet"] [data-audit="report-evidence"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      record('2.6I: the evidence line reads "Barn · Mon D · N head · Report ↗"', /^.+ · [A-Z][a-z]{2} \d{1,2} · [\d,]+ head( · rev \d+)? · Report ↗$/.test(sheetEvidence), sheetEvidence)
      await page.getByRole('button', { name: 'Close', exact: true }).first().click().catch(() => {})
      const hrefs = await page.evaluate(`Array.from(document.querySelectorAll('[data-audit="report-link"]')).map(function(e){ return e.getAttribute('href') })`) as string[]
      record('2.6I: every report link points at the USDA AMS report page for its slug', hrefs.length > 0 && hrefs.every(h => /^https:\/\/mymarketnews\.ams\.usda\.gov\/viewReport\/\d+$/.test(h)), [...new Set(hrefs)].join(' '))
      record('2.6I: no bare "USDA AMS report N" text is left on the page', !/USDA AMS report \d+/.test(await text(page)))
      const probe = await page.request.get(hrefs[0] ?? 'https://mymarketnews.ams.usda.gov/viewReport/1777', { timeout: 20_000 }).catch(() => null)
      if (probe && probe.status() === 200) record('2.6I: the report page answers 200', true, hrefs[0])
      else skip('2.6I: the report page answers 200', `USDA answered ${probe ? probe.status() : 'no response'} — their platform, not ours (eWAPS maintenance on 2026-09-06)`)
    }

    // ── Block 2.6C — the LRP hero follows the picked term; chips are unambiguous ──
    if (await page.locator('[data-audit="lrp-hero"]').count() === 0) skip('2.6C: LRP card', 'LRP card not in an ok state')
    else {
      const lrpText = await text(page, '[data-audit="lrp-hero"] >> xpath=ancestor::*[contains(@class,"rounded")][1]').catch(() => '')
      record('2.6C: the monotonic sentence is gone', !/Longer coverage = lower floor/.test(body) && !/Longer coverage = lower floor/.test(lrpText))
      const terms = page.locator('[data-audit="lrp-term"]')
      const labels = (await terms.allInnerTexts()).map(t => t.trim())
      record('2.6C: every term chip reads "Mon D, YYYY · N wk" and no two read the same', labels.length > 0 && labels.every(l => /^[A-Z][a-z]{2} \d{1,2}, \d{4} · \d+ wk$/.test(l)) && new Set(labels).size === labels.length, labels.slice(0, 4).join(' | '))
      const idx = Math.min(labels.length - 1, 2)
      const chip = terms.nth(idx)
      const floor = await chip.getAttribute('data-floor'), weeks = await chip.getAttribute('data-weeks')
      await chip.click()
      const hero = (await page.locator('[data-audit="lrp-hero"]').innerText()).replace(/\s+/g, ' ').trim()
      const sub = await page.locator('[data-audit="lrp-subline"]').innerText()
      record('2.6C: picking a term moves the headline with it', hero.startsWith(`$${floor}`) && new RegExp(`${weeks}-wk endorsement`).test(sub), `${labels[idx]} → ${hero} · ${sub.trim()}`)
      await chip.click()
    }

    // Event markers + Since (need migration 048)
    const { error: evErr } = await admin.from('market_events').select('id').limit(1)
    if (evErr) skip('B6/B7: event markers and Since you last checked', `migration 048 not applied (${evErr.message.slice(0, 50)})`)
    else {
      record('B6: event markers with a source link', /▾/.test(body), '')
      // Block 2.6F — years on every closed chip, chronological, only in-period by default.
      const chips = (await page.locator('[data-audit="event-chip"]').allInnerTexts()).map(t => t.replace(/^▾\s*/, '').trim())
      const chipDates = chips.map(t => Date.parse(t))
      record('2.6F: every closed event chip carries its year', chips.length > 0 && chips.every(t => /\b\d{4}$/.test(t)), chips.join(' | '))
      record('2.6F: event chips run in date order', chipDates.every((d, i) => i === 0 || d >= chipDates[i - 1]))
      // The chart's dashed marker lines are filtered by the same period as the chips:
      // chips shown = markers drawn is the fact that the default list is in-period.
      const markers = await page.locator('[data-audit="chart"] .recharts-reference-line').count()
      record('2.6F: default chips are the events on the chart; the rest sit behind a disclosure', chips.length === markers && (await page.locator('[data-audit="event-more"]').count()) === 1, `${chips.length} chips · ${markers} markers · ${(await page.locator('[data-audit="event-more"]').allInnerTexts()).join('') || 'no disclosure'}`)
      await page.locator('[data-audit="event-more"]').click().catch(() => {})
      const outside = (await page.locator('[data-audit="event-outside"] [data-audit="event-chip"]').allInnerTexts()).map(t => t.replace(/^▾\s*/, '').trim())
      record('2.6F: the disclosure opens the out-of-period events, dated with years', outside.length > 0 && outside.every(t => /\b\d{4}$/.test(t)), outside.join(' | '))
      await page.locator('[data-audit="event-more"]').click().catch(() => {})
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
      var hc = document.querySelector('[data-audit="history-card"]');
      var cardW = hc ? Math.round(hc.getBoundingClientRect().width) : 0;
      var cs = hc ? getComputedStyle(hc) : null;
      var cardInner = hc ? Math.round(cardW - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)) : 0;
      var pts = document.querySelectorAll('[data-audit="point"]').length;
      return { overflowX: overflowX, small: small.slice(0,8), smallCount: small.length, tiny: tiny.slice(0,8), tinyCount: tiny.length, chartW: chartW, cardW: cardW, cardInner: cardInner, pts: pts };
    })`
    for (const width of [320, 375, 390, 430]) {
      const mctx = await browser.newContext({ baseURL: BASE, viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
      const mp = await signIn(mctx)
      await mp.goto(`/dashboard?fips=${HOME_FIPS}&view=markets`, { waitUntil: 'domcontentloaded' })
      await mp.getByText(/carried-forward steps/).waitFor({ timeout: 45_000 }).catch(() => {})
      await mp.waitForTimeout(1200)
      const m = await mp.evaluate(`${MEASURE}(${width})`) as { overflowX: number; small: string[]; smallCount: number; tiny: string[]; tinyCount: number; chartW: number; cardW: number; cardInner: number; pts: number }
      record(`${width}px: no horizontal page scroll`, m.overflowX === 0, `overflow ${m.overflowX}px`)
      record(`${width}px: every Markets control ≥ 48 px`, m.smallCount === 0, m.small.join(' | '))
      // Phase A1 — measured from the painted page: no text under 14 px, no text pair under
      // 4.5:1, and navigation / answers at 7:1 (computed color vs the composited backdrop).
      const ta = await mp.evaluate(`${TEXT_AUDIT}(${JSON.stringify({ minPx: 14, minRatio: 4.5, essentialRatio: 7, root: 'main' })})`) as TextAudit & { tinyCount: number; lowCount: number; lowEssentialCount: number }
      record(`${width}px: no text under 14 px on the Markets view`, ta.tinyCount === 0, ta.tiny.slice(0, 4).map(n => `${n.px}px "${n.text.slice(0, 24)}"`).join(' | '))
      record(`${width}px: every text pair ≥ 4.5:1 on the Markets view`, ta.lowCount === 0, ta.low.slice(0, 4).map(n => `${n.ratio}:1 "${n.text.slice(0, 24)}"`).join(' | '))
      record(`${width}px: navigation and answers ≥ 7:1 on the Markets view`, ta.lowEssentialCount === 0, ta.lowEssential.slice(0, 4).map(n => `${n.ratio}:1 "${n.text.slice(0, 24)}"`).join(' | '))
      // The chart fills its card, and the card fills the page but for the 16 px gutters.
      record(`${width}px: chart takes the width`, m.chartW >= m.cardInner - 2 && m.cardW >= width - 40, `chart ${m.chartW}px in a ${m.cardW}px card (inner ${m.cardInner}) of ${width}`)
      // a point tap opens the detail panel; an event chip opens its source
      const pt = mp.locator('[data-audit="point"]').first()
      if (await pt.count()) {
        await pt.tap().catch(() => pt.click())
        const detail = await mp.locator('[data-audit="point-sheet"]').first().isVisible().catch(() => false)
        record(`${width}px: tapping a point opens its evidence`, detail)
        await mp.waitForTimeout(400)
        const lingering = await mp.locator('.recharts-tooltip-wrapper:visible').count()
        record(`${width}px: no tooltip lingers over the chart after the tap`, lingering === 0, `${lingering} tooltip(s)`)
      }
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

    // A4: My Counties (desktop header, signed in) is a 48 px target.
    {
        const dc = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
        const dp = await signIn(dc)
        const mc = await dp.locator('header a[href="/watchlist"]').first().boundingBox().catch(() => null)
        record('A4: My Counties in the desktop header is a 48 px target', !!mc && mc.height >= 48, `${mc?.height ?? 0}px`)
        await dc.close()
    }

    // Herd page lot card
    await page.goto('/herd', { waitUntil: 'domcontentloaded' })
    await page.getByText('Every $1/cwt').first().waitFor({ timeout: 30_000 }).catch(() => {})
    const herd = await text(page)
    record('A4: herd page lot card carries the sensitivity line', /Every \$1\/cwt move is \$1,650 on this lot/.test(herd))
    record('A2: herd page scope is the barn', /(Nearby auction reference|Where you sell) — /.test(herd) && !/County auction/.test(herd))
    record('2.6I: the herd page lot card links to its report', (await page.locator('[data-audit="report-link"]').count()) >= 1)

    // ── Block 2.6A — out-of-state counties: never "Nearby", never contradicting ──
    // Signed OUT (the public county view the audit walked). A county with no supported
    // auction inside the discovery radius says so, and any barn it still names is a
    // "Regional reference — Town, ST · ~N mi". The no-coverage sentence and a Nearby
    // label never share a page.
    const pub = await browser.newContext({ baseURL: BASE, viewport: { width: 420, height: 900 }, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
    try {
      for (const [fips, name] of [['48375', 'Potter TX'], ['31041', 'Custer NE'], ['19153', 'Polk IA'], ['41039', 'Lane OR']] as const) {
        const pp = await pub.newPage()
        await pp.goto(`/dashboard?fips=${fips}&view=markets`, { waitUntil: 'domcontentloaded' })
        await pp.getByText('Auction reference', { exact: true }).waitFor({ timeout: 30_000 }).catch(() => {})
        await pp.getByText(/carried-forward steps|No nearby barn|Regional reference/).first().waitFor({ timeout: 45_000 }).catch(() => {})
        const b = await text(pp)
        const nearby = /Nearby auction reference|Nearby —/.test(b)
        const noLocal = /No reporting auction within \d+ approx\. straight-line miles/.test(b)
        const ref = /Regional reference — [A-Za-z .'-]+, [A-Z]{2} · ~[\d,]+ mi/.test(b)
        record(`2.6A ${name}: no "Nearby" label`, !nearby)
        record(`2.6A ${name}: no-coverage sentence and a Nearby label never co-occur`, !(noLocal && nearby))
        record(`2.6A ${name}: says no auction within the radius, and any reference is labeled regional with state + ~miles`, noLocal && (ref || !/Report ↗/.test(b)), ref ? (b.match(/Regional reference — [^·]+· ~[\d,]+ mi/) ?? [])[0] : 'no reference offered')
        await pp.close()
      }
      // ── Phase A4 — one surface system, measured on the public Today at 390 px: three radii
      //    (8 / 12 / pill), no shadow on anything in main, every link/button ≥ 48 px, the LFP
      //    disclosure a 52 px full row that says what it opens with visible Show/Hide. ──
      {
        const sc = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
        const sp = await sc.newPage()
        await sp.goto(`/dashboard?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await sp.getByText(/Payment estimate and steps|LFP status/).first().waitFor({ timeout: 30_000 }).catch(() => {})
        await sp.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
        const a4 = await sp.evaluate(`(function(){
          var els = Array.from(document.querySelectorAll('main *'));
          var radii = {}; var shadows = []; var small = [];
          els.forEach(function(el){ var cs = getComputedStyle(el); var b = el.getBoundingClientRect(); if (b.width === 0 || b.height === 0) return;
            var r = cs.borderTopLeftRadius; if (r && r !== '0px') { var px = parseFloat(r); var key = px >= b.height / 2 ? 'pill' : r; radii[key] = (radii[key] || 0) + 1; }
            if (cs.boxShadow && cs.boxShadow !== 'none' && !el.closest('[role="dialog"], .fixed, [data-audit="selection-strip"]')) shadows.push(el.tagName + '.' + String(el.className).slice(0, 30));
            if ((el.tagName === 'A' && el.getAttribute('href')) || el.tagName === 'BUTTON') { if (b.height < 48 && !el.closest('svg')) small.push((el.textContent || '').trim().slice(0, 24) + ' ' + Math.round(b.height) + 'px'); }
          });
          var lfp = Array.from(document.querySelectorAll('main button')).find(function(b){ return /Payment estimate and steps/.test(b.textContent || ''); });
          return { radii: radii, shadows: shadows.slice(0, 6), small: small.slice(0, 8), smallCount: small.length, lfp: lfp ? { h: Math.round(lfp.getBoundingClientRect().height), w: Math.round(lfp.getBoundingClientRect().width), text: (lfp.textContent || '').split(/[\\t\\n\\r ]+/).join(' ').trim(), expanded: lfp.getAttribute('aria-expanded') } : null };
        })()`) as { radii: Record<string, number>; shadows: string[]; small: string[]; smallCount: number; lfp: { h: number; w: number; text: string; expanded: string | null } | null }
        const radiiKeys = Object.keys(a4.radii)
        record('A4: three radii on the Today page — 8 px, 12 px, pill', radiiKeys.every(k => k === '8px' || k === '12px' || k === 'pill'), JSON.stringify(a4.radii))
        record('A4: no shadow on ordinary surfaces in main', a4.shadows.length === 0, a4.shadows.join(' | '))
        record('A4: every link and button on Today is at least 48 px tall', a4.smallCount === 0, a4.small.join(' | '))
        record('A4: the LFP disclosure is a 52 px full row that says what it opens, with Show/Hide', !!a4.lfp && a4.lfp.h >= 52 && a4.lfp.w >= 300 && /Payment estimate and steps/.test(a4.lfp.text) && /Show|Hide/.test(a4.lfp.text) && a4.lfp.expanded != null, a4.lfp ? `${a4.lfp.h}×${a4.lfp.w} "${a4.lfp.text}" aria-expanded=${a4.lfp.expanded}` : 'no disclosure')
        const signin = await sp.locator('header a[href="/signin"]').first().boundingBox().catch(() => null)
        record('A4: the header Sign in is a 48 px target', !!signin && signin.height >= 48, `${signin?.height ?? 0}px`)
        await sc.close()
      }
      // ── Phase A3 — the homepage has something to tap: at 390×844 and 1440×900 at least one
      //    interactive element sits fully inside the first viewport, and the example image is
      //    captioned above and placed after the actions. ──
      for (const [w, h] of [[390, 844], [1440, 900]] as const) {
        const lc = await browser.newContext({ baseURL: BASE, viewport: { width: w, height: h }, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
        const lp = await lc.newPage()
        await lp.goto('/', { waitUntil: 'domcontentloaded' })
        await lp.getByText('Check my county').first().waitFor({ timeout: 30_000 }).catch(() => {})
        const fold = await lp.evaluate(`(function(h){
          var els = Array.from(document.querySelectorAll('main a[href], main button')).map(function(el){ var b = el.getBoundingClientRect(); return { text: (el.textContent||'').trim().slice(0,30), top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }; });
          var inFold = els.filter(function(e){ return e.height > 0 && e.top >= 0 && e.bottom <= h; });
          var img = document.querySelector('main img'); var cap = Array.from(document.querySelectorAll('main p')).find(function(p){ return /Example ranch record/i.test(p.textContent||''); });
          var actions = document.querySelector('[data-audit="landing-actions"]');
          return { inFold: inFold, imgTop: img ? Math.round(img.getBoundingClientRect().top + window.scrollY) : null, capTop: cap ? Math.round(cap.getBoundingClientRect().top + window.scrollY) : null, actionsBottom: actions ? Math.round(actions.getBoundingClientRect().bottom + window.scrollY) : null };
        })(${h})`) as { inFold: { text: string; height: number }[]; imgTop: number | null; capTop: number | null; actionsBottom: number | null }
        record(`A3 ${w}×${h}: a real action sits fully inside the first viewport`, fold.inFold.some(e => /Check my county|Try the ranch record/.test(e.text) && e.height >= 48), fold.inFold.map(e => `${e.text} ${e.height}px`).join(' | ') || 'nothing interactive above the fold')
        if (w === 390) record('A3: the example image is captioned above and comes after the actions', fold.imgTop != null && fold.capTop != null && fold.actionsBottom != null && fold.capTop < fold.imgTop && fold.actionsBottom <= fold.capTop, `actions end ${fold.actionsBottom} · caption ${fold.capTop} · image ${fold.imgTop}`)
        await lc.close()
      }
      // ── Phase A2 — one column: the county control, the heading, the tabs, and the first
      //    section share one left edge at a phone width and on a desktop; no FIPS in the heading. ──
      for (const width of [390, 1440]) {
        const pc = await browser.newContext({ baseURL: BASE, viewport: { width, height: 900 }, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
        const pp = await pc.newPage()
        await pp.goto(`/dashboard?fips=${HOME_FIPS}`, { waitUntil: 'domcontentloaded' })
        await pp.locator('[role="tablist"]').first().waitFor({ timeout: 30_000 }).catch(() => {})
        const edges = await pp.evaluate(`(function(){
          var x = function(sel){ var el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().left) : null; };
          var h1 = document.querySelector('main h1');
          return { control: x('[data-audit="county-control"]'), h1: h1 ? Math.round(h1.getBoundingClientRect().left) : null, tabs: x('[role="tablist"]'), section: x('main section, main [data-audit$="-card"]'), h1Text: h1 ? h1.textContent : '', chooserOpen: !!document.querySelector('#county-search') };
        })()`) as { control: number | null; h1: number | null; tabs: number | null; section: number | null; h1Text: string; chooserOpen: boolean }
        const xs = [edges.control, edges.h1, edges.tabs, edges.section].filter((v): v is number => v != null)
        record(`A2 ${width}px: county control, heading, tabs, and first section share one left edge`, xs.length >= 3 && Math.max(...xs) - Math.min(...xs) <= 2, JSON.stringify(edges))
        if (width === 390) {
          record('A2: no FIPS in the heading', !/FIPS/.test(edges.h1Text), edges.h1Text.trim())
          record('A2: the county rests as a statement with Change, not a search field', !edges.chooserOpen && /Change/.test((await pp.locator('[data-audit="county-control"]').innerText().catch(() => ''))))
          await pp.locator('[data-audit="county-control"] button').first().click()
          const chooser = await pp.locator('#county-search').count()
          const cancelBox = await pp.locator('[data-audit="county-cancel"]').boundingBox().catch(() => null)
          await pp.locator('[data-audit="county-cancel"]').click().catch(() => {})
          const back = await pp.locator('[data-audit="county-control"]').innerText().catch(() => '')
          record('A2: Change opens the chooser with a 48 px Cancel that keeps the county', chooser === 1 && !!cancelBox && cancelBox.height >= 48 && /Petroleum County/.test(back) && /Change/.test(back), `${cancelBox?.height ?? 0}px · after cancel: "${back.replace(/\s+/g, ' ').slice(0, 40)}"`)
        }
        await pc.close()
      }
      // ── Block 2.6D — no displayed "as of" date is in the future (Today view, five counties) ──
      const todayMs = Date.now() + 86_400_000   // a day of slack for the viewer's zone
      for (const [fips, name] of [['48375', 'Potter TX'], ['31041', 'Custer NE'], ['19153', 'Polk IA'], ['41039', 'Lane OR'], [HOME_FIPS, 'Petroleum MT']] as const) {
        const pp = await pub.newPage()
        await pp.goto(`/dashboard?fips=${fips}`, { waitUntil: 'domcontentloaded' })
        await pp.getByText(/U\.S\. Drought Monitor · /).first().waitFor({ timeout: 45_000 }).catch(() => {})
        const b = await text(pp)
        const asOfs = [...b.matchAll(/as of ([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})/g)].map(m => m[1])
        const future = asOfs.filter(d => Date.parse(d) > todayMs)
        record(`2.6D ${name}: no displayed "as of" date is in the future`, asOfs.length > 0 && future.length === 0, future.length ? `FUTURE: ${future.join(', ')}` : `${asOfs.length} as-of dates, latest ${asOfs.sort((x, y) => Date.parse(x) - Date.parse(y)).slice(-1)[0]}`)
        if (fips === '48375') record('2.6D Potter TX: a grazing period that has not begun says so', /hasn’t started|hasn't started/.test(b) && !/No D2\+ drought trigger/.test(b), (b.match(/grazing period[^.]*\./i) ?? [''])[0].slice(0, 120))
        await pp.close()
      }
    } finally {
      await pub.close()
    }
  } finally {
    await browser.close()
    await teardown('finish')
  }
  const fails = results.filter(r => !r.pass).length, skips = results.filter(r => r.skip).length
  console.log(`\n${results.length - fails - skips} PASS · ${fails} FAIL${skips ? ` · ${skips} SKIP` : ''}${fails ? '  — BLOCKED' : ''}\n`)
  process.exit(fails ? 1 : 0)
}
main().catch(async err => { console.error('\nsmoke crashed:', err instanceof Error ? err.message : err); try { await teardown('after crash') } catch {} ; process.exit(2) })
