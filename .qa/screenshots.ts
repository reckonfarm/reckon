/**
 * QA harness — route screenshots at iPhone + desktop viewports.
 *
 * Captures full-page PNGs of 4 routes at 2 viewports against localhost:3000 for
 * before/after UI review. Signed-out routes use a clean context; /herd uses the
 * storageState written by seed-auth.ts.
 *
 *   npm run qa:seed     # once, to mint /.qa/.auth/herd-user.json
 *   npm run qa:shots    # dev server must already be running on :3000
 *
 * Output: /.qa/screenshots/<viewport>/<route>.png
 * Each shot is isolated — one failure prints ✗ and the rest continue.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type Browser } from '@playwright/test'

const BASE = 'http://localhost:3000'
const STORAGE = resolve(process.cwd(), '.qa/.auth/herd-user.json')
const OUT_DIR = resolve(process.cwd(), '.qa/screenshots')

// Let map tiles / client fetches settle before the full-page capture. Map-heavy
// pages may never reach networkidle, so we wait on 'load' + a fixed settle.
const SETTLE_MS = 2000

interface Route {
  name: string // filename stem
  path: string
  auth: boolean // true → use storageState
}

const ROUTES: Route[] = [
  { name: 'home', path: '/', auth: false },
  { name: 'hay', path: '/hay', auth: false },
  { name: 'dashboard', path: '/dashboard?fips=30069', auth: false },
  { name: 'herd', path: '/herd', auth: true },
]

interface Viewport {
  name: string
  width: number
  height: number
  deviceScaleFactor: number
}

const VIEWPORTS: Viewport[] = [
  { name: 'iphone', width: 390, height: 844, deviceScaleFactor: 3 },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
]

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

async function captureOne(
  browser: Browser,
  vp: Viewport,
  route: Route,
): Promise<boolean> {
  const label = `${vp.name}/${route.name}`
  const dir = resolve(OUT_DIR, vp.name)
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, `${route.name}.png`)

  let context
  try {
    if (route.auth && !existsSync(STORAGE)) {
      console.log(`  ✗ ${label}  (no storageState — run \`npm run qa:seed\` first)`)
      return false
    }

    context = await browser.newContext({
      baseURL: BASE,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.deviceScaleFactor,
      ...(route.auth ? { storageState: STORAGE } : {}),
    })
    const page = await context.newPage()

    await page.goto(route.path, { waitUntil: 'load', timeout: 30_000 })
    await page.waitForTimeout(SETTLE_MS)
    await page.screenshot({ path: file, fullPage: true })

    console.log(`  ✓ ${label}  → ${file}`)
    return true
  } catch (err) {
    console.log(`  ✗ ${label}  (${err instanceof Error ? err.message.split('\n')[0] : err})`)
    return false
  } finally {
    await context?.close()
  }
}

async function main(): Promise<void> {
  await assertServerUp()

  const browser = await chromium.launch()
  let ok = 0
  let total = 0
  try {
    for (const vp of VIEWPORTS) {
      console.log(`\n${vp.name} (${vp.width}x${vp.height} @${vp.deviceScaleFactor}x):`)
      for (const route of ROUTES) {
        total++
        if (await captureOne(browser, vp, route)) ok++
      }
    }
  } finally {
    await browser.close()
  }

  console.log(`\n${ok}/${total} screenshots captured → ${OUT_DIR}`)
  if (ok < total) process.exitCode = 1
}

main().catch(err => {
  console.error(`\n✗ screenshots failed:\n${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
