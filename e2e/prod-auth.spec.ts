import { test, expect, type Page } from '@playwright/test'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Production auth diagnostic — runs against https://dryline.farm (NOT localhost).
// Test-only: does not import or modify any app code.
// ---------------------------------------------------------------------------

const BASE = 'https://dryline.farm'
const PASSWORD = 'Dryline!E2E_2026xQ' // fixed strong password (upper/lower/digit/symbol, 18 chars)

// One throwaway email shared across both tests in this run.
const EMAIL = `dryline-e2e+${Date.now()}@example.com`

const ART_DIR = path.join(__dirname, 'prod-auth-artifacts')
fs.mkdirSync(ART_DIR, { recursive: true })

// Auth user ids created/seen during the run — deleted in afterAll teardown.
const createdUserIds = new Set<string>()

// Loads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the app's
// .env.local into process.env. Runs ONLY in the Playwright Node worker — the
// service-role key never enters the browser context.
function loadServiceEnv() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) return
  const envPath = path.join(__dirname, '..', '.env.local')
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const [, k, v] = m
    if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, '').trim()
  }
}

function makeAdminClient() {
  loadServiceEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Teardown needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env.local)')
  }
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

type AuthHit = { url: string; status: number; body: string }
type Capture = { auth: AuthHit[]; consoleErrors: string[] }

function attachCapture(page: Page): Capture {
  const cap: Capture = { auth: [], consoleErrors: [] }
  page.on('response', async (res) => {
    const url = res.url()
    if (url.includes('/auth/v1/')) {
      let body = ''
      try { body = await res.text() } catch { /* body already consumed */ }
      cap.auth.push({ url, status: res.status(), body: body.slice(0, 2000) })
      // Record the auth user id (from signup/token responses) for teardown.
      if (url.includes('/auth/v1/signup') || url.includes('/auth/v1/token')) {
        try {
          const id = JSON.parse(body)?.user?.id
          if (typeof id === 'string') createdUserIds.add(id)
        } catch { /* non-JSON / error body */ }
      }
    }
  })
  page.on('console', (msg) => { if (msg.type() === 'error') cap.consoleErrors.push(msg.text()) })
  page.on('pageerror', (err) => cap.consoleErrors.push(`pageerror: ${String(err)}`))
  return cap
}

async function onScreenError(page: Page): Promise<string | null> {
  // SignInForm renders form errors as <p class="... text-rust">{error}</p>
  const loc = page.locator('.text-rust')
  try {
    if (await loc.count()) {
      const txt = (await loc.first().innerText()).trim()
      return txt || null
    }
  } catch { /* ignore */ }
  return null
}

async function authCookie(page: Page) {
  const cookies = await page.context().cookies()
  return cookies.find((c) => c.name.startsWith('sb-') && /auth-token/.test(c.name))
    ?? cookies.find((c) => c.name.startsWith('sb-'))
}

/** Wait for one of: redirect off /signin, the "Confirm your email" state, or a form error. */
async function waitOutcome(page: Page) {
  const redirect = page
    .waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 20000 })
    .then(() => 'redirect' as const)
    .catch(() => null)
  const confirm = page
    .getByText('Confirm your email', { exact: false })
    .waitFor({ timeout: 20000 })
    .then(() => 'confirm' as const)
    .catch(() => null)
  const errored = page
    .locator('.text-rust')
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => 'error' as const)
    .catch(() => null)
  const first = await Promise.race([redirect, confirm, errored])
  // Give the slower signals a beat in case two land near-simultaneously.
  await page.waitForTimeout(500)
  return first
}

function logReport(label: string, data: Record<string, unknown>) {
  // Printed to stdout so it shows up under the `list` reporter.
  console.log(`\n===== ${label} =====\n${JSON.stringify(data, null, 2)}\n=====================\n`)
}

// React controlled inputs on /signin can be wiped if hydration lands AFTER a
// fast fill (a human typing post-paint never hits this). Re-fill until the
// values actually stick, so the submit sends real credentials.
async function fillCredentials(page: Page) {
  const email = page.getByPlaceholder('you@example.com')
  const pw = page.getByPlaceholder('Password')
  await expect(async () => {
    await email.fill(EMAIL)
    await pw.fill(PASSWORD)
    // Settle: if hydration lands after the fill it resets the controlled inputs
    // to empty; pausing lets that wipe happen so the assertions below fail and
    // the next retry re-fills on a now-hydrated form (firing React onChange).
    await page.waitForTimeout(400)
    await expect(email).toHaveValue(EMAIL)
    await expect(pw).toHaveValue(PASSWORD)
  }).toPass({ timeout: 15000 })
}

