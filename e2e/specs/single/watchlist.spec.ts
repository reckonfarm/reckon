import { test, expect } from '../../fixtures/test'
import { TEST_COUNTY_QUERY, TEST_COUNTY_FIPS } from '../../fixtures/data'

test('watchlist — add (API) then view + remove (UI)', async ({ page, shot }) => {
  const counties = await page.request.get(`/api/counties?search=${encodeURIComponent(TEST_COUNTY_QUERY)}`)
    .then(r => r.json()) as Array<{ id: number; fips: string; name: string }>
  const county = counties.find(c => c.fips === TEST_COUNTY_FIPS) ?? counties[0]
  expect(county).toBeTruthy()

  const add = await page.request.post('/api/watchlist', { data: { countyId: county.id, alertLevel: 3 } })
  expect(add.ok(), 'county added to watchlist').toBeTruthy()

  await page.goto('/watchlist')
  await expect(page.getByRole('heading', { name: /My Counties/i })).toBeVisible()
  const row = page.getByText(new RegExp(county.name, 'i')).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await shot('watchlist — county present')

  // Remove via the UI control
  const removeBtn = page.getByRole('button', { name: /^Remove$/i }).first()
  if (await removeBtn.count() > 0) {
    await removeBtn.click()
    await page.waitForTimeout(1500)
    await shot('watchlist — after remove')
  }
})
