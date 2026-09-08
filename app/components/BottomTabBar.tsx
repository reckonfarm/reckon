'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// ─── Bottom tab bar (Block 6A) ────────────────────────────────────────────────
// Four labeled destinations — Today · Ranch · Markets · Weather — and nothing
// else. Record is an action, not a tab: it is the FAB above this bar
// (RecordFab), hidden while a sheet is open. Devices live inside Ranch; the
// account lives behind the header's Account button; Messages under Account →
// Crew. Mobile only (md:hidden); the header carries the same four on desktop.
// pb-safe keeps the bar clear of the home indicator.

interface Tab { href: string; label: string; match: (p: string) => boolean; icon: (active: boolean) => React.ReactNode }

const stroke = (active: boolean) => ({ width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: active ? 2 : 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const })

const TABS: Tab[] = [
  {
    href: '/today', label: 'Today', match: p => p === '/today' || p.startsWith('/today?'),
    icon: a => (<svg {...stroke(a)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" /><path d="M9.5 21v-6h5v6" /></svg>),
  },
  {
    href: '/ranch', label: 'Ranch', match: p => p.startsWith('/ranch'),
    icon: a => (<svg {...stroke(a)}><path d="M3 21h18" /><path d="M5 21V9l7-5 7 5v12" /><path d="M9 21v-7h6v7" /><path d="M3 12h18" /></svg>),
  },
  {
    href: '/markets', label: 'Markets', match: p => p.startsWith('/markets'),
    icon: a => (<svg {...stroke(a)}><path d="M3 17l5-6 4 3 5-7 4 4" /><path d="M3 21h18" /></svg>),
  },
  {
    href: '/weather', label: 'Weather', match: p => p.startsWith('/weather'),
    icon: a => (<svg {...stroke(a)}><path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7z" /><path d="M9 21l1-2M13 21l1-2" /></svg>),
  },
]

export default function BottomTabBar() {
  const pathname = usePathname()
  if (pathname.startsWith('/signin') || pathname.startsWith('/auth')) return null
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-cream border-t border-forest-green/10 pb-safe" aria-label="Primary" data-audit="bottom-bar">
      <div className="flex items-stretch">
        {TABS.map(tab => {
          const active = tab.match(pathname)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 basis-0 flex-col items-center justify-center gap-1 py-2 text-[14px] font-dm-sans transition-colors min-h-[56px] ${active ? 'font-semibold text-forest-green' : 'font-medium text-ink hover:text-brand'}`}
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
