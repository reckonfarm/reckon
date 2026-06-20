import type { Metadata } from 'next'
import FrontDoor from '@/app/components/FrontDoor'

// PREVIEW-ONLY, unlinked orphan route (no nav links to it). Renders the shared FrontDoor
// front door — identical to what / now renders — kept as a preview surface for reviewing
// future homepage iterations before they reach /.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Markets (preview)',
  description: 'Cattle-country news and markets — preview surface.',
  robots: { index: false, follow: false },
}

export default async function MarketsPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ fips?: string }>
}) {
  const { fips: fipsParam } = await searchParams
  const fips = fipsParam || null
  return <FrontDoor fips={fips} />
}
