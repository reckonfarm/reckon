import type { Metadata } from 'next'
import MarketsHome from '@/app/components/MarketsHome'

// PREVIEW-ONLY, unlinked orphan route (no nav links to it). Renders the shared
// MarketsHome surface — identical to what / will render in Phase 2 — so the full
// real homepage can be reviewed on the preview URL before / flips. Deletable once
// / is the canonical Markets home.

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
  return <MarketsHome fips={fips} />
}
