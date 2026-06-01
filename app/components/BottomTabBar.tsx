'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

export default function BottomTabBar() {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)
  const [user, setUser] = useState<User | null>(null)

  // Same auth signal SiteHeader uses, so signed-out visitors don't see the
  // Radar tab (Radar requires a free account).
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Refresh the messages unread badge on navigation (tolerates signed-out 401).
  useEffect(() => {
    let cancelled = false
    fetch('/api/threads/unread')
      .then(r => r.ok ? r.json() : { count: 0 })
      .then(d => { if (!cancelled) setUnread(typeof d?.count === 'number' ? d.count : 0) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [pathname])

  // Carry the selected county into the Cattle tab when one is in the URL.
  const [fips, setFips] = useState<string | null>(null)
  useEffect(() => {
    try { setFips(new URLSearchParams(window.location.search).get('fips')) } catch { /* noop */ }
  }, [pathname])

  // Hide on auth pages
  if (pathname.startsWith('/signin') || pathname.startsWith('/auth')) {
    return null
  }

  const tabs = [
    {
      href: '/',
      label: 'Drought',
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 0 0-6.88 17.25C6.06 20.67 8 21.5 8 21.5s0-1.5 2-3c1.5-1.1 2-2.5 2-2.5s.5 1.4 2 2.5c2 1.5 2 3 2 3s1.94-.83 2.88-2.25A10 10 0 0 0 12 2z"/>
        </svg>
      ),
    },
    {
      href: '/hay',
      label: 'Hay',
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="8" width="20" height="10" rx="2"/>
          <path d="M6 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>
          <line x1="12" y1="8" x2="12" y2="18"/>
          <line x1="7" y1="13" x2="17" y2="13"/>
        </svg>
      ),
    },
    {
      href: fips ? `/cattle?fips=${fips}` : '/cattle',
      base: '/cattle',
      label: 'Cattle',
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 5c0 2 1 3 1 3M19 5c0 2-1 3-1 3"/>
          <path d="M6 8c-2 0-3 2-3 4 0 4 4 7 9 7s9-3 9-7c0-2-1-4-3-4"/>
          <circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none"/>
          <circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none"/>
          <path d="M9.5 16c.8.6 4.2.6 5 0"/>
        </svg>
      ),
    },
    {
      href: '/messages',
      label: 'Messages',
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/>
        </svg>
      ),
    },
    {
      href: '/radar',
      label: 'Radar',
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 1 0 10 10"/>
          <path d="M12 8a6 6 0 1 0 6 6"/>
          <path d="M12 12l9-9"/>
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
        </svg>
      ),
    },
    {
      href: '/watchlist',
      label: 'Counties',
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      ),
    },
    {
      href: '/profile',
      label: 'Profile',
      icon: (active: boolean) => (
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
        {tabs.filter(tab => tab.href !== '/radar' || user).map((tab) => {
          const matchPath = (tab as { base?: string }).base ?? tab.href
          const active = tab.href === '/'
            ? pathname === '/' || pathname.startsWith('/dashboard')
            : pathname.startsWith(matchPath)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex flex-col items-center justify-center gap-1 flex-1 py-2 text-[10px] font-dm-sans font-medium transition-colors min-h-[56px] ${
                active
                  ? 'text-forest-green'
                  : 'text-forest-green/35 hover:text-forest-green/60'
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
