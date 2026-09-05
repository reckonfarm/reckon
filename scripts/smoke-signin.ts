// ─── Smoke sign-in: mint a session cookie for browser smoke tests ─────────────
//
// THE RULE (2026-09-04): a smoke test that WRITES to the production ledger
// either runs as the scratch account or is announced to PK before it runs —
// never reported after. Enforced here, at the one door every browser smoke
// walks through to get a session:
//
//   • Default account = the SCRATCH account (SMOKE_SCRATCH_EMAIL below): no
//     ranch membership, no home county, its rows are its own under RLS.
//     Writes there touch nothing PK looks at.
//   • Minting a cookie for ANY other account (the owner's) requires
//     SMOKE_OWNER_ACK=announced — i.e. you told PK first — and prints what
//     it minted so the transcript shows it. Without the ack it refuses.
//
// Usage (from the repo root; needs .env.local with the Supabase URL and the
// service-role key, and a server on BASE — default http://localhost:3000):
//
//   npx tsx scripts/smoke-signin.ts                          # scratch account → smoke-cookie.txt
//   SMOKE_EMAIL=<owner> SMOKE_OWNER_ACK=announced npx tsx scripts/smoke-signin.ts
//   OUT=/path/cookie.txt BASE=https://www.dryline.farm npx tsx scripts/smoke-signin.ts
//
// The cookie file is one `name=value; name=value` header line; add it to a
// Playwright context with the target hostname as the cookie domain. Never
// commit a cookie file (the .gitignore entry below the repo root covers
// *cookie*.txt; keep it that way).

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

export const SMOKE_SCRATCH_EMAIL = 'kiehl.preston+test@gmail.com'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const EMAIL = process.env.SMOKE_EMAIL ?? SMOKE_SCRATCH_EMAIL
const OUT = process.env.OUT ?? resolve(process.cwd(), 'smoke-cookie.txt')

function loadEnv() {
  for (const f of ['.env', '.env.local']) {
    const path = resolve(process.cwd(), f)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
    }
  }
}

async function main() {
  loadEnv()
  const isScratch = EMAIL.toLowerCase() === SMOKE_SCRATCH_EMAIL.toLowerCase()
  if (!isScratch && process.env.SMOKE_OWNER_ACK !== 'announced') {
    console.error(
      `smoke-signin: refusing to mint a session for ${EMAIL}.\n` +
      `  Smokes run as the scratch account (${SMOKE_SCRATCH_EMAIL}) by default.\n` +
      `  A smoke as any other account can write to PK's real ledger: tell PK FIRST,\n` +
      `  then re-run with SMOKE_OWNER_ACK=announced.`,
    )
    process.exit(2)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (run from the repo root with .env.local)')

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  const tokenHash = link.data?.properties?.hashed_token
  if (link.error || !tokenHash) throw new Error(`generateLink failed: ${link.error?.message}`)

  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ baseURL: BASE })
    const page = await ctx.newPage()
    await page.goto(`/auth/callback?token_hash=${tokenHash}&type=magiclink&next=/dashboard`)
    // Lands on the dashboard (the middleware resolves the county, or the bare
    // county picker for an account with none) once the session cookie is set.
    await page.waitForURL(u => u.pathname.startsWith('/dashboard') && !u.searchParams.has('token_hash'), { timeout: 60_000 })
    const cookies = await ctx.cookies()
    writeFileSync(OUT, cookies.map(c => `${c.name}=${c.value}`).join('; '))
    console.log(`smoke-signin: ${isScratch ? 'SCRATCH account' : `OWNER account ${EMAIL} (announced)`} → ${cookies.length} cookie(s) → ${OUT}`)
    if (!isScratch) console.log('smoke-signin: any write this session makes lands in the REAL ledger.')
  } finally {
    await browser.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
