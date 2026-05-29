import { test, expect } from '../../fixtures/test'

// Visits the first driest county from the homepage (most likely to be LFP-triggered)
// and captures the dashboard. Triggered-only content (cash-to-hay card) is captured
// conditionally — it depends on live drought data, so its absence is not a failure.
test('dashboard renders for a live county (+ cash-to-hay if triggered)', async ({ page, shot }) => {
  await page.goto('/')
  const firstCounty = page.locator('a[href*="/dashboard?fips="]').first()
  await expect(firstCounty).toBeVisible({ timeout: 15_000 })
  const href = await firstCounty.getAttribute('href')
  await firstCounty.click()

  await page.waitForLoadState('networkidle').catch(() => {})
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await shot(`dashboard — ${href ?? 'county'}`)

  // Conditional: cash-to-hay loop card (only when triggered with a real estimate).
  const cashCard = page.getByText('Put your LFP toward hay', { exact: false })
  if (await cashCard.count() > 0) {
    await cashCard.first().scrollIntoViewIfNeeded()
    await shot('dashboard — cash-to-hay card (triggered)')
    // The CTA should deep-link with delivered framing.
    const cta = page.locator('a[href*="/hay?deliverTo="]').first()
    await expect(cta).toBeVisible()
  } else {
    test.info().annotations.push({ type: 'note', description: 'County not LFP-triggered right now — cash-to-hay card not shown (expected).' })
  }
})

test('dashboard national view (no fips)', async ({ page, shot }) => {
  await page.goto('/dashboard')
  await expect(page.getByText('Select a county to begin', { exact: false })).toBeVisible({ timeout: 15_000 })
  await shot('dashboard — national empty state')
})