test.describe.configure({ mode: 'serial' })

test.describe('dryline.farm production auth', () => {
  // Delete every throwaway user this run created, via the service-role admin API.
  test.afterAll(async () => {
    if (createdUserIds.size === 0) {
      console.log('[teardown] no throwaway users to delete')
      return
    }
    const admin = makeAdminClient()
    for (const id of createdUserIds) {
      const { error } = await admin.auth.admin.deleteUser(id)
      const check = await admin.auth.admin.getUserById(id)
      const gone = !!check.error || !check.data?.user
      console.log(
        `[teardown] ${id}: ${error ? 'delete ERROR: ' + error.message : 'deleted'}; verify=${gone ? 'gone' : 'STILL EXISTS'}`,
      )
    }
  })

  test('Test 1 — fresh-email password signup', async ({ page }, testInfo) => {
    const cap = attachCapture(page)

    await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' })

    // Default view is password+signin; switch to the create-account view.
    const createToggle = page.getByRole('button', { name: 'Create one' })
    try { await createToggle.click({ timeout: 8000 }) } catch { /* maybe already in signup view */ }

    await fillCredentials(page)
    // Scope to the <form> so we hit the submit button, never a nav "Sign in"/"Create" link.
    await page.locator('form').getByRole('button', { name: 'Create account' }).click()

    const outcome = await waitOutcome(page)

    const finalURL = page.url()
    const errText = await onScreenError(page)
    const cookie = await authCookie(page)
    const authed = !new URL(finalURL).pathname.startsWith('/signin') || !!cookie

    const shot = path.join(ART_DIR, 'test1-signup-final.png')
    await page.screenshot({ path: shot, fullPage: true })

    logReport('TEST 1 — SIGNUP', {
      email: EMAIL,
      outcome,
      finalURL,
      authenticated: authed,
      authCookie: cookie ? { name: cookie.name, present: true } : null,
      onScreenError: errText,
      supabaseAuthCalls: cap.auth,
      consoleErrors: cap.consoleErrors,
      screenshot: shot,
    })
    await testInfo.attach('test1-signup-final.png', { path: shot, contentType: 'image/png' })

    expect(
      authed,
      `Expected authenticated landing after signup. outcome=${outcome} finalURL=${finalURL} onScreenError=${errText ?? 'none'}`,
    ).toBeTruthy()
  })

  test('Test 2 — sign in with the created account', async ({ page }, testInfo) => {
    // Fresh context (default per-test) → starts signed out, no UI signout needed.
    const cap = attachCapture(page)

    await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded' })

    // Already on password+signin view by default.
    await fillCredentials(page)
    // Scope to the <form> submit — the page (SiteHeader nav) also has a "Sign in" control.
    await page.locator('form').getByRole('button', { name: 'Sign in' }).click()

    const outcome = await waitOutcome(page)

    const finalURL = page.url()
    const errText = await onScreenError(page)
    const cookie = await authCookie(page)
    const authed = !new URL(finalURL).pathname.startsWith('/signin') || !!cookie

    const shot = path.join(ART_DIR, 'test2-signin-final.png')
    await page.screenshot({ path: shot, fullPage: true })

    logReport('TEST 2 — SIGNIN', {
      email: EMAIL,
      outcome,
      finalURL,
      authenticated: authed,
      authCookie: cookie ? { name: cookie.name, present: true } : null,
      onScreenError: errText,
      supabaseAuthCalls: cap.auth,
      consoleErrors: cap.consoleErrors,
      screenshot: shot,
    })
    await testInfo.attach('test2-signin-final.png', { path: shot, contentType: 'image/png' })

    expect(
      authed,
      `Expected authenticated landing after sign-in. outcome=${outcome} finalURL=${finalURL} onScreenError=${errText ?? 'none'}`,
    ).toBeTruthy()
  })
})
