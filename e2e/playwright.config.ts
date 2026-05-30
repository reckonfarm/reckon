import { defineConfig } from '@playwright/test'
import { loadEnv } from './fixtures/env'
import { STORAGE } from './fixtures/data'

loadEnv()

const BASE = process.env.E2E_BASE_URL
if (!BASE) throw new Error('E2E_BASE_URL is not set (see e2e/.env.e2e)')
const BYPASS = process.env.VERCEL_BYPASS ?? ''

// Vercel Protection Bypass for Automation — sent on EVERY request so the browser
// (and in-page fetches) get past the Preview auth wall. Also set the bypass cookie.
const extraHTTPHeaders: Record<string, string> = BYPASS
  ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' }
  : {}

export default defineConfig({
  testDir: './specs',
  // Prod data + shared test accounts → run serially to avoid cross-test races.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: BASE,
    extraHTTPHeaders,
    screenshot: 'on',
    video: 'on',
    trace: 'on',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'setup', testDir: './setup', testMatch: /.*\.setup\.ts/ },
    { name: 'verify', testDir: './specs/verify', dependencies: ['setup'] },
    { name: 'public', testDir: './specs/public', dependencies: ['setup'] },
    { name: 'single', testDir: './specs/single', dependencies: ['setup'], use: { storageState: STORAGE.seller } },
    { name: 'two', testDir: './specs/two', dependencies: ['setup'] },
  ],
  globalTeardown: './teardown/global-teardown.ts',
})
