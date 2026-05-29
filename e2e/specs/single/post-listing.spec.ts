import { test, expect } from '../../fixtures/test'
import { SENTINEL_HAY, TEST_COUNTY_QUERY, TEST_COUNTY_FIPS } from '../../fixtures/data'

// All listings use SENTINEL_HAY so the suppressed radar/demand after() hook can
// never match a real user even if email weren't disabled.

test('post a SELL listing via the real form UI', async ({ page, shot }) => {
  test.setTimeout(90_000)
  await page.goto('/hay')
  await page.getByRole('button', { name: /Post a listing/i }).click()
  await shot('post — form open')

  // County autocomplete
  await page.getByPlaceholder(/Search county/i).fill(TEST_COUNTY_QUERY)
  const countyOption = page.getByRole('button', { name: new RegExp(`${TEST_COUNTY_QUERY}.*,`, 'i') }).first()
  await countyOption.waitFor({ state: 'visible', timeout: 8000 })
  await countyOption.click()

  // Type defaults to "sell"; fill hay type, contact, price
  await page.getByPlaceholder(/e\.g\. Alfalfa/i).fill(SENTINEL_HAY)
  await page.getByPlaceholder(/\(402\) 555-0101/i).fill('e2e@dryline.farm')
  await page.getByPlaceholder(/e\.g\. 180/i).fill('210')
  await shot('post — filled')

  await page.getByRole('button', { name: /^Post listing$/i }).click()
  // Form closes on success; the sentinel listing's CARD HEADING (h2) should appear
  // on the board. (getByText would also match the hidden <option> in the variety
  // filter, so target the heading role specifically.)
  await expect(page.getByRole('heading', { name: SENTINEL_HAY }).first()).toBeVisible({ timeout: 15_000 })
  await shot('post — listing on board')
})

test('post WANT + DONATE listings via API (exercise after() hook)', async ({ page }) => {
  const counties = await page.request.get(`/api/counties?search=${encodeURIComponent(TEST_COUNTY_QUERY)}`)
    .then(r => r.json()) as Array<{ id: number; fips: string }>
  const county = counties.find(c => c.fips === TEST_COUNTY_FIPS) ?? counties[0]
  expect(county).toBeTruthy()

  const want = await page.request.post('/api/hay', {
    data: { county_id: county.id, listing_type: 'want', hay_type: SENTINEL_HAY, contact: 'e2e@dryline.farm', haul_radius_miles: 150 },
  })
  expect(want.ok(), 'want created').toBeTruthy()

  const donate = await page.request.post('/api/hay', {
    data: { county_id: county.id, listing_type: 'donate', hay_type: SENTINEL_HAY, contact: 'e2e@dryline.farm', tonnage: 10 },
  })
  expect(donate.ok(), 'donate created').toBeTruthy()
})
