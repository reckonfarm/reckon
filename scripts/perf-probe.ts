// ─── What the ranch's own pages cost, measured ───────────────────────────────
// READ-ONLY, on PK's instruction. Two halves, because they answer two different
// questions and neither answers the other's:
//
//   BROWSER  — what PK's phone actually waits for on production: time to first
//              paint, largest paint, how long the main thread is blocked after
//              it, and when the page's own control is there to tap. Run against
//              www.dryline.farm, signed in through the app's own callback.
//   READS    — what the server asks the database for, per page: every PostgREST
//              round-trip the page's read functions make, how many, and how long
//              the slowest takes. Executed here with PK's own session, so RLS is
//              on and the row counts are his. Absolute ms include this machine's
//              latency to Supabase — read the COUNTS and the ORDER as fact, the
//              milliseconds as relative.
//
//   BASE=https://www.dryline.farm npx tsx scripts/perf-probe.ts            both
//   ONLY=reads|browser  to run one half · THROTTLE=0 to skip the slow-phone pass
//
// Writes nothing. Creates no fixtures. Signs in with a magic link minted by the
// service role for PK's own account and never leaves a record behind.
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

for (const f of ['.env', '.env.local', 'e2e/.env.e2e']) {
  const p = resolve(process.cwd(), f)
  if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BASE = process.env.BASE ?? 'https://www.dryline.farm'
const OWNER = process.env.OWNER ?? 'kiehl.preston@gmail.com'
const ONLY = process.env.ONLY ?? ''

// ── Every Supabase round-trip, timed ────────────────────────────────────────
// Patched before any lib is imported, so a read cannot make a request this
// does not see. `mark` names the read that is running; a request with no mark
// belongs to the probe itself and is ignored.
interface Call { mark: string; table: string; ms: number; bytes: number }
const calls: Call[] = []
let mark = ''
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof realFetch>[0], init?: Parameters<typeof realFetch>[1]) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
  const t0 = performance.now()
  const res = await realFetch(input as Parameters<typeof realFetch>[0], init)
  const ms = performance.now() - t0
  if (mark && url.startsWith(URL_)) {
    const path = url.slice(URL_.length).replace(/^\/rest\/v1\//, '').replace(/^\/auth\/v1\//, 'auth/')
    const table = path.split('?')[0]
    const q = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
    const clone = res.clone()
    const bytes = Number(res.headers.get('content-length') ?? 0) || (await clone.arrayBuffer().then(b => b.byteLength).catch(() => 0))
    calls.push({ mark, table: q ? `${table}?${q.slice(0, 90)}` : table, ms, bytes })
  }
  return res
}) as typeof fetch

const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

async function ownerSession(): Promise<{ client: SupabaseClient; userId: string; accessToken: string }> {
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: OWNER })
  const hash = link.data?.properties?.hashed_token
  if (!hash) throw new Error(`generateLink: ${link.error?.message ?? 'no token'}`)
  const client = createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await client.auth.verifyOtp({ token_hash: hash, type: 'magiclink' })
  if (error || !data.session) throw new Error(`verifyOtp: ${error?.message ?? 'no session'}`)
  return { client, userId: data.session.user.id, accessToken: data.session.access_token }
}

const ms = (n: number) => `${n.toFixed(0)} ms`

// ── Half one: what the server asks for, per page ────────────────────────────
async function reads(s: SupabaseClient, userId: string) {
  const { ranchView } = await import('../lib/ranch-view')
  const { getRanchLots, lotPurposeSupported } = await import('../lib/herd-lots')
  const { lastWorkByLot, whereByLot } = await import('../lib/ranch-summary')
  const { listActivity, entriesToday } = await import('../lib/activity')
  const { listWork } = await import('../lib/jobs/work')
  const { ledgerThrough } = await import('../lib/ledger-through')
  const { getRanchMap } = await import('../lib/ranch-map')
  const { getHayLedger } = await import('../lib/hay/queries')
  const { getRainLedger } = await import('../lib/rain/queries')
  const { readFollowed } = await import('../lib/herd-follow')

  const lots = await getRanchLots(s, userId).catch(() => [])
  const lotIds = lots.map(l => l.id)

  // Each entry is one read the page awaits, named as the page names it.
  const page: Record<string, [string, () => Promise<unknown>][]> = {
    Ranch: [
      ['ledgerThrough', () => ledgerThrough(s)],
      ['ranchView', () => ranchView(s, userId)],
      ['getRanchLots', () => getRanchLots(s, userId)],
      ['entriesToday', () => entriesToday(s)],
      ['listActivity(page 1)', () => listActivity(s, userId, {}, null)],
      ['listWork(60)', () => listWork(s, { limit: 60 })],
      ['lastWorkByLot', () => lastWorkByLot(s, lotIds)],
      ['whereByLot', () => whereByLot(s, lots)],
      ['lotPurposeSupported', () => lotPurposeSupported(s)],
      ['readFollowed', () => readFollowed(s, userId)],
    ],
    Cattle: [
      ['getRanchLots', () => getRanchLots(s, userId)],
      ['lastWorkByLot', () => lastWorkByLot(s, lotIds)],
      ['whereByLot', () => whereByLot(s, lots)],
      ['lotPurposeSupported', () => lotPurposeSupported(s)],
      ['readFollowed', () => readFollowed(s, userId)],
    ],
    Today: [
      ['ledgerThrough', () => ledgerThrough(s)],
      ['getRanchMap', () => getRanchMap(s, userId)],
      ['getHayLedger', () => getHayLedger(s, {})],
      ['entriesToday', () => entriesToday(s)],
      ['listWork(20)', () => listWork(s, { limit: 20 })],
    ],
    Markets: [
      ['getRanchLots', () => getRanchLots(s, userId)],
      ['readFollowed', () => readFollowed(s, userId)],
      ['getRainLedger', () => getRainLedger(s)],
    ],
  }

  for (const [name, list] of Object.entries(page)) {
    console.log(`\n── ${name} ─────────────────────────────────────────────`)
    const before = calls.length
    const t0 = performance.now()
    for (const [label, run] of list) {
      mark = label
      const t1 = performance.now()
      const n0 = calls.length
      await run().catch((e: unknown) => console.log(`   ${label}: FAILED ${e instanceof Error ? e.message : e}`))
      const wall = performance.now() - t1
      const mine = calls.slice(n0)
      const slow = mine.slice().sort((a, b) => b.ms - a.ms)[0]
      console.log(`   ${label.padEnd(22)} ${ms(wall).padStart(8)}  ${String(mine.length).padStart(2)} quer${mine.length === 1 ? 'y' : 'ies'}` +
        (slow ? `  slowest ${ms(slow.ms)} ${slow.table.slice(0, 64)}` : ''))
    }
    mark = ''
    const mine = calls.slice(before)
    const total = performance.now() - t0
    const bytes = mine.reduce((n, c) => n + c.bytes, 0)
    console.log(`   ${'TOTAL'.padEnd(22)} ${ms(total).padStart(8)}  ${mine.length} queries · ${(bytes / 1024).toFixed(0)} KB`)
    const worst = mine.slice().sort((a, b) => b.ms - a.ms).slice(0, 3)
    for (const w of worst) console.log(`      ${ms(w.ms).padStart(8)}  ${w.mark} → ${w.table.slice(0, 90)}`)
  }
}

