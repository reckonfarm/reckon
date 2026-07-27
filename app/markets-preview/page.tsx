import type { Metadata } from 'next'
import FrontDoor from '@/app/components/FrontDoor'

// PREVIEW-ONLY, unlinked orphan route (no nav links to it). Renders the shared FrontDoor
// front door — identical to what / now renders — kept as a preview surface for reviewing
// future homepage iterations before they reach /.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Homepage (preview)',
  description: 'Homepage preview surface.',
  robots: { index: false, follow: false },
}

export default async function MarketsPreviewPage() {
  return <FrontDoor />
}
