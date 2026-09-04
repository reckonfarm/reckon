'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { flagDisabled, flagEnabled } from '@/lib/flags'

// ─── Bottom nav (mobile) — one flat row of routes (shell pass, commit 5) ────────
// Today · My herd · Jobs · Devices · Profile (+ Messages behind its flag), evenly
// spaced, no raised anchor and no notch. Today IS the operation now — the county
// dashboard's Today view absorbed the ranch home — so a center button pointing
// at the page you're already on was noise; it is a plain first tab that lights
// on /dashboard like any other. Counties (the watchlist) left the bar; it is
// reached from Profile. Devices keeps its slot: the hardware registry is where
// a Scout gets paired and checked, a cab-side task.
//
// The four view tabs (DroughtCattleToggle) are the in-page navigation INSIDE
// the dashboard; this bar is the route-level one. Two systems, deliberately:
// this row never changes a view, the toggle never changes a route.

export default function BottomTabBar() {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)

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

  const tabs: Tab[] = [
    {
      // The operation: the county dashboard with Today open. Bare /dashboard —
      // middleware puts the home county on it. /home is a redirect here too.
      href: '/dashboard',
      label: 'Today',
      match: p => p.startsWith('/dashboard') || p.startsWith('/home'),
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5 12 3l9 7.5"/>
          <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/>
          <path d="M9.5 21v-6h5v6"/>
        </svg>
      ),
    },
    {
      href: '/herd',
      label: 'My herd',
      match: p => p.startsWith('/herd'),
      icon: (active) => (
        // Cow / steer head — hand-drawn to match the inline-SVG stroke style (no icon lib):
        // two horns, a brow, the face tapering to a muzzle, and two nostril dots.
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 8C5.5 7.2 3.6 7.5 2.9 5.6"/>
          <path d="M17 8c1.5-.8 3.4-.5 4.1-2.4"/>
          <path d="M7 8c1.2-1 3-1.6 5-1.6s3.8.6 5 1.6"/>
          <path d="M7 8C6 9.2 5.5 10.8 5.5 12.5 5.5 16 8.4 18.5 12 18.5s6.5-2.5 6.5-6c0-1.7-.5-3.3-1.5-4.5"/>
          <path d="M10.5 13h0"/>
          <path d="M13.5 13h0"/>
        </svg>
      ),
    },
    {
      // Jobs — the work-session ledger, the Scout's payoff surface and the page a
      // rancher opens from the cab. Route glyph (track between two endpoints).
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
    },
    {
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
    },
    // Messages rides the messaging flag.
    ...(flagEnabled('messaging')
      ? [{
          href: '/messages',
          label: 'Messages',
          match: (p: string) => p.startsWith('/messages'),
          icon: (active: boolean) => (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/>
            </svg>
          ),
        }]
      : []),
    {
      href: '/profile',
      label: 'Profile',
      match: p => p.startsWith('/profile'),
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
      ),
    },
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-cream border-t border-forest-green/10 pb-safe">
      <div className="flex items-stretch">
        {tabs.map(tab => {
          const active = tab.match(pathname)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              // Bare /dashboard is a middleware redirect (to the home county) for a
              // signed-in person. Prefetching it caches that redirect, and the App
              // Router then serves ANY later push to /dashboard?fips=… from the
              // cached entry — the county selector silently lands back on the home
              // county. No prefetch for that one tab; the others stay default.
              prefetch={tab.href === '/dashboard' ? false : undefined}
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
        })}
      </div>
    </nav>
  )
}
