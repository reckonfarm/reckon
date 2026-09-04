import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { flagEnabled } from '@/lib/flags'
import SiteHeader from '@/app/components/SiteHeader'
import ProfileForm from './ProfileForm'
import RanchNameCard from './RanchNameCard'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/profile')

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">Your profile</h1>
        <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
          {flagEnabled('marketplace')
            ? 'This is how buyers and sellers see you on the hay marketplace.'
            : 'Your operation, as Dryline knows it.'}
        </p>
        {/* The outfit's name first (flow, commit 2) — the operation's identity;
            absent entirely for a person with no ranch membership. */}
        <RanchNameCard />
        {/* Counties left the bottom bar (shell pass, commit 5): the watchlist —
            home county, watched counties, alert preferences — is reached from
            here now, one tap, a real 44px target. */}
        <Link
          href="/watchlist"
          className="mt-5 flex min-h-[52px] items-center justify-between rounded-xl border border-forest-green/15 bg-white px-5 font-dm-sans text-base font-medium text-forest-green transition-colors hover:bg-forest-green/5"
        >
          <span>Your counties</span>
          <span aria-hidden className="text-forest-green/40">›</span>
        </Link>
        <ProfileForm />
      </main>
    </>
  )
}
