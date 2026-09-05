// ─── Markets mobile audit — measure the rendered layout at phone widths ────────
// Signs in as a synthetic member with one lot, loads the Markets view at each
// width, and MEASURES: horizontal page overflow, every control's rendered
// height/width, computed font sizes of secondary text, the chart's SVG width,
// the legend's share of the card, the size of point hit targets and event
// markers. Screenshots each width. Read-only apart from the synthetic member.
//
//   BASE=https://<preview> OUT=/path/dir npx tsx scripts/audit-markets-mobile.ts
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium, type Page } from '@playwright/test'
for (const f of ['.env', '.env.local', 'e2e/.env.e2e']) { const p = resolve(process.cwd(), f); if (!existsSync(p)) continue; for (const line of readFileSync(p, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '') } }
const BASE = process.env.BASE ?? 'https://www.dryline.farm'
const OUT = process.env.OUT ?? 'audit-out'
const BYPASS = BASE.includes('vercel.app') ? process.env.VERCEL_BYPASS : undefined
const WIDTHS = (process.env.WIDTHS ?? '320,375,390,430').split(',').map(Number)
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
const EMAIL = 'audit-markets@dryline.farm'
mkdirSync(OUT, { recursive: true })
async function wipe() { const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 }); for (const u of users?.users ?? []) if (u.email === EMAIL) { for (const t of ['events','places','operation_profiles','ranch_members']) await admin.from(t).delete().eq('user_id', u.id); await admin.from('profiles').delete().eq('id', u.id); await admin.auth.admin.deleteUser(u.id) } await admin.from('ranches').delete().like('name', 'AUDIT-MARKETS%') }
async function seed() {
  const { data: created } = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true }); const userId = created.user!.id
  const { data: ranch } = await admin.from('ranches').insert({ name: 'AUDIT-MARKETS ranch' }).select('id').single()
  await admin.from('ranch_members').insert({ ranch_id: ranch!.id, user_id: userId, role: 'owner' })
  await admin.from('profiles').upsert({ id: userId, email: EMAIL, home_county_fips: '30069' })
  await admin.from('operation_profiles').insert({ user_id: userId, county_fips: '30069', herd: { lots: [{ id: 'audit-steers', class: 'steers', head_count: 300, avg_weight: 550, weight_unit: 'lb', frame: 'Medium and Large', weaned: true, sale_windows: [], created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' }] } })
}
type Box = { x: number; y: number; w: number; h: number }
interface Measure {
  overflowX: number; wideEls: string[]; controlsTotal: number; small: (Box & { text: string })[]
  smallTextSample: { tag: string; size: number; text: string }[]; smallTextCount: number
  svgs: Box[]; circles: { count: number; minDiameter: number | null }; cardBox: Box | null; legend: Box | null; scopeFont: number | null
}
// Plain JS, evaluated by string: tsx's bundler would otherwise inject a __name
// helper into a serialized function and the page has no such symbol.
const MEASURE = `(function(width){
  var r = function(el){ var b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } };
  var fs = function(el){ return parseFloat(getComputedStyle(el).fontSize) };
  var overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  var wideEls = Array.from(document.querySelectorAll('main *')).filter(function(el){ var b = el.getBoundingClientRect(); return b.right > width + 1 && b.width > 0 }).slice(0, 8).map(function(el){ return el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.') + ' right=' + Math.round(el.getBoundingClientRect().right) });
  var controls = Array.from(document.querySelectorAll('main button, main select, main a[href]')).map(function(el){ var b = r(el); b.text = (el.textContent || '').trim().slice(0, 28); return b }).filter(function(c){ return c.h > 0 });
  var small = controls.filter(function(c){ return c.h < 48 || (c.w < 48 && c.text.length < 3) });
  var smallText = Array.from(document.querySelectorAll('main p, main span, main li, main text, main tspan, main label')).map(function(el){ return { tag: el.tagName.toLowerCase(), size: fs(el), text: (el.textContent || '').trim().slice(0, 40) } }).filter(function(t){ return t.size > 0 && t.size < 15 && t.text.length > 0 });
  var svgs = Array.from(document.querySelectorAll('main svg.recharts-surface')).map(r);
  var circles = Array.from(document.querySelectorAll('main svg circle')).map(function(c){ return Math.round(parseFloat(c.getAttribute('r') || '0') * 2) });
  var card = document.querySelector('main [data-audit="history-card"]');
  var cardBox = card ? r(card) : null;
  var legend = card ? (Array.from(card.querySelectorAll('ul')).map(r).sort(function(a, b){ return b.h - a.h })[0] || null) : null;
  var scope = Array.from(document.querySelectorAll('main p')).filter(function(p){ return /Nearby auction reference|Where you sell/.test(p.textContent || '') })[0];
  return { overflowX: overflowX, wideEls: wideEls, controlsTotal: controls.length, small: small, smallTextSample: smallText.slice(0, 12), smallTextCount: smallText.length, svgs: svgs, circles: { count: circles.length, minDiameter: circles.length ? Math.min.apply(null, circles) : null }, cardBox: cardBox, legend: legend, scopeFont: scope ? fs(scope) : null };
})`
async function measure(page: Page, width: number): Promise<Measure> {
  return page.evaluate(`${MEASURE}(${width})`) as Promise<Measure>
}
async function main() {
  await wipe(); await seed()
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  const browser = await chromium.launch()
  try {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ baseURL: BASE, viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
      const page = await ctx.newPage()
      const l = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
      await page.goto(`/auth/callback?token_hash=${l.data!.properties!.hashed_token}&type=magiclink&next=/dashboard`, { waitUntil: 'domcontentloaded' })
      await page.waitForURL(u => u.pathname.startsWith('/dashboard'), { timeout: 15000 }).catch(() => {})
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
      await page.locator('header').getByText(EMAIL).waitFor({ state: 'attached', timeout: 45000 })
      await page.goto('/dashboard?fips=30069&view=markets', { waitUntil: 'domcontentloaded' })
      await page.getByText(/carried-forward steps/).waitFor({ timeout: 45000 }).catch(() => {})
      await page.waitForTimeout(1500)
      const m = await measure(page, width)
      console.log(`\n=== ${width}px ===`)
      console.log(`overflowX ${m.overflowX}px${m.wideEls.length ? '  wide: ' + m.wideEls.join(' | ') : ''}`)
      console.log(`controls ${m.controlsTotal}; under 48px: ${m.small.length}` + (m.small.length ? '\n   ' + m.small.map(c => `"${c.text}" ${c.w}×${c.h}`).join('\n   ') : ''))
      console.log(`text under 15px: ${m.smallTextCount}` + (m.smallTextCount ? '\n   ' + m.smallTextSample.map(t => `${t.tag} ${t.size}px "${t.text}"`).join('\n   ') : ''))
      console.log(`chart svg: ${m.svgs.map(s => `${s.w}×${s.h}`).join(', ') || 'none'}; card ${m.cardBox ? `${m.cardBox.w}×${m.cardBox.h}` : '?'}; legend ${m.legend ? `${m.legend.w}×${m.legend.h} (${m.cardBox ? Math.round(100 * m.legend.h / m.cardBox.h) : '?'}% of card)` : 'none'}; points ${m.circles.count}, min hit ${m.circles.minDiameter}px; scope font ${m.scopeFont}px`)
      await page.screenshot({ path: `${OUT}/markets-${width}.png`, fullPage: true })
      const hist = page.locator('[data-audit="history-card"]')
      if (await hist.count()) await hist.screenshot({ path: `${OUT}/history-${width}.png` })
      await ctx.close()
    }
  } finally { await browser.close(); await wipe() }
}
main().catch(e => { console.error(e.message?.slice(0, 300)); process.exit(1) })
