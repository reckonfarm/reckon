import { test, expect } from '@playwright/test'
import { contextOptions, watchPage, assertPageClean, shot } from '../../fixtures/test'
import { STORAGE, SENTINEL_HAY, TEST_COUNTY_FIPS, TEST_COUNTY_QUERY } from '../../fixtures/data'

// EMAIL-SUPPRESSION VERIFICATION — must pass before any real posting/close spec.
//
// Exercises both server-side email-trigger paths on the preview:
//   1. POST /api/hay  → after() runs Hay Radar + demand routing
//   2. messaging       → sendMessageNotification (recipient is "away")
// Safe by construction: the listing uses the SENTINEL hay type (matches no real
// saved search / opted-in seller), and the message recipient is the test seller —
// so even if suppression were off, NO real user could be emailed. The definitive
// "zero sends" check is the Resend dashboard for the printed UTC window.
test('email suppression: trigger paths fire with no possible real-user email', async ({ browser }) => {
  test.setTimeout(90_000)

  const sellerCtx = await browser.newContext(contextOptions({ storageState: STORAGE.seller }))
  const buyerCtx  = await browser.newContext(contextOptions({ storageState: STORAGE.buyer }))
  const seller = await sellerCtx.newPage()
  const buyer  = await buyerCtx.newPage()
  watchPage(seller, 'seller'); watchPage(buyer, 'buyer')

  const windowStart = new Date().toISOString()

  // Resolve the test county → numeric id.
  const counties = await sellerCtx.request.get(`/api/counties?search=${encodeURIComponent(TEST_COUNTY_QUERY)}`)
    .then(r => r.json()) as Array<{ id: number; fips: string }>
  const county = counties.find(c => c.fips === TEST_COUNTY_FIPS) ?? counties[0]
  expect(county, 'test county resolved').toBeTruthy()

  // 1. Post the sentinel SELL listing (fires radar/demand after()).
  const postRes = await sellerCtx.request.post('/api/hay', {
    data: {
      county_id: county.id, listing_type: 'sell', hay_type: SENTINEL_HAY,
      contact: 'e2e@dryline.farm', price_per_ton: 200, tonnage: 40,
      description: 'E2E suppression-verification listing — safe to ignore.',
    },
  })
  expect(postRes.ok(), 'sentinel listing created').toBeTruthy()
  const { id: listingId } = await postRes.json() as { id: number }

  // 2. Buyer opens a thread + sends a message → notification path (seller is away).
  const threadRes = await buyerCtx.request.post('/api/threads', { data: { listing_id: listingId } })
  expect(threadRes.ok(), 'thread opened').toBeTruthy()
  const { id: threadId } = await threadRes.json() as { id: number }

  const msgRes = await buyerCtx.request.post(`/api/threads/${threadId}/messages`, {
    data: { body: 'E2E suppression probe — please ignore.' },
  })
  expect(msgRes.ok(), 'message sent (notification path fired)').toBeTruthy()

  const windowEnd = new Date().toISOString()

  // Screenshot the thread from the buyer's side for the report.
  await buyer.goto(`/messages?thread=${threadId}`)
  await buyer.waitForLoadState('networkidle').catch(() => {})
  await shot(buyer, test.info(), 'suppression — buyer thread after probe')

  const note =
    `EMAIL-SUPPRESSION WINDOW (UTC): ${windowStart} → ${windowEnd}\n` +
    `Triggered: POST /api/hay (radar+demand after()) and 1 message notification.\n` +
    `Sentinel hay_type="${SENTINEL_HAY}" → no real saved search/opted-in seller can match.\n` +
    `Message recipient = test seller only.\n` +
    `ACTION: confirm ZERO emails in the Resend dashboard for this window. ` +
    `If EMAILS_DISABLED=1 is live on the preview, there will be none.`
  await test.info().attach('SUPPRESSION-WINDOW', { body: note, contentType: 'text/plain' })
  // eslint-disable-next-line no-console
  console.log('\n========== EMAIL SUPPRESSION ==========\n' + note + '\n=======================================\n')

  await assertPageClean(seller, test.info())
  await assertPageClean(buyer, test.info())
  await sellerCtx.close(); await buyerCtx.close()
})
