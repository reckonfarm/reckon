import type { Metadata } from 'next'
import FrontDoor from '@/app/components/FrontDoor'
import { flagEnabled } from '@/lib/flags'

// The signed-out landing — the acquisition front door (Fraunces hero + county-search hook +
// the labeled Example HerdEstimate + signup CTA). Signed-in users are redirected by
// middleware.ts (bare / → /dashboard), so this renders for anonymous visitors (and signed-in
// users who hit /?fips=…). Delegates to the shared FrontDoor component, also rendered at
// /markets-preview.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: {
    absolute: 'Dryline — Your ranch, on the record.',
  },
  description: flagEnabled('marketplace')
    ? "A shared feeding record for your ranch — log the feed from your phone, see what's left, and leave the next person a clear handoff. Works with no signal and no hardware."
    : "A shared feeding record for your ranch — log the feed from your phone, see what's left, and leave the next person a clear handoff. Works with no signal and no hardware.",
}

// Note: /?fips=… is still a meaningful URL — middleware.ts skips its signed-in redirect
// when the param is present so share links keep working — but the page itself no longer
// reads it (the homepage's last fips consumer was removed in Block 1; prop dropped in
// Block 2).
export default async function Home() {
  return <FrontDoor />
}
