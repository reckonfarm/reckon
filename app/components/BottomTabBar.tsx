'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { flagDisabled, flagEnabled } from '@/lib/flags'
import { HOME_COUNTY_CHANGED } from '@/app/dashboard/components/HomeCountyButton'

// ─── Bottom nav (mobile) — four flank items around a raised "Operation" anchor ──
// (layout, commit 1). Herd · Jobs  [Operation]  Devices · Profile. The anchor
// is the operation: the county dashboard with Today open, on the home county
// — the SAME target the landing redirect resolves to.
//
// THE TRAP this file must never re-create (flow commit 4a): a <Link> to bare
// /dashboard gets prefetched; for a signed-in person that response is the
// middleware's 307 to the home county, the router caches the redirected tree
// under the /dashboard key, and later pushes to /dashboard?fips=… get served
// from it. So the anchor is a PLAIN <a> (nav-fixes, commit 1) — the router
// never prefetches it — whose href is the RESOLVED county URL
// (/dashboard?fips=<home>) once the home county is known, else bare
// /dashboard, which a full navigation resolves through the middleware
// exactly like the landing. The home county is read once per navigation from
// /api/home-county (same cadence as the unread badge); signed out it's a
// 401 → null.
//
// The four view tabs (DroughtCattleToggle) are the in-page navigation INSIDE
// the dashboard; this bar is the route-level one. Two systems, deliberately:
// this bar never changes a view, the toggle never changes a route.

