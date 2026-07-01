/**
 * QA harness — local auth seeding.
 *
 * Adapts the proven flow from e2e/fixtures/admin.ts + e2e/setup/global.setup.ts
 * (admin generateLink magic-token → /auth/callback → @supabase/ssr cookies →
 * storageState JSON) but points it at http://localhost:3000 and writes a fresh
 * storageState to /.qa/.auth/herd-user.json for screenshotting the signed-in
 * /herd page.
 *
 * Self-contained: does NOT import from e2e/ (that suite is left untouched).
 * Idempotent: reuses the throwaway user if it already exists.
 *
 *   npm run qa:seed     (dev server must already be running on :3000)
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const BASE = 'http://localhost:3000'
const STORAGE = resolve(process.cwd(), '.qa/.auth/herd-user.json')

// Throwaway confirmed user this harness signs in as. dryline.farm domain so any
// (suppressed) mail routes to a domain the team controls — same convention as
// the e2e accounts.
const QA_EMAIL = 'qa-herd@dryline.farm'
const QA_DISPLAY_NAME = 'QA Herd User'

// Minimal .env.local parser (mirrors e2e/fixtures/env.ts; kept local so /.qa/ is
// standalone). Existing process.env values win, so the shell can override.
function loadEnvLocal(): void {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const i = trimmed.indexOf('=')
    const k = trimmed.slice(0, i).trim()
    const v = trimmed.slice(i + 1).trim()
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v
  }
}

function reqEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name} (expected in .env.local)`)
  return v
}

async function assertServerUp(): Promise<void> {
  try {
    await fetch(BASE, { method: 'HEAD' })
  } catch {
    throw new Error(
      `Dev server not reachable at ${BASE}.\n` +
        `Start it first in another terminal:  npm run dev`,
    )
  }
}

async function main(): Promise<void> {
  loadEnvLocal()
  const supabaseUrl = reqEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = reqEnv('SUPABASE_SERVICE_ROLE_KEY')

  await assertServerUp()

  // Service-role admin client — talks to Supabase directly (not through the app).
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 1) Ensure the confirmed user exists (idempotent: reuse if already present).
  const created = await admin.auth.admin.createUser({
    email: QA_EMAIL,
    email_confirm: true,
  })
  if (created.data?.user) {
    console.log(`seeded new user ${QA_EMAIL}`)
  } else if (created.error && /already/i.test(created.error.message)) {
    console.log(`reusing existing user ${QA_EMAIL}`)
  } else if (created.error) {
    throw new Error(`createUser failed for ${QA_EMAIL}: ${created.error.message}`)
  }

  // 2) Generate a magic-link token_hash (no email is sent).
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: QA_EMAIL })
  const tokenHash = link.data?.properties?.hashed_token
  if (link.error || !tokenHash) {
    throw new Error(`generateLink failed for ${QA_EMAIL}: ${link.error?.message ?? 'no token'}`)
  }

  // 3) Drive the magic-link callback in a real browser → sets @supabase/ssr cookies.
  mkdirSync(dirname(STORAGE), { recursive: true })
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ baseURL: BASE })
    const page = await context.newPage()

    await page.goto(`/auth/callback?token_hash=${tokenHash}&type=magiclink`)
    // The callback page verifies the OTP then router.replace('/watchlist').
    await page.waitForURL('**/watchlist', { timeout: 30_000 })

    // Give the account a display name so /herd renders a name (best-effort).
    const res = await context.request.patch('/api/profile', {
      data: { display_name: QA_DISPLAY_NAME },
    })
    if (!res.ok()) console.warn(`warning: could not set display_name (HTTP ${res.status()})`)

    await context.storageState({ path: STORAGE })
    console.log(`✓ wrote storageState → ${STORAGE}`)
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error(`\n✗ seed-auth failed:\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
