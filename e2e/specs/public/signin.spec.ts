import { test, expect } from '../../fixtures/test'

// Renders the OTP sign-in form. We intentionally do NOT submit — clicking "Send
// code" would dispatch a real Supabase Auth OTP email (a separate channel from
// the app's Resend, not covered by EMAILS_DISABLED). Authenticated login is
// exercised programmatically in global.setup via the magic-token callback.
test('sign-in page renders the OTP form', async ({ page, shot }) => {
  await page.goto('/signin')
  await expect(page.getByText(/Sign in to Dryline/i)).toBeVisible()
  await expect(page.getByPlaceholder(/you@example\.com/i)).toBeVisible()
  await shot('signin — email step')
})
