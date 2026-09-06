import SiteHeader from '@/app/components/SiteHeader'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { inviteForToken } from '@/lib/invitations'
import InviteLanding from './InviteLanding'

// ─── /invite/[token] — where an invitation link lands (Phase A2) ─────────────
// Says what is happening before asking for anything: who invited you, to which
// ranch, what you'll be able to do. The token stays in the URL through sign-up
// or sign-in (?next=/invite/<token>), so whichever path they take they come
// back here signed in, and the accept happens — then they land INSIDE the
// ranch. The lookup here is read-only (the hash, never the token, is stored).
export const dynamic = 'force-dynamic'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [view, supabase] = await Promise.all([inviteForToken(createServiceClient(), token), createClient()])
  const { data: { user } } = await supabase.auth.getUser()
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <InviteLanding token={token} view={view} signedInEmail={user?.email?.toLowerCase() ?? null} />
      </main>
    </>
  )
}
