import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'

// Block 7.6 — a signed-in person who lands here is not looking for a county.
// They mistyped, or followed a link the app itself used to offer, and the only
// way out was "Search counties" — the public funnel, which reads as being
// thrown out of your own ranch. Signed in, the way back is Today.
export default async function NotFound() {
  let signedIn = false
  try {
    const supabase = await createClient()
    signedIn = !!(await supabase.auth.getUser()).data.user
  } catch { /* a 404 must render for anyone, session or not */ }

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <header className="border-b border-forest-green/10">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <Link href="/" className="flex flex-col leading-tight hover:opacity-80 transition-opacity">
            {/* Same mark-left-of-wordmark lockup as SiteHeader (brand, commit 3);
                this header is a local copy, not the shared component — flagged. */}
            <span className="flex items-center gap-2">
              <img src="/brand/dryline-mark.svg" alt="" aria-hidden className="h-[30px] w-auto shrink-0" />
              <span className="font-fraunces text-2xl font-bold text-forest-green">
                Dryline
              </span>
            </span>
            <span className="text-[14px] sm:text-[14px] leading-tight text-secondary-ink font-dm-sans">
              Your ranch, on the record.
            </span>
          </Link>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-forest-green/8 mx-auto">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-secondary-ink">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <h1 className="font-fraunces text-3xl font-semibold text-forest-green mb-3">
            Page not found
          </h1>
          <p className="font-dm-sans text-secondary-ink mb-6">
            {signedIn
              ? 'This page does not exist. Everything on the ranch is on Today.'
              : 'This page does not exist. Search for your county to check drought conditions and FSA program status.'}
          </p>
          <Link
            href={signedIn ? '/today' : '/'}
            className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-forest-green px-5 py-2.5 font-dm-sans text-[16px] font-semibold text-cream hover:bg-forest-green/90 transition-colors"
            data-audit="notfound-primary"
          >
            {signedIn ? 'Back to Today' : 'Search counties'}
          </Link>
        </div>
      </main>
    </div>
  )
}
