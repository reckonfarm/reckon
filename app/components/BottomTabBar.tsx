'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function BottomTabBar() {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)

  // Refresh the messages unread badge on navigation (tolerates signed-out 401).
  useEffect(() => {
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

  // Flanking items, in left-to-right order around the raised center anchor.
  const leftTabs: Tab[] = [
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
      href: '/messages',
      label: 'Messages',
      match: p => p.startsWith('/messages'),
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/>
        </svg>
      ),
    },
  ]

  // Hay Radar lives in the top header (SiteHeader), not here — keeping the bottom
  // bar an even 2-left / 2-right around the centered My Operation anchor.
  const rightTabs: Tab[] = [
    {
      href: '/watchlist',
      label: 'Counties',
      match: p => p.startsWith('/watchlist'),
      icon: (active) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      ),
    },
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

  // "My Operation" is the home-base anchor: the rancher's personal drought picture,
  // with the Drought/Cattle toggle living inside it. Routes straight to /dashboard
  // (bare /dashboard middleware-redirects a signed-in user to their home county).
  // The default landing at '/' is now the Markets surface, a separate destination —
  // so this anchor stays lit across the dashboard peer views (/dashboard, /cattle,
  // cattle reached from there via the toggle) but NOT on '/'.
  const opActive = pathname.startsWith('/dashboard') || pathname.startsWith('/cattle')

  const renderTab = (tab: Tab) => {
    const active = tab.match(pathname)
    return (
      <Link
        key={tab.href}
        href={tab.href}
        className={`relative flex flex-1 basis-0 flex-col items-center justify-center gap-1 py-2 text-[10px] font-dm-sans font-medium transition-colors min-h-[56px] ${
          active ? 'text-forest-green' : 'text-forest-green/35 hover:text-forest-green/60'
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

        {/* Right flank (2 items) */}
        <div className="flex flex-1">{rightTabs.map(renderTab)}</div>

        {/* Raised, prominent center anchor — "My Operation" (home base) */}
        <Link
          href="/dashboard"
          aria-label="My Operation"
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
            className={`-mt-2.5 mb-1.5 text-[10px] font-dm-sans font-semibold transition-colors ${
              opActive ? 'text-forest-green' : 'text-forest-green/70'
            }`}
          >
            My Operation
          </span>
        </Link>
      </div>
    </nav>
  )
}
