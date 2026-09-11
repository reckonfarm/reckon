'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { flagDisabled } from '@/lib/flags'
import type { User } from '@supabase/supabase-js'
import { bindPrivateStateTo } from '@/lib/private-state'
import { openLogIt } from '@/app/dashboard/components/LogIt'

// Block 7.7 — the tagline is a signed-OUT promise. On the ranch's own work
// screen it is a second line of chrome above the first thing a person came to
// do, repeating what they already know, on the narrowest screen the app has.
// Today gets the compact lockup: mark, wordmark, ranch, account. Every other
// page keeps the full one.
//
// The wordmark tagline is a fixed lockup — rendered identically on every page, never
// overridden per-caller. (Was previously a per-page `subtitle` prop, which drifted:
// "Markets" on the homepage, nothing on most pages.)
const TAGLINE = 'Your ranch, on the record.'

const NAV: { href: string; label: string }[] = [
  { href: '/today',   label: 'Today' },
  { href: '/ranch',   label: 'Ranch' },
  { href: '/markets', label: 'Markets' },
  { href: '/weather', label: 'Weather' },
]

interface Props {
  center?: React.ReactNode
}

export default function SiteHeader({ center }: Props) {
  const pathname = usePathname()
  const compact = pathname === '/today'
  const [user, setUser] = useState<User | null>(null)
  const [unread, setUnread] = useState(0)
  // Block 6A — the selected ranch, on every page for a signed-in person. One
  // small read per session, cached per user in sessionStorage (cleared by
  // sign-out and by an account switch with everything else private).
  const [fetchedRanch, setFetchedRanch] = useState<{ uid: string; name: string | null } | null>(null)
  const cacheKey = user ? `dryline_ranch_name:${user.id}` : null
  const cachedRanch = (() => { try { return cacheKey ? sessionStorage.getItem(cacheKey) : null } catch { return null } })()
  const ranchName = user ? (cachedRanch ?? (fetchedRanch?.uid === user.id ? fetchedRanch.name : null)) : null
  useEffect(() => {
    if (!user || cachedRanch) return
    let cancelled = false
    const uid = user.id, key = `dryline_ranch_name:${uid}`
    fetch('/api/ranch').then(r => (r.ok ? r.json() : null)).then((j: { ranch?: { name?: string } | null } | null) => {
      if (cancelled) return
      const name = j?.ranch?.name?.trim() || null
      setFetchedRanch({ uid, name })
      try { if (name) sessionStorage.setItem(key, name) } catch { /* private mode */ }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [user, cachedRanch])

  useEffect(() => {
    const supabase = createClient()
    // Read the locally-stored session (no network round-trip) so the header
    // reflects auth state reliably even on a slow/flaky connection. getUser()
    // hits the network to re-validate the token; on poor signal it can hang or
    // reject, which (with no catch) left the header stuck on "Sign in" for a
    // signed-in user. onAuthStateChange keeps it in sync afterwards.
    // Block 5D: whoever is signed in owns the phone's private state; state
    // written under someone else is cleared before any surface reads it.
    supabase.auth.getSession()
      .then(({ data }) => { bindPrivateStateTo(data.session?.user?.id ?? null); setUser(data.session?.user ?? null) })
      .catch(() => { /* local read only — never strand the header */ })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      bindPrivateStateTo(session?.user?.id ?? null)
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

  return (
    <header className="sticky top-0 z-20 border-b border-forest-green/10 bg-cream/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">

        <Link href="/" className="flex min-h-[48px] flex-col justify-center leading-tight">
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
          {!compact && (
            <span className="text-[14px] sm:text-[14px] leading-tight text-ink font-dm-sans">
              {TAGLINE}
            </span>
          )}
        </Link>

        {center && (
          <p className="hidden text-[16px] text-secondary-ink font-dm-sans sm:block">
            {center}
          </p>
        )}
        {/* Block 6A — the ranch, the same on every private page. County selection
            changes public information context only; it never changes this. */}
        {user && ranchName && (
          <p className="min-w-0 flex-1 truncate px-3 text-center font-dm-sans text-[15px] font-semibold text-forest-green sm:text-[16px]" data-audit="header-ranch">
            {ranchName}
          </p>
        )}

        <div className="flex items-center gap-4">
          {/* Menu links — DESKTOP ONLY. On mobile the BottomTabBar (md:hidden)
              carries navigation, so these hide at exactly the same `md` breakpoint
              to avoid duplicate nav. Logo + Sign out below stay visible on mobile. */}
          {/* Block 6A — primary navigation: Today · Ranch · Markets · Weather (desktop;
              the bottom bar carries the same four on mobile), then Record — an
              action, not a destination — then the compact Account button. Devices
              live inside Ranch, Messages under Account → Crew, Radar inside Weather. */}
          {user && (
            <nav className="hidden items-center gap-1 md:flex" aria-label="Primary" data-audit="primary-nav">
              {NAV.map(n => (
                <Link key={n.href} href={n.href} className="inline-flex min-h-[48px] items-center rounded-lg px-3 font-dm-sans text-[16px] font-medium text-ink hover:bg-forest-green/5 hover:text-brand transition-colors">
                  {n.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={() => openLogIt({ type: null })}
                className="ml-2 inline-flex min-h-[48px] items-center rounded-lg bg-forest-green px-4 font-dm-sans text-[16px] font-semibold text-cream hover:bg-forest-green/90 transition-colors"
                data-audit="record-button"
              >
                Record
              </button>
            </nav>
          )}
          {user ? (
            <Link
              href="/account"
              className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-forest-green/20 px-4 font-dm-sans text-[16px] font-medium text-forest-green hover:bg-forest-green/5 transition-colors"
              data-audit="account-button"
            >
              Account
              {unread > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-1 text-[14px] font-semibold text-white" aria-label={`${unread} unread messages`}>
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>
          ) : (
            <Link
              href="/signin"
              className="inline-flex min-h-[48px] items-center rounded-lg border border-forest-green/20 px-4 font-dm-sans text-[16px] font-medium text-forest-green hover:bg-forest-green/5 transition-colors"
            >
              Sign in
            </Link>
          )}
        </div>

      </div>
    </header>
  )
}
