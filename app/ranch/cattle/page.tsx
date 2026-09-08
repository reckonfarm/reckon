import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { privateTitle } from '@/lib/private-title'
import { getRanchLots, lotPurposeSupported } from '@/lib/herd-lots'
import { lastWorkByLot } from '@/lib/ranch-summary'
import SiteHeader from '@/app/components/SiteHeader'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import HerdForm from './HerdForm'

// ─── /ranch/cattle (Block 6A) — the Cattle section ────────────────────────────
// One row per lot: head count, name, purpose, last recorded work. No current
// place — herd_lots has no place column and a cattle-moved event carrying head
// and a place is a different fact; nothing is inferred. "View market
// comparison" opens Markets on the lot. Remove is Archive, in a secondary
// menu, with its consequence stated; the lot's past events keep resolving.
// The herd estimate left this page (6B folds it into Markets).
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Cattle')

export default async function CattlePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/ranch/cattle')
  const lots = await getRanchLots(supabase, user.id)
  const [lastWork, purposeSupported] = await Promise.all([
    lastWorkByLot(supabase, lots.map(l => l.id)).catch(() => ({})),
    lotPurposeSupported(supabase).catch(() => false),
  ])
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Ranch · Cattle</p>
        <h1 className="mt-1 type-page-heading text-ink">Cattle</h1>
        <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">
          What you&rsquo;re running, by lot. Values and comparisons are on <Link href="/markets" className="font-semibold text-brand underline underline-offset-2">Markets</Link>.
        </p>
        <HerdForm initialLots={lots} lastWork={lastWork} purposeSupported={purposeSupported} />
      </main>
    </>
  )
}
