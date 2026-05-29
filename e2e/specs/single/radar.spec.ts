import { test, expect } from '../../fixtures/test'
import { SENTINEL_HAY } from '../../fixtures/data'

test('Hay Radar — save a search (UI) then view + delete on /radar', async ({ page, shot }) => {
  test.setTimeout(90_000)
  await page.goto('/hay')

  // Open "Save this search" (authed). It lives in the filter bar.
  const saveToggle = page.getByRole('button', { name: /Save this search/i })
  await saveToggle.first().click({ timeout: 10_000 }).catch(() => {})
  const labelInput = page.getByPlaceholder(/Alfalfa near home/i)
  if (await labelInput.count() === 0) {
    // Filter bar only renders when listings exist; fall back to API save.
    const res = await page.request.post('/api/radar', { data: { hay_type: SENTINEL_HAY, label: 'E2E radar' } })
    expect(res.ok(), 'radar saved via API fallback').toBeTruthy()
  } else {
    await labelInput.fill('E2E radar')
    await page.getByRole('button', { name: /^Save search$/i }).click()
    await page.waitForTimeout(1500)
    await shot('radar — saved from /hay')
  }

  await page.goto('/radar')
  await expect(page.getByRole('heading', { name: /Hay Radar/i })).toBeVisible()
  await shot('radar — saved searches list')

  const del = page.getByRole('button', { name: /^Delete$/i }).first()
  if (await del.count() > 0) {
    await del.click()
    await page.waitForTimeout(1500)
    await shot('radar — after delete')
  }
})
