'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { flagDisabled, flagEnabled } from '@/lib/flags'
import type { User } from '@supabase/supabase-js'
import { hasUnsynced } from '@/lib/outbox'

// The wordmark tagline is a fixed lockup — rendered identically on every page, never
// overridden per-caller. (Was previously a per-page `subtitle` prop, which drifted:
// "Markets" on the homepage, nothing on most pages.)
const TAGLINE = 'Ranch Intelligence for Cattle Country'

interface Props {
  center?: React.ReactNode
}

export default function SiteHeader({ center }: Props) {
  const [user, setUser] = useState<User | null>(null)
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    // Read the locally-stored session (no network round-trip) so the header
    // reflects auth state reliably even on a slow/flaky connection. getUser()
    // hits the network to re-validate the token; on poor signal it can hang or
    // reject, which (with no catch) left the header stuck on "Sign in" for a
    // signed-in user. onAuthStateChange keeps it in sync afterwards.
    supabase.auth.getSession()
      .then(({ data }) => setUser(data.session?.user ?? null))
      .catch(() => { /* local read only — never strand the header */ })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    // Messaging flagged off → no badge and, as importantly, no per-nav
    // /api/threads/unread round-trip for every signed-in user.
    if (!user || flagDisabled('messaging')) { setUnread(0); return }
    fetch('/api/threads/unread')
      .then(r => r.ok ? r.json() : { count: 0 })
      .then(d => setUnread(typeof d?.count === 'number' ? d.count : 0))
      .catch(() => {})
  }, [user])

  async function signOut() {
    // Block 2A: anything still on the phone would be orphaned by a sign-out.
    if (hasUnsynced() && !window.confirm('Some entries have not synced to the ranch yet. Sign out anyway and lose them?')) return
    const supabase = createClient()
    await supabase.auth.signOut()
  }

  return (
    <header className="sticky top-0 z-20 border-b border-forest-green/10 bg-cream/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">

        <Link href="/" className="flex flex-col leading-tight">
          {/* The rope-line mark sits left of the wordmark (brand, commit 3). Its ink
              fills 44.8 of the file's 80 viewBox units, so the box is drawn at
              80/44.8 × the wordmark's cap height (Fraunces ≈ 0.7em: 14px at
              text-xl, 17px at text-2xl) — the LINE matches the caps, not the
              box. Decorative: the text beside it is the accessible name. */}
          <span className="flex items-center gap-2">
            <img
              src="/brand/dryline-mark.svg"
              alt=""
              aria-hidden
              className="h-[25px] w-auto shrink-0 sm:h-[30px]"
            />
            <span className="font-fraunces text-xl font-semibold text-forest-green sm:text-2xl">
              Dryline
            </span>
          </span>
          <span className="text-[11px] sm:text-xs leading-tight text-forest-green/50 font-dm-sans">
            {TAGLINE}
          </span>
        </Link>

        {center && (
          <p className="hidden text-sm text-forest-green/60 font-dm-sans sm:block">
            {center}
          </p>
        )}

        <div className="flex items-center gap-4">
          {/* Menu links — DESKTOP ONLY. On mobile the BottomTabBar (md:hidden)
              carries navigation, so these hide at exactly the same `md` breakpoint
              to avoid duplicate nav. Logo + Sign out below stay visible on mobile. */}
          <div className="hidden items-center gap-4 md:flex">
            <Link
              href="/watchlist"
              className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors"
            >
              My Counties
            </Link>
            {flagEnabled('marketplace') && (
              <Link
                href="/hay"
                className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors"
              >
                Hay
              </Link>
            )}
            {/* Home-base anchor — mirrors the bottom nav's "My Operation". Routes to
                the ranch home (via '/', which middleware-redirects signed-in users to
                /home). SIGNED-IN ONLY (Block 2): for a signed-out visitor '/' is
                the page they're already on — the link was a self-referencing loop. */}
            {user && (
              <Link
                href="/"
                className="font-dm-sans text-sm font-medium text-forest-green hover:text-forest-green/80 transition-colors"
              >
                My Operation
              </Link>
            )}
            {user && (
              <Link
                href="/herd"
                className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors"
              >
                My herd
              </Link>
            )}
            {/* Jobs — the work-session ledger, the Scout's payoff surface. */}
            {user && (
              <Link
                href="/jobs"
                className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors"
              >
                Jobs
              </Link>
            )}
            {/* Devices — the registry (S2), in the signed-in cluster where
                Messages sat before its flag-off. */}
            {user && (
              <Link
                href="/devices"
                className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors"
              >
                Devices
              </Link>
            )}
            {user && flagEnabled('messaging') && (
              <Link
                href="/messages"
                className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors"
              >
                Messages{unread > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-1 text-[10px] font-semibold text-white align-middle">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </Link>
            )}
            {user && flagEnabled('marketplace') && (
              <Link
                href="/radar"
                className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors"
              >
                Hay Radar
              </Link>
            )}
            {user && (
              <Link
                href="/profile"
                className="max-w-[160px] truncate text-xs text-forest-green/40 font-dm-sans hover:text-forest-green transition-colors"
              >
                {user.email}
              </Link>
            )}
          </div>

          {/* Auth control — ALWAYS visible (incl. mobile). Sign out is the one nav
              action the bottom tab bar doesn't carry. */}
          {user ? (
            <button
              onClick={signOut}
              className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green transition-colors"
            >
              Sign out
            </button>
          ) : (
            <Link
              href="/signin"
              className="rounded-lg border border-forest-green/20 px-3 py-1.5 font-dm-sans text-sm font-medium text-forest-green hover:bg-forest-green/5 transition-colors"
            >
              Sign in
            </Link>
          )}
        </div>

      </div>
    </header>
  )
}
