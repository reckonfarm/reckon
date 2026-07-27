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
    absolute: 'Dryline — Ranch Intelligence for Cattle Country',
  },
  description: flagEnabled('marketplace')
    ? "Cattle-country markets and news, real-time drought conditions, FSA/LFP payment estimates, and a hay marketplace — bringing your operation's markets, money, and conditions together in one place."
    : "Cattle-country markets and news, real-time drought conditions, and FSA/LFP payment estimates — bringing your operation's markets, money, and conditions together in one place.",
}

// Note: /?fips=… is still a meaningful URL — middleware.ts skips its signed-in redirect
// when the param is present so share links keep working — but the page itself no longer
// reads it (the homepage's last fips consumer was removed in Block 1; prop dropped in
// Block 2).
export default async function Home() {
  return <FrontDoor />
}
