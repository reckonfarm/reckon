import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { flagEnabled } from '@/lib/flags'
import { CONTACT_EMAIL, OPERATOR_NAME } from '@/lib/legal'
import { privateTitle } from '@/lib/private-title'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import ProfileForm from './ProfileForm'
import RanchNameCard from './RanchNameCard'
import RanchPeopleCard from './RanchPeopleCard'
import SignOutButton from './SignOutButton'

// ─── /account (Block 6A) ──────────────────────────────────────────────────────
// Behind the header's Account button: identity · ranch settings · crew and
// access · preferences · help · sign out. One page, in that order.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Account')

const link = 'inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2'

export default async function AccountPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/account')
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Account</p>
        <h1 className="mt-1 type-page-heading text-ink">{user.email}</h1>

        <section className="mt-6" aria-labelledby="acct-identity">
          <h2 id="acct-identity" className={EYEBROW}>Identity</h2>
          <ProfileForm />
        </section>

        <section className="mt-6" aria-labelledby="acct-ranch">
          <h2 id="acct-ranch" className={EYEBROW}>Ranch settings</h2>
          <RanchNameCard />
        </section>

        <section className="mt-6" aria-labelledby="acct-crew">
          <h2 id="acct-crew" className={EYEBROW}>Crew and access</h2>
          <RanchPeopleCard />
          {flagEnabled('messaging') && (
            <Card className="mt-3 px-5 py-4">
              <Link href="/messages" className={link}>Messages →</Link>
            </Card>
          )}
        </section>

        <section className="mt-6" aria-labelledby="acct-prefs">
          <h2 id="acct-prefs" className={EYEBROW}>Preferences</h2>
          <Card className="px-5 py-4">
            <ul className="divide-y divide-rule">
              <li><Link href="/weather/locations" className={link} data-audit="pref-counties">My Counties →</Link><p className="font-dm-sans text-[15px] text-secondary-ink">Home county, watched counties, and alert preferences.</p></li>
              {flagEnabled('marketplace') && <li className="pt-2"><Link href="/hay" className={link}>Hay marketplace →</Link></li>}
            </ul>
          </Card>
        </section>

        <section className="mt-6" aria-labelledby="acct-help">
          <h2 id="acct-help" className={EYEBROW}>Help</h2>
          <Card className="px-5 py-4">
            <p className="font-dm-sans text-[16px] text-ink">Questions or something wrong? Write to <a href={`mailto:${CONTACT_EMAIL}`} className={link}>{CONTACT_EMAIL}</a>.</p>
            <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink">{OPERATOR_NAME}. <Link href="/terms" className="underline underline-offset-2">Terms</Link> · <Link href="/privacy" className="underline underline-offset-2">Privacy</Link></p>
            <p className="mt-2"><Link href="/ranch/devices/setup" className={link}>Setting up a device →</Link></p>
          </Card>
        </section>

        <section className="mt-6" aria-labelledby="acct-signout">
          <h2 id="acct-signout" className={EYEBROW}>Sign out</h2>
          <Card className="px-5 py-4">
            <p className="font-dm-sans text-[16px] text-ink">Signing out clears everything private from this phone — the outbox, drafts, and receipts — before the next person picks it up.</p>
            <SignOutButton />
          </Card>
        </section>
      </main>
    </>
  )
}
