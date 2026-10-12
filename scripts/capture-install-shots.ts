// ─── The two screenshots in the manifest (Block 48) ──────────────────────────
//   npx tsx scripts/capture-install-shots.ts            (BASE defaults to production)
//
// Android's install sheet shows them. Taken at a phone's size, 2× — 780×1688
// — signed in as the Test Ranch owner (the ranch that exists to be looked at),
// through a one-time magic link, exactly as the suites sign in. Read-only on
// the ranch; writes two PNGs under public/brand/screenshots and nothing else.
// Run again whenever Today or Markets changes shape enough to matter.
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

for (const f of ['.env', '.env.local', 'e2e/.env.e2e']) {
  const p = resolve(process.cwd(), f)
  if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

const BASE = process.env.BASE ?? 'https://www.dryline.farm'
const BYPASS = BASE.includes('vercel.app') ? process.env.VERCEL_BYPASS : undefined
const EMAIL = process.env.SHOTS_EMAIL ?? 'kiehl.preston+testranch@gmail.com'
const OUT = resolve(process.cwd(), 'public/brand/screenshots')
mkdirSync(OUT, { recursive: true })

async function main() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } })
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  const tokenHash = link.data?.properties?.hashed_token
  if (!tokenHash) throw new Error(`generateLink: ${link.error?.message}`)
  const browser = await chromium.launch()
  // A desktop UA at a phone's size: the layout is the phone's, and no
  // phone-only line (the install walkthrough) sits in the picture.
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, extraHTTPHeaders: BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } : {} })
  const page = await ctx.newPage()
  try {
    await page.goto(`/auth/callback?token_hash=${tokenHash}&type=magiclink&next=/today`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(u => !u.pathname.startsWith('/auth/callback'), { timeout: 20_000 }).catch(() => {})
    for (const [path, landmark, file] of [
      ['/today', 'main [role="tablist"][aria-label="Ledgers"]', 'today.png'],
      ['/markets', 'main h1, main [data-audit="herd-value"], main section', 'markets.png'],
    ] as const) {
      await page.goto(path, { waitUntil: 'networkidle' }).catch(() => {})
      const where = new URL(page.url()).pathname
      if (where !== path) throw new Error(`${path} landed on ${where} — not signed in; nothing captured`)
      await page.locator(landmark).first().waitFor({ state: 'visible', timeout: 20_000 })
      await page.waitForTimeout(1_500)
      await page.screenshot({ path: resolve(OUT, file), fullPage: false })
      console.log(`  ${file}  ← ${BASE}${path}`)
    }
  } finally {
    await browser.close()
  }
}
main().catch(e => { console.error('capture failed:', e instanceof Error ? e.message : e); process.exit(1) })
