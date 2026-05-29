import { test, expect } from '../../fixtures/test'

test('homepage renders hero + driest-county chips', async ({ page, shot }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await shot('homepage — hero')

  // Driest-county chips link into the dashboard.
  const countyLinks = page.locator('a[href*="/dashboard?fips="]')
  await expect(countyLinks.first()).toBeVisible({ timeout: 15_000 })
  await shot('homepage — county chips')
})
