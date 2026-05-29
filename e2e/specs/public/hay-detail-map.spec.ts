import { test, expect } from '../../fixtures/test'

test('hay detail — contact hidden, messaging is the entry point (logged out)', async ({ page, shot }) => {
  await page.goto('/hay')
  await expect(page.getByRole('heading', { name: /Hay Network/i })).toBeVisible()

  const firstCard = page.locator('li:has(h2)').first()
  await firstCard.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {})
  if (await firstCard.count() === 0) {
    test.skip(true, 'No listings on the board to open.')
    return
  }
  await firstCard.click()
  await page.waitForURL(/\/hay\/\d+/, { timeout: 15_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await shot('hay detail — listing')

  // Messaging replaces exposed contact; logged out → "Sign in to message".
  await expect(page.getByText(/sign in to message|message seller|message buyer|view messages/i).first())
    .toBeVisible({ timeout: 10_000 })

  // Raw SELLER phone/email must NOT be exposed. (The footer "Report this listing"
  // mailto to the Dryline team is intentional and excluded.)
  expect(await page.locator('a[href^="tel:"]').count(), 'no tel: contact link').toBe(0)
  const sellerMailtos: string[] = []
  for (const a of await page.locator('a[href^="mailto:"]').all()) {
    const href = await a.getAttribute('href')
    if (href && !/Report hay listing/i.test(href)) sellerMailtos.push(href)
  }
  expect(sellerMailtos, 'no seller mailto (only the report-listing link is allowed)').toEqual([])
})

test('hay map — drought overlay + legend + pins', async ({ page, shot }) => {
  await page.goto('/hay/map')
  // Leaflet container mounts client-side.
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(2500) // let the USDM GeoJSON layer + tiles paint
  await expect(page.getByText(/U\.S\. Drought Monitor/i).first()).toBeVisible()
  await shot('hay map — overlay + legend')
})
