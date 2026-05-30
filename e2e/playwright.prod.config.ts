import { defineConfig, devices } from '@playwright/test'

// Isolated config for the production auth diagnostic. Run explicitly with:
//   npx playwright test -c e2e/playwright.prod.config.ts
// It does NOT start a local server and only matches prod-auth.spec.ts, so it
// never touches the existing e2e suite/config.
export default defineConfig({
  testDir: '.',
  testMatch: /prod-auth\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: './prod-auth-results',
  use: {
    baseURL: 'https://dryline.farm',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 20000,
    navigationTimeout: 30000,
    ...devices['Desktop Chrome'],
  },
})
