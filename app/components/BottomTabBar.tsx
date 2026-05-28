'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function BottomTabBar() {
  const pathname = usePathname()

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
      href: '/watchlist',
      label: 'My Counties',
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
        {tabs.map((tab) => {
          const active = tab.href === '/'
            ? pathname === '/' || pathname.startsWith('/dashboard')
            : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center justify-center gap-1 flex-1 py-2 text-[10px] font-dm-sans font-medium transition-colors min-h-[56px] ${
                active
                  ? 'text-forest-green'
                  : 'text-forest-green/35 hover:text-forest-green/60'
              }`}
            >
              {tab.icon(active)}
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
