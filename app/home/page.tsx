import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getHomeCountyFips } from '@/lib/concierge-service'

// ─── /home → the county dashboard (shell pass, commit 3) ───────────────────────
// Today on /dashboard absorbed everything this page rendered (Log it, today's
// sessions, season totals, hay, recently logged, herd value). The URL stays
// alive for home-screen bookmarks and old links: a signed-in visit is
// redirected by middleware.ts in the same hop as "/" (the refreshed session
// lives there — see the Server Component getUser note in middleware.ts); this
// page is the fallback for anything that slipped past it, and the signed-out
// case, which goes to sign in and comes back to the dashboard.

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/dashboard')
  const homeFips = await getHomeCountyFips(user.id).catch(() => null)
  redirect(homeFips ? `/dashboard?fips=${homeFips}` : '/dashboard')
}
