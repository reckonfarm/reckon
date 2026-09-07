// ─── Rendered text audit — Phase A1 before/after ──────────────────────────────
// Opens the main public surfaces at 320 / 375 / 390 / 430 px and reports, from
// the painted page (computed color against the composited backdrop), every
// text node under 14 px and every text pair under 4.5:1, plus the specific
// samples the audit named. Read-only.
//
//   BASE=https://www.dryline.farm npx tsx scripts/audit-text.ts            # before
//   BASE=http://localhost:3100    npx tsx scripts/audit-text.ts            # after (local next start)
//   BASE=https://<preview>.vercel.app npx tsx scripts/audit-text.ts

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type BrowserContext } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { TEXT_AUDIT, type TextAudit, type TextNode } from './lib/text-audit'

for (const f of ['.env.local', 'e2e/.env.e2e']) { const p = resolve(process.cwd(), f); if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '') } }
const BASE = process.env.BASE ?? 'https://www.dryline.farm'
const BYPASS = BASE.includes('vercel.app') ? process.env.VERCEL_BYPASS : undefined
const WIDTHS = [320, 375, 390, 430]
const SURFACES: [string, string, string[]][] = [
  ['landing', '/', ['Example ranch', 'Check county', 'Join the winter pilot']],
  ['today', '/dashboard?fips=30069', ['U.S. Drought Monitor', 'FIPS', 'Next USDA deadline', 'as of']],
  ['weather', '/dashboard?fips=30069&view=weather', ['7-day', 'NWS', 'National Weather Service', 'as of']],
  ['markets', '/dashboard?fips=30069&view=markets', ['Report', 'head reported', 'sale']],
]
const SAMPLES_NAMED = ['U.S. Drought Monitor', 'FIPS', '7-day forecast', 'NWS', 'National Weather Service', 'My Counties', 'Example ranch']
// SIGNIN=testranch samples the signed-in chrome too (header links such as My Counties) as the Test Ranch owner — read-only.
const SIGNIN = process.env.SIGNIN === 'testranch' ? 'kiehl.preston+testranch@gmail.com' : null
async function signIn(ctx: BrowserContext) {
  if (!SIGNIN) return
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: SIGNIN })
  const p = await ctx.newPage()
  await p.goto(`/auth/callback?token_hash=${link.data!.properties!.hashed_token}&type=magiclink&next=/dashboard`, { waitUntil: 'domcontentloaded' })
  await p.waitForURL(u => u.pathname.startsWith('/dashboard'), { timeout: 20_000 }).catch(() => {})
  await p.close()
}

type Row = { surface: string; width: number; sample: string; text: string; px: number; color: string; bg: string; ratio: number }

async function main() {
  console.log(`\nDryline — rendered text audit (${BASE})\n`)
  const browser = await chromium.launch()
  const rows: Row[] = []
  let tinyTotal = 0, lowTotal = 0, lowEssTotal = 0, nodes = 0
  const worst: TextNode[] = []
  const essentialSeen = new Set<string>()
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width, height: 900 }, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
    await signIn(ctx)
    const page = await ctx.newPage()
    for (const [name, path, waits] of SURFACES) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      for (const w of waits) await page.getByText(new RegExp(w, 'i')).first().waitFor({ timeout: 20_000 }).catch(() => {})
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
      await page.waitForTimeout(800)
      const header = await page.evaluate(`${TEXT_AUDIT}(${JSON.stringify({ minPx: 14, minRatio: 4.5, root: 'header', samples: ['My Counties', 'Sign in'] })})`) as TextAudit
      const r = await page.evaluate(`${TEXT_AUDIT}(${JSON.stringify({ minPx: 14, minRatio: 4.5, root: 'main', samples: SAMPLES_NAMED })})`) as TextAudit
      const bottom = await page.evaluate(`${TEXT_AUDIT}(${JSON.stringify({ minPx: 14, minRatio: 4.5, root: 'nav', samples: ['My Counties'] })})`).catch(() => null) as TextAudit | null
      const all = [r, header, ...(bottom ? [bottom] : [])]
      const tiny = all.reduce((s, x) => s + ((x as unknown as { tinyCount: number }).tinyCount ?? x.tiny.length), 0)
      const low = all.reduce((s, x) => s + ((x as unknown as { lowCount: number }).lowCount ?? x.low.length), 0)
      const lowEss = all.reduce((s, x) => s + ((x as unknown as { lowEssentialCount: number }).lowEssentialCount ?? x.lowEssential.length), 0)
      nodes += all.reduce((s, x) => s + x.total, 0); tinyTotal += tiny; lowTotal += low; lowEssTotal += lowEss
      console.log(`${String(width).padStart(3)}px ${name.padEnd(8)} text nodes ${String(all.reduce((s, x) => s + x.total, 0)).padStart(4)} · under 14px ${String(tiny).padStart(3)} · under 4.5:1 ${String(low).padStart(3)} · essential under 7:1 ${String(lowEss).padStart(3)}`)
      for (const x of all) { for (const n of [...x.low, ...x.tiny]) if (worst.length < 12 && !worst.some(w => w.text === n.text)) worst.push(n) }
      if (process.env.ESSENTIAL && width === 390) for (const x of all) for (const n of x.lowEssential) if (!essentialSeen.has(n.text)) { essentialSeen.add(n.text); console.log(`    essential<7  ${String(n.ratio).padStart(5)}:1 ${String(n.px).padStart(4)}px w${n.weight} ${n.nav ? 'NAV ' : '    '}${n.tag.padEnd(6)} "${n.text}"`) }
      for (const x of all) for (const s of x.samples as (TextNode & { sample: string })[]) rows.push({ surface: name, width, sample: s.sample, text: s.text, px: s.px, color: s.color, bg: s.bg, ratio: s.ratio })
    }
    await ctx.close()
  }
  await browser.close()
  console.log(`\nTOTAL text nodes ${nodes} · under 14px ${tinyTotal} · under 4.5:1 ${lowTotal} · essential under 7:1 ${lowEssTotal}`)
  if (worst.length) { console.log('\nOffenders (first 12, distinct):'); for (const n of worst) console.log(`  ${String(n.ratio).padStart(5)}:1  ${String(n.px).padStart(4)}px  ${n.color} on ${n.bg}  ${n.tag.padEnd(6)} "${n.text}"`) }
  console.log('\nNamed samples at 390px:')
  const seen = new Set<string>()
  for (const r of rows.filter(r => r.width === 390)) { const k = `${r.surface}|${r.sample}|${r.text}`; if (seen.has(k)) continue; seen.add(k); console.log(`  ${r.surface.padEnd(8)} ${r.sample.padEnd(22)} ${String(r.ratio).padStart(5)}:1  ${String(r.px).padStart(4)}px  ${r.color} on ${r.bg}  "${r.text}"`) }
  console.log('')
}
main().catch(e => { console.error('audit crashed:', e.message); process.exit(2) })
