// Shared test constants.

// Test accounts (created in setup, deleted in teardown). dryline.farm domain so
// any (suppressed) mail would route to a domain the team controls.
export const SELLER = 'e2e-seller@dryline.farm'
export const BUYER  = 'e2e-buyer@dryline.farm'
export const BUYER2 = 'e2e-buyer2@dryline.farm'

export const STORAGE = {
  seller: 'e2e/.auth/seller.json',
  buyer:  'e2e/.auth/buyer.json',
  buyer2: 'e2e/.auth/buyer2.json',
}

// Sentinel hay type — guaranteed to match NO real saved search or opted-in
// listing, so posting it can never reach a real user via radar/demand even if
// the kill-switch were off. Used for every listing the suite creates.
export const SENTINEL_HAY = 'ZZZ-E2E-DONOTBUY'

// A county the post/listing flows attach to. Lincoln County, NE (FIPS 31109) —
// a real seeded county with coordinates; chosen because it reliably exists.
export const TEST_COUNTY_QUERY = 'Lincoln'
export const TEST_COUNTY_FIPS  = '31109'
