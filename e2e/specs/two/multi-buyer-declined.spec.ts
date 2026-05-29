import { test, expect, type Browser } from '@playwright/test'
import { contextOptions, watchPage, assertPageClean, shot } from '../../fixtures/test'
import { STORAGE, SENTINEL_HAY, TEST_COUNTY_QUERY, TEST_COUNTY_FIPS } from '../../fixtures/data'

async function authed(browser: Browser, storage: string, label: string) {
  const ctx = await browser.newContext(contextOptions({ storageState: storage }))
  const page = await ctx.newPage()
  watchPage(page, label)
  return { ctx, page }
}

// Two buyers open threads on the same listing; the seller closes with buyer 1.
// Buyer 2's losing close must read "sold to another buyer" — legible, not a
// silent failure.
test('multi-buyer: losing buyer sees "sold to another buyer"', async ({ browser }) => {
  test.setTimeout(150_000)
  const ti = test.info()
  const { ctx: sellerCtx } = await authed(browser, STORAGE.seller, 'seller')
  const { ctx: b1Ctx }     = await authed(browser, STORAGE.buyer, 'buyer1')
  const { ctx: b2Ctx, page: buyer2 } = await authed(browser, STORAGE.buyer2, 'buyer2')

  // Seller posts the sentinel listing.
  const counties = await sellerCtx.request.get(`/api/counties?search=${encodeURIComponent(TEST_COUNTY_QUERY)}`)
    .then(r => r.json()) as Array<{ id: number; fips: string }>
  const county = counties.find(c => c.fips === TEST_COUNTY_FIPS) ?? counties[0]
  const listingId = await sellerCtx.request.post('/api/hay', {
    data: { county_id: county.id, listing_type: 'sell', hay_type: SENTINEL_HAY, contact: 'e2e@dryline.farm', price_per_ton: 200, tonnage: 25 },
  }).then(r => r.json()).then(j => j.id as number)

  // Both buyers open threads while the listing is still active.
  const t1 = await b1Ctx.request.post('/api/threads', { data: { listing_id: listingId } }).then(r => r.json()).then(j => j.id as number)
  const t2 = await b2Ctx.request.post('/api/threads', { data: { listing_id: listingId } }).then(r => r.json()).then(j => j.id as number)

  // Thread 1 closes mutually → listing sold to buyer 1.
  expect((await b1Ctx.request.post(`/api/threads/${t1}/close`)).ok()).toBeTruthy()       // buyer_marked
  expect((await sellerCtx.request.post(`/api/threads/${t1}/close`)).ok()).toBeTruthy()    // → closed/finalized

  // Thread 2: buyer 2 marks, seller marks → finalize attempt hits the sold guard → declined.
  expect((await b2Ctx.request.post(`/api/threads/${t2}/close`)).ok()).toBeTruthy()         // buyer_marked
  const declined = await sellerCtx.request.post(`/api/threads/${t2}/close`).then(r => r.json())
  expect(declined.closed_status, 'thread 2 declined as already sold').toBe('declined')

  // Buyer 2 sees the legible outcome in the thread UI.
  await buyer2.goto(`/messages?thread=${t2}`)
  // Both the declined banner and the system message say this — first match is enough.
  await expect(buyer2.getByText(/sold to another buyer/i).first()).toBeVisible({ timeout: 15_000 })
  await shot(buyer2, ti, 'buyer2 — sold to another buyer')

  await assertPageClean(buyer2, ti)
  await sellerCtx.close(); await b1Ctx.close(); await b2Ctx.close()
})
