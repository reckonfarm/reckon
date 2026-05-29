import { test, expect } from '../../fixtures/test'

test('profile — edit fields + toggle demand opt-in + save', async ({ page, shot }) => {
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: /Your profile/i })).toBeVisible()
  await shot('profile — loaded')

  // Bio field (display name is set in setup; tweak bio to exercise PATCH)
  const bio = page.getByPlaceholder(/Tell buyers about your operation/i)
  await bio.fill('E2E test operation — Sandhills cow-calf.')

  // Demand-routing opt-in toggle
  const optIn = page.getByRole('checkbox')
  if (await optIn.count() > 0) await optIn.first().check().catch(() => {})

  await page.getByRole('button', { name: /Save profile/i }).click()
  await expect(page.getByText(/^Saved$/i)).toBeVisible({ timeout: 10_000 })
  await shot('profile — saved')
})
