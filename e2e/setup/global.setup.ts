import { test as setup, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { ensureUser, magicTokenHash } from '../fixtures/admin'
import { contextOptions } from '../fixtures/test'
import { SELLER, BUYER, BUYER2, STORAGE } from '../fixtures/data'

const ACCOUNTS = [
  { email: SELLER, storage: STORAGE.seller, displayName: 'E2E Seller Ranch' },
  { email: BUYER,  storage: STORAGE.buyer,  displayName: 'E2E Buyer' },
  { email: BUYER2, storage: STORAGE.buyer2, displayName: 'E2E Buyer Two' },
]

setup('create test users + authenticate (storageState)', async ({ browser }) => {
  setup.setTimeout(120_000)
  mkdirSync('e2e/.auth', { recursive: true })

  for (const acct of ACCOUNTS) {
    await ensureUser(acct.email)                                  // idempotent
    const tokenHash = await magicTokenHash(acct.email)            // no email sent

    const context = await browser.newContext(contextOptions())
    const page = await context.newPage()

    // Programmatic sign-in via the magic-link callback → sets @supabase/ssr cookies.
    await page.goto(`/auth/callback?token_hash=${tokenHash}&type=magiclink`)
    await page.waitForURL('**/watchlist', { timeout: 30_000 })

    // Give the account a display name so seller pages / threads render a name.
    const res = await context.request.patch('/api/profile', {
      data: { display_name: acct.displayName },
    })
    expect(res.ok(), `set display_name for ${acct.email}`).toBeTruthy()

    await context.storageState({ path: acct.storage })
    await context.close()
  }
})