export default function BottomTabBar() {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  const [homeFips, setHomeFips] = useState<string | null>(null)

  // Refresh the messages unread badge on navigation (tolerates signed-out 401).
  // Messaging flagged off → tab hidden below AND this per-nav fetch never fires.
  useEffect(() => {
    if (flagDisabled('messaging')) return
    let cancelled = false
    fetch('/api/threads/unread')
      .then(r => r.ok ? r.json() : { count: 0 })
      .then(d => { if (!cancelled) setUnread(typeof d?.count === 'number' ? d.count : 0) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [pathname])

  // The anchor's county — re-read on navigation, and again when the Set Home
  // button on Weather announces a change (layout, commit 2), so the anchor
  // resolves to the new county with no reload. Promise-chain, no setState in
  // the effect body (house rule).
  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch('/api/home-county')
        .then(r => (r.ok ? r.json() : { fips: null }))
        .then((d: { fips?: string | null }) => { if (!cancelled) setHomeFips(typeof d?.fips === 'string' && d.fips ? d.fips : null) })
        .catch(() => { if (!cancelled) setHomeFips(null) })
    }
    load()
    window.addEventListener(HOME_COUNTY_CHANGED, load)
    return () => { cancelled = true; window.removeEventListener(HOME_COUNTY_CHANGED, load) }
  }, [pathname])

  // Hide on auth pages
  if (pathname.startsWith('/signin') || pathname.startsWith('/auth')) {
    return null
  }

  interface Tab {
    href: string
    label: string
    match: (p: string) => boolean
    icon: (active: boolean) => React.ReactNode
  }

  const herd: Tab = {
    href: '/herd',
    label: 'Herd',
    match: p => p.startsWith('/herd'),
    icon: (active) => (
      // Cow / steer head — hand-drawn to match the inline-SVG stroke style (no icon lib).
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 8C5.5 7.2 3.6 7.5 2.9 5.6"/>
        <path d="M17 8c1.5-.8 3.4-.5 4.1-2.4"/>
        <path d="M7 8c1.2-1 3-1.6 5-1.6s3.8.6 5 1.6"/>
        <path d="M7 8C6 9.2 5.5 10.8 5.5 12.5 5.5 16 8.4 18.5 12 18.5s6.5-2.5 6.5-6c0-1.7-.5-3.3-1.5-4.5"/>
        <path d="M10.5 13h0"/>
        <path d="M13.5 13h0"/>
      </svg>
    ),
  }
  const jobs: Tab = {
    // Jobs — the work-session ledger, the Scout's payoff surface. Route glyph.
    href: '/jobs',
    label: 'Jobs',
    match: p => p.startsWith('/jobs'),
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="19" r="2.5"/>
        <circle cx="18" cy="5" r="2.5"/>
        <path d="M8.5 19h8a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7h7"/>
      </svg>
    ),
  }
  const devices: Tab = {
    // Devices — antenna/signal glyph, same hand-drawn stroke style.
    href: '/devices',
    label: 'Devices',
    match: p => p.startsWith('/devices'),
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 13v8"/>
        <circle cx="12" cy="11" r="2"/>
        <path d="M8.5 7.5a5 5 0 0 0 0 7"/>
        <path d="M15.5 7.5a5 5 0 0 1 0 7"/>
        <path d="M5.7 4.7a9 9 0 0 0 0 12.6"/>
        <path d="M18.3 4.7a9 9 0 0 1 0 12.6"/>
      </svg>
    ),
  }
  const messages: Tab = {
    href: '/messages',
    label: 'Messages',
    match: p => p.startsWith('/messages'),
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/>
      </svg>
    ),
  }
  const profile: Tab = {
    href: '/profile',
    label: 'Profile',
    match: p => p.startsWith('/profile'),
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
    ),
  }

  // Two either side of the anchor; Messages (flag-gated) joins the right flank.
  const leftTabs: Tab[] = [herd, jobs]
  const rightTabs: Tab[] = [devices, ...(flagEnabled('messaging') ? [messages] : []), profile]

  // The anchor lights on the dashboard (and the /home redirect that lands there).
  const opActive = pathname.startsWith('/dashboard') || pathname.startsWith('/home')
  const anchorHref = homeFips ? `/dashboard?fips=${homeFips}` : '/dashboard'

  const renderTab = (tab: Tab) => {
    const active = tab.match(pathname)
    return (
      <Link
        key={tab.href}
        href={tab.href}
        aria-current={active ? 'page' : undefined}
        className={`relative flex flex-1 basis-0 flex-col items-center justify-center gap-1 py-2 text-[11px] font-dm-sans transition-colors min-h-[56px] ${
          active ? 'font-semibold text-forest-green' : 'font-medium text-forest-green/40 hover:text-forest-green/70'
        }`}
      >
        {tab.href === '/messages' && unread > 0 && (
          <span className="absolute top-1 right-[calc(50%-18px)] inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-1 text-[9px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        {tab.icon(active)}
        {tab.label}
      </Link>
    )
  }

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-cream border-t border-forest-green/10 pb-safe">
      <div className="relative flex items-stretch">
        {/* Left flank (2 items) */}
        <div className="flex flex-1">{leftTabs.map(renderTab)}</div>

        {/* Reserved notch under the raised center anchor */}
        <div className="w-[76px] shrink-0" aria-hidden />

        {/* Right flank (2 items, +Messages behind its flag) */}
        <div className="flex flex-1">{rightTabs.map(renderTab)}</div>

        {/* Raised center anchor — "Operation": the dashboard on the home county.
            A PLAIN <a>, never a <Link> (nav-fixes, commit 1): a Link here was
            prefetched on production the moment it mounted — before the home
            county resolved its href was bare /dashboard, and prefetch={false}
            did not stop it. A plain anchor is never prefetched by the router,
            so the middleware redirect can't enter the router cache from here;
            the tap is a full navigation (the same thing the landing does), on
            every platform including the installed PWA. */}
        <a
          href={anchorHref}
          aria-label="Operation"
          aria-current={opActive ? 'page' : undefined}
          className="absolute left-1/2 bottom-0 z-10 flex -translate-x-1/2 flex-col items-center"
        >
          <span
            className={`flex h-14 w-14 -translate-y-4 items-center justify-center rounded-full bg-forest-green text-cream ring-4 ring-cream transition-shadow ${
              opActive ? 'shadow-lg shadow-forest-green/40' : 'shadow-md shadow-forest-green/25'
            }`}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10.5 12 3l9 7.5"/>
              <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/>
              <path d="M9.5 21v-6h5v6"/>
            </svg>
          </span>
          <span
            className={`-mt-2.5 mb-1.5 text-[11px] font-dm-sans transition-colors ${
              opActive ? 'font-semibold text-forest-green' : 'font-medium text-forest-green/70'
            }`}
          >
            Operation
          </span>
        </a>
      </div>
    </nav>
  )
}
