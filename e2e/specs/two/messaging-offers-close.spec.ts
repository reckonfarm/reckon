import { test, expect, type Browser } from '@playwright/test'
import { contextOptions, watchPage, assertPageClean, shot } from '../../fixtures/test'
import { STORAGE, SENTINEL_HAY, TEST_COUNTY_QUERY, TEST_COUNTY_FIPS } from '../../fixtures/data'

async function authed(browser: Browser, storage: string, label: string) {
  const ctx = await browser.newContext(contextOptions({ storageState: storage }))
  const page = await ctx.newPage()
  watchPage(page, label)
  return { ctx, page }
}

test('messaging → offer → accept → close → review (buyer + seller)', async ({ browser }) => {
  test.setTimeout(150_000)
  const ti = test.info()
  const { ctx: sellerCtx, page: seller } = await authed(browser, STORAGE.seller, 'seller')
  const { ctx: buyerCtx,  page: buyer }  = await authed(browser, STORAGE.buyer, 'buyer')

  // Seller posts a sentinel SELL listing (API; suppressed after()).
  const counties = await sellerCtx.request.get(`/api/counties?search=${encodeURIComponent(TEST_COUNTY_QUERY)}`)
    .then(r => r.json()) as Array<{ id: number; fips: string }>
  const county = counties.find(c => c.fips === TEST_COUNTY_FIPS) ?? counties[0]
  const listingId = await sellerCtx.request.post('/api/hay', {
    data: { county_id: county.id, listing_type: 'sell', hay_type: SENTINEL_HAY, contact: 'e2e@dryline.farm', price_per_ton: 205, tonnage: 30 },
  }).then(r => r.json()).then(j => j.id as number)

  // Buyer opens a thread from the listing via the "Message seller" CTA.
  await buyer.goto(`/hay/${listingId}`)
  await buyer.getByRole('button', { name: /Message seller/i }).click()
  await buyer.waitForURL(/\/messages\?thread=\d+/, { timeout: 20_000 })
  const threadId = new URL(buyer.url()).searchParams.get('thread')!
  await shot(buyer, ti, 'buyer — thread opened')

  // Buyer sends a text, then an offer.
  await buyer.getByPlaceholder(/Write a message/i).fill('Interested in your hay — what can you do?')
  await buyer.getByRole('button', { name: /^Send$/i }).click()
  await expect(buyer.getByText(/Interested in your hay/i)).toBeVisible({ timeout: 10_000 })

  await buyer.getByRole('button', { name: /Offer/i }).click()
  await buyer.getByPlaceholder('$/ton').fill('190')
  await buyer.getByPlaceholder('tons').fill('30')
  await buyer.getByRole('button', { name: /Send offer/i }).click()
  await expect(buyer.getByText(/\$190\/ton/)).toBeVisible({ timeout: 10_000 })
  await shot(buyer, ti, 'buyer — offer sent')

  // Seller opens the same thread (fresh load shows text + offer), accepts, closes.
  await seller.goto(`/messages?thread=${threadId}`)
  await expect(seller.getByText(/Interested in your hay/i)).toBeVisible({ timeout: 15_000 })
  await expect(seller.getByText(/\$190\/ton/)).toBeVisible()
  await shot(seller, ti, 'seller — sees message + offer')

  await seller.getByRole('button', { name: /^Accept$/i }).click()
  await expect(seller.getByText(/accepted/i).first()).toBeVisible({ timeout: 10_000 })

  // Seller marks closed → accepted offer qualifies → deal finalizes (listing sold).
  await seller.getByRole('button', { name: /Mark as closed/i }).click()
  await expect(seller.getByText(/Deal closed/i)).toBeVisible({ timeout: 15_000 })
  await shot(seller, ti, 'seller — deal closed')

  // Listing now shows SOLD.
  await seller.goto(`/hay/${listingId}`)
  await expect(seller.getByText(/^SOLD$/).first()).toBeVisible({ timeout: 15_000 })

  // Both leave a review via the detail page CTA.
  for (const [who, page] of [['buyer', buyer], ['seller', seller]] as const) {
    await page.goto(`/hay/${listingId}`)
    const rate = page.getByRole('button', { name: /^Rate /i }).first()
    if (await rate.count() === 0) {
      ti.annotations.push({ type: 'note', description: `${who}: review CTA not present (already reviewed?)` })
      continue
    }
    await rate.click()
    await page.getByRole('button', { name: /5 stars?/i }).click()
    await page.getByPlaceholder(/How was the hay/i).fill(`E2E ${who} review — smooth deal.`)
    await page.getByRole('button', { name: /Submit review/i }).click()
    await page.waitForTimeout(1500)
    await shot(page, ti, `${who} — review submitted`)
  }

  await assertPageClean(buyer, ti)
  await assertPageClean(seller, ti)
  await buyerCtx.close(); await sellerCtx.close()
})
