import type { Metadata } from 'next'
import MarketsHome from '@/app/components/MarketsHome'

// The default landing for EVERYONE — anonymous and signed-in — is the Markets
// surface (county-search funnel + driest chips + drought map + news + tiles). No
// redirect: signed-in users land here too (the drought dashboard stays reachable at
// /dashboard via the My Operation tab and the chips/search). Rendering is delegated
// to the shared MarketsHome component, also used by /markets-preview.

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
  return <MarketsHome fips={fips} />
}
