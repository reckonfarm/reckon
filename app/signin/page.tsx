import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import SignInForm from './SignInForm'

// ?next= and ?mode= are validated HERE (server) and passed as props — no
// useSearchParams in the client form. next must be an internal path ('/…', never
// '//…' protocol-relative) or it falls back; mode=signup opens the form in
// create-account mode (the FrontDoor CTA's target).
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string }>
}) {
  const { next, mode } = await searchParams
  const nextValid = !!next && next.startsWith('/') && !next.startsWith('//')
  const safeNext = nextValid ? next! : '/watchlist'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    // Already signed in: honor a valid ?next= (they were bounced here from a gated
    // page); plain /signin keeps its existing /dashboard landing.
    redirect(nextValid ? safeNext : '/dashboard')
  }

  return (
    <>
      <SiteHeader />
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <SignInForm next={safeNext} initialMode={mode === 'signup' ? 'signup' : 'signin'} />
      </main>
    </>
  )
}
