import type { Metadata } from 'next'
import FrontDoor from '@/app/components/FrontDoor'

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
  description:
    "Cattle-country markets and news, real-time drought conditions, FSA/LFP payment estimates, and a hay marketplace — bringing your operation's markets, money, and conditions together in one place.",
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ fips?: string }>
}) {
  const { fips: fipsParam } = await searchParams
  const fips = fipsParam || null
  return <FrontDoor fips={fips} />
}