// ── Half two: what the phone waits for ──────────────────────────────────────
async function browser(accessToken: string) {
  const { chromium } = await import('@playwright/test')
  const BYPASS = process.env.VERCEL_BYPASS ?? ''
  void accessToken

  for (const slow of process.env.THROTTLE === '0' ? [false] : [false, true]) {
    // A magic link is single-use: each pass mints its own, or the second pass
    // measures the sign-in page and calls every control missing.
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: OWNER })
    const hash = link.data?.properties?.hashed_token
    if (!hash) throw new Error('generateLink (browser): no token')
    const b = await chromium.launch()
    const ctx = await b.newContext({
      baseURL: BASE,
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {},
    })
    const page = await ctx.newPage()
    if (slow) {
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    }
    // Sign in through the app's own callback, exactly as a person does.
    await page.goto(`/auth/callback?token_hash=${hash}&type=magiclink&next=/today`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 30_000 }).catch(() => {})
    // Identity before content: a pass that is not signed in measures /signin.
    if (/\/signin/.test(page.url())) { console.log(`   NOT SIGNED IN (${page.url().replace(BASE, '')}) — this pass measures nothing`); await b.close(); continue }

    console.log(`\n── browser ${slow ? '· slow phone (4× CPU, 1.6 Mbps, 150 ms)' : '· as fast as this machine goes'} ──`)
    console.log(`   page            TTFB      FCP      LCP   blocked   usable   JS`)
    const pages: [string, string, string][] = [
      ['Today', '/today', '[data-audit="ranch-map-card"], [data-audit="repeat-last"], main'],
      ['Ranch', '/ranch', '[data-audit="ranch-numbers"]'],
      ['Cattle', '/ranch/cattle', '[data-audit="lot-row"], [data-audit="new-bunch-button"]'],
      ['Markets', '/markets', '[data-audit="markets-title"]'],
    ]
    for (const [name, path, usableSel] of pages) {
      await page.goto('about:blank')
      await page.addInitScript(`
        window.__lcp = 0; window.__tbt = 0;
        new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.duration > 50) window.__tbt += e.duration - 50 }).observe({ type: 'longtask', buffered: true });
      `)
      const t0 = Date.now()
      await page.goto(path, { waitUntil: 'commit' })
      let usable = -1
      await page.locator(usableSel).first().waitFor({ state: 'visible', timeout: 45_000 }).then(() => { usable = Date.now() - t0 }).catch(() => {})
      await page.waitForLoadState('load', { timeout: 45_000 }).catch(() => {})
      await page.waitForTimeout(1200)   // let LCP and long tasks settle
      const m = await page.evaluate(`(function(){
        var n = performance.getEntriesByType('navigation')[0] || {};
        var fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime || 0;
        var js = performance.getEntriesByType('resource').filter(function(r){ return /\\.js(\\?|$)/.test(r.name) });
        return { ttfb: n.responseStart || 0, fcp: fcp, lcp: window.__lcp || 0, tbt: window.__tbt || 0,
                 jsCount: js.length, jsKb: js.reduce(function(s,r){ return s + (r.transferSize || 0) }, 0) / 1024 };
      })()`) as { ttfb: number; fcp: number; lcp: number; tbt: number; jsCount: number; jsKb: number }
      console.log(`   ${name.padEnd(12)} ${ms(m.ttfb).padStart(8)} ${ms(m.fcp).padStart(8)} ${ms(m.lcp).padStart(8)} ${ms(m.tbt).padStart(9)} ${(usable < 0 ? 'never' : ms(usable)).padStart(8)}   ${m.jsCount} files ${m.jsKb.toFixed(0)} KB`)
    }
    await b.close()
  }
}

async function main() {
  console.log(`\nDryline — what the pages cost  (${BASE}, signed in as ${OWNER})`)
  const { client, userId, accessToken } = await ownerSession()
  if (ONLY !== 'browser') await reads(client, userId)
  if (ONLY !== 'reads') await browser(accessToken)
  console.log('')
}
main().catch(e => { console.error('\nprobe crashed:', e instanceof Error ? e.message : e); process.exit(1) })
