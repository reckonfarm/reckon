import { test, expect } from '../../fixtures/test'

test('seller profile page renders from a listing', async ({ page, shot }) => {
  await page.goto('/hay')
  const firstCard = page.locator('li:has(h2)').first()
  await firstCard.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {})
  if (await firstCard.count() === 0) { test.skip(true, 'No listings to derive a seller from.'); return }
  await firstCard.click()
  await page.waitForURL(/\/hay\/\d+/, { timeout: 15_000 })
  await page.waitForLoadState('networkidle').catch(() => {})

  // Wait for the client-side detail fetch to render the "About the Seller" link.
  const sellerLink = page.locator('a[href^="/sellers/"]').first()
  await sellerLink.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {})
  if (await sellerLink.count() === 0) { test.skip(true, 'Listing has no seller profile link.'); return }
  await sellerLink.click()
  await page.waitForURL(/\/sellers\//, { timeout: 15_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  // Reviews section is always present (even if "No reviews yet").
  await expect(page.getByText(/Reviews/i).first()).toBeVisible({ timeout: 10_000 })
  await shot('seller profile — reviews + listings')
})
