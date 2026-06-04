import type { Metadata } from 'next'
import SiteHeader from '@/app/components/SiteHeader'
import SiteFooter from '@/app/components/SiteFooter'
import MarketsNews from '@/app/components/MarketsNews'
import MarketsComingSoon from '@/app/components/MarketsComingSoon'
import { createClient } from '@/lib/supabase-server'

// PREVIEW-ONLY, unlinked orphan route (no nav links to it). The intended Markets
// surface — news feed on top, demand-probe tiles below. Works signed-out and
// signed-in; it does NOT redirect either way (unlike the homepage), so it's safe to
// test both states. Additive: nothing else links here and no live surface changed.

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

  // Resolve sign-in for the demand-probe tiles. Failure → treat as signed-out (the
  // surface must render for everyone); never throws, never redirects.
  let signedIn = false
  try {
    const supabase = await createClient()
    signedIn = Boolean((await supabase.auth.getUser()).data.user)
  } catch {
    signedIn = false
  }

  return (
    <>
      <SiteHeader subtitle="Markets" />
      <main className="min-h-screen bg-cream">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-12">
          <MarketsNews fips={fips} />
          <MarketsComingSoon signedIn={signedIn} />
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
