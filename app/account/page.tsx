import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
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
        {/* Block 7.10 — an address long enough to be a real one must wrap inside
            the card rather than widen the page on a 320px phone. */}
        <h1 className="mt-1 type-page-heading break-words text-ink">{user.email}</h1>

        <section className="mt-6" aria-labelledby="acct-identity">
          <h2 id="acct-identity" className={`${EYEBROW} !text-ink`}>Identity</h2>
          <ProfileForm />
        </section>

        <section className="mt-6" aria-labelledby="acct-ranch">
          <h2 id="acct-ranch" className={`${EYEBROW} !text-ink`}>Ranch settings</h2>
          <RanchNameCard />
        </section>

        <section className="mt-6" aria-labelledby="acct-crew">
          <h2 id="acct-crew" className={`${EYEBROW} !text-ink`}>Crew and access</h2>
          <RanchPeopleCard />
          {/* Block 7.6 — the Messages link is gone. /messages renders "Page not
              found" while messaging is flagged off, and the flag has been off
              since the North Star v3 demotion. It was already invisible here
              (flagEnabled('messaging') hid it), so nothing on screen changes;
              what goes is a link to a dead page waiting for a flag flip. */}
        </section>

        <section className="mt-6" aria-labelledby="acct-prefs">
          <h2 id="acct-prefs" className={`${EYEBROW} !text-ink`}>Preferences</h2>
          <Card className="px-5 py-4">
            <ul className="divide-y divide-rule">
              <li><Link href="/weather/locations" className={link} data-audit="pref-counties">My Counties →</Link><p className="font-dm-sans text-[15px] text-secondary-ink">Home county, watched counties, and alert preferences.</p></li>
            </ul>
          </Card>
        </section>

        <section className="mt-6" aria-labelledby="acct-help">
          <h2 id="acct-help" className={`${EYEBROW} !text-ink`}>Help</h2>
          <Card className="px-5 py-4">
            <p className="font-dm-sans text-[16px] text-ink">Questions or something wrong? Write to <a href={`mailto:${CONTACT_EMAIL}`} className={link}>{CONTACT_EMAIL}</a>.</p>
            <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink">{OPERATOR_NAME}. <Link href="/terms" className="underline underline-offset-2">Terms</Link> · <Link href="/privacy" className="underline underline-offset-2">Privacy</Link></p>
            <p className="mt-2"><Link href="/ranch/devices/setup" className={link}>Setting up a device →</Link></p>
            {/* Block 7.7 — the Feedback button left Today, where it floated over the
                controls the screen exists for. It is still on every other page, and
                this says so, because a button that moved without a word is a button
                a person concludes was taken away. */}
            <p className="mt-2 font-dm-sans text-[15px] text-secondary-ink" data-audit="help-feedback">Telling us something is off: the <span className="font-semibold">Feedback</span> button sits in the corner of every page except Today, this one included.</p>
          </Card>
        </section>

        <section className="mt-6" aria-labelledby="acct-signout">
          <h2 id="acct-signout" className={`${EYEBROW} !text-ink`}>Sign out</h2>
          <Card className="px-5 py-4">
            <p className="font-dm-sans text-[16px] text-ink">Signing out clears everything private from this phone — the outbox, drafts, and receipts — before the next person picks it up. Anything still waiting to sync is sent first; if any of it will not go, you are told how many and asked before it is discarded.</p>
            <SignOutButton />
          </Card>
        </section>
      </main>
    </>
  )
}
