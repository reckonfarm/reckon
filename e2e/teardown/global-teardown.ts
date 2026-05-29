import { loadEnv } from '../fixtures/env'
import { adminClient } from '../fixtures/admin'
import { SELLER, BUYER, BUYER2 } from '../fixtures/data'

// Deletes the three test users — FK ON DELETE CASCADE wipes their profiles,
// listings, threads, messages, reviews, saved_searches, watchlist, and the
// radar/demand dedup rows. One call removes essentially all test data.
export default async function globalTeardown(): Promise<void> {
  loadEnv()
  const admin = adminClient()
  const targets = new Set([SELLER, BUYER, BUYER2].map(e => e.toLowerCase()))

  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (!data) break
    for (const u of data.users) {
      if (u.email && targets.has(u.email.toLowerCase())) {
        await admin.auth.admin.deleteUser(u.id).catch(() => {})
        // eslint-disable-next-line no-console
        console.log('[teardown] deleted', u.email)
      }
    }
    if (data.users.length < 200) break
  }
}
