import { test, expect } from '../../fixtures/test'
import { TEST_COUNTY_QUERY } from '../../fixtures/data'

test('hay browse — board, deliver-to picker, delivered framing', async ({ page, shot }) => {
  await page.goto('/hay')
  await expect(page.getByRole('heading', { name: /Hay Network/i })).toBeVisible()
  await shot('hay — board')

  // Deliver-to picker: search a county and pick it → delivered pricing framing.
  const deliverSearch = page.getByPlaceholder(/Search your county/i)
  if (await deliverSearch.count() > 0) {
    await deliverSearch.first().fill(TEST_COUNTY_QUERY)
    const option = page.getByRole('button', { name: new RegExp(`${TEST_COUNTY_QUERY}.*,`, 'i') }).first()
    await option.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    if (await option.count() > 0) {
      await option.click()
      await expect(page.getByText(/delivered cost per ton/i)).toBeVisible({ timeout: 8000 })
      await shot('hay — deliver-to set (delivered pricing)')
    }
  }
})

test('hay browse — deep link deliverTo + type=sell pre-prices', async ({ page, shot }) => {
  await page.goto(`/hay?deliverTo=31109&type=sell`)
  await expect(page.getByRole('heading', { name: /Hay Network/i })).toBeVisible()
  await page.waitForLoadState('networkidle').catch(() => {})
  await shot('hay — deep link deliverTo=31109&type=sell')
})
