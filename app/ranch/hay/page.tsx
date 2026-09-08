import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { privateTitle } from '@/lib/private-title'
import SiteHeader from '@/app/components/SiteHeader'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import HayInventoryCard from '@/app/dashboard/components/HayInventoryCard'
import { LedgerLoading } from '@/app/dashboard/components/LedgerTabs'

// ─── /ranch/hay (Block 6A) — the Hay section ──────────────────────────────────
// The same self-gating hay card Today carries (a counted baseline, on hand,
// burn rate, run-out only when its gates pass), on its own page under Ranch.
// Hay accounting beyond that is out of this block's scope.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Hay')

export default async function HayPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/ranch/hay')
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Ranch · Hay</p>
        <h1 className="mt-1 type-page-heading text-ink">Hay</h1>
        <div className="mt-4">
          <Suspense fallback={<LedgerLoading />}><HayInventoryCard /></Suspense>
        </div>
        <p className="mt-4 font-dm-sans text-[16px] text-secondary-ink">Every hay line is in <Link href="/ranch/activity" className="font-semibold text-brand underline underline-offset-2">Activity</Link>.</p>
      </main>
    </>
  )
}
