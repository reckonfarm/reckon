import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { resolveRanchId } from '@/lib/ranch-membership'
import SiteHeader from '@/app/components/SiteHeader'
import SetupForm from './SetupForm'

// ─── Block 31: the one setup screen ─────────────────────────────────────────
// A signed-in person with no ranch sees only this: name the ranch, pick the
// county, one button. It makes the ranch with them as owner and lands them on
// Today. The middleware sends every ranch screen here until then, and sends
// this screen to Today once there is a ranch; this page checks the same two
// things itself, so a stale cookie cannot show it to the wrong person.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Set up your ranch — Dryline' }

export default async function SetupPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/setup')
  if (await resolveRanchId(supabase, user.id)) redirect('/today')
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-5" data-audit="column">
        <h1 className="font-fraunces text-[28px] font-semibold leading-tight text-ink">Name your ranch</h1>
        <SetupForm />
      </main>
    </>
  )
}
