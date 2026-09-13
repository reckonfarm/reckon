import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { privateTitle } from '@/lib/private-title'
import SiteHeader from '@/app/components/SiteHeader'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { getRanchLots } from '@/lib/herd-lots'
import { lotLabel } from '@/lib/herd'
import { todayKey } from '@/lib/jobs/format'
import PregCheck, { type ChuteLot } from './PregCheck'

// ─── /ranch/preg-check (Block 10) ─────────────────────────────────────────────
// The narrow path, built first and on the real group model rather than beside
// it: a dated event that produces named result groups with their own counts,
// reconciling against what was counted at the chute. Shipping, sorting and
// weaning are the same primitive (063's record_group_action) and will reuse it
// without a migration — only this screen is preg-check-shaped.
//
// Its own page, not a sheet: at a chute the screen should be the working and
// nothing else, with no chrome to mis-tap and nothing that closes by accident.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Preg check')

export default async function PregCheckPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/ranch/preg-check')

  const lots = await getRanchLots(supabase)
  // `updatedAt` rides along as the compare-and-set token's sibling: the head
  // count the recorder had on screen is what 063 checks against, so a bunch
  // someone else moved refuses instead of clobbering.
  const chuteLots: ChuteLot[] = lots.map(l => ({
    id: l.id, name: lotLabel(l), head: l.head_count, updatedAt: l.updated_at,
  }))

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Ranch · Cattle</p>
        <h1 className="mt-1 type-page-heading text-ink">Preg check</h1>
        <PregCheck lots={chuteLots} today={todayKey()} />
        <p className="mt-6 font-dm-sans text-[16px] text-secondary-ink">
          Every working is in <Link href="/ranch/activity" className="font-semibold text-brand underline underline-offset-2">Activity</Link>,
          and can be corrected there.
        </p>
      </main>
    </>
  )
}
