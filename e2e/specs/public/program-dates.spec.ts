import { test, expect } from '../../fixtures/test'

// Block 1A — program deadlines read from lib/programDates.ts, the single source
// of truth. Petroleum (30069) and Fergus (30027) must both show the LFP
// application deadline as March 1, 2027 (2026 losses) and PRF sales closing as
// December 1, 2026, with the old wrong dates gone everywhere on the page.
// The Program deadlines card lives inside the collapsed "Program status" row
// when quiet, so the test expands it before reading.
const COUNTIES = [
  { fips: '30069', name: 'Petroleum' },
  { fips: '30027', name: 'Fergus' },
]

for (const c of COUNTIES) {
  test(`program dates — ${c.name} (${c.fips})`, async ({ page, shot }) => {
    await page.goto(`/dashboard?fips=${c.fips}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })

    // Expand the quiet Program status row if the deadline card is folded into it.
    const row = page.getByRole('button', { name: /Program status/i })
    if (await row.count() > 0 && (await row.first().getAttribute('aria-expanded')) !== 'true') {
      await row.first().click()
    }
    const card = page.getByText('Program deadlines', { exact: true }).locator('xpath=ancestor::div[1]/..')
    await expect(card).toBeVisible()
    await card.scrollIntoViewIfNeeded()
    await shot(`program deadlines — ${c.name}`)

    const cardText = (await card.innerText()).replace(/\s+/g, ' ')
    expect(cardText, 'LFP row').toMatch(/LFP application[^·]*·\s*Mar 1, 2027|Mar 1, 2027[^]*LFP application|LFP application[^]*Mar 1, 2027/)
    expect(cardText, 'PRF row').toMatch(/PRF[^]*Dec 1, 2026|Dec 1, 2026[^]*PRF/)

    // The wrong dates must be gone from the whole page, in every format.
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    expect(body).not.toMatch(/Jan(uary)? 30, 2027/)
    expect(body).not.toMatch(/signup closes/i)
    // December 1 belongs only to PRF: it must never sit on an LFP line.
    expect(body).not.toMatch(/LFP[^.]{0,80}Dec(ember)? 1, 2026/)

    // When the county is triggered, the LFP hero CTA carries the long-form date.
    const cta = page.getByText(/applications for 2026 losses are due/i)
    if (await cta.count() > 0) {
      await expect(cta.first()).toContainText('March 1, 2027')
      // No urgency phrasing until inside the 60-day window (Jan 2027).
      await expect(cta.first()).not.toContainText("Don't wait")
    }
  })
}
