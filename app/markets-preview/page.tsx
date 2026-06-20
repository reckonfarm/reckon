import type { Metadata } from 'next'
import FrontDoor from '@/app/components/FrontDoor'

// PREVIEW-ONLY, unlinked orphan route (no nav links to it). Renders the NEW FrontDoor
// front-door redesign so it can be verified on the preview URL BEFORE / flips to it.
// / still renders the current MarketsHome until the flip; at flip time, / repoints to
// FrontDoor and MarketsHome retires.

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
