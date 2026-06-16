import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Heading } from '@/app/components/ui/Heading'
import HerdForm from './HerdForm'

// Private, operation-scoped herd entry (operation_profiles.herd via /api/operation-profile).
// Auth-gated exactly like /profile — the herd is private, owner-only data (RLS), NOT the
// marketplace-identity page. Capture-first: lots are head counts + weights now; dollar
// valuation (MARS + HerdEstimate engine) lands in a later step, not here.
export default async function HerdPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Heading level={2}>My herd</Heading>
        <p className="mt-1 font-dm-sans text-sm text-muted/70">
          What you&rsquo;re running, by lot. Add head counts and weights now — sharpen frame,
          weaning, and sale timing whenever you like.
        </p>
        <HerdForm />
      </main>
    </>
  )
}
