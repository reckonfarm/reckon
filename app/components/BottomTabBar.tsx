'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRecordAvailable, useRecordSheetOpen } from '@/lib/record-sheet-state'
import { openLogIt } from '@/app/dashboard/components/LogIt'

// ─── Bottom tab bar (Block 6A; Record joined it in Block 11) ──────────────────
// Four labeled destinations — Today · Ranch · Markets · Weather — and Record.
// Devices live inside Ranch; the account lives behind the header's Account
// button; Messages under Account → Crew. Mobile only (md:hidden); the header
// carries the same four on desktop. pb-safe keeps the bar clear of the home
// indicator.
//
// BLOCK 11 (11.4): RECORD MOVED IN HERE AND THE FLOATING PILL IS GONE.
// It was a FAB above this bar, and the audit found it sitting on top of real
// controls on four screens — including "Drop a place here" on Places, which is
// that screen's whole purpose. A primary action you cannot reach because
// something is parked over it is the same defect as Delete under a stuck
// receipt, and it does not get fixed one screen at a time.
//
// So the rule is now structural rather than per-screen: THE BAR IS THE ONLY
// FIXED INTERACTIVE THING ON A PHONE, and every page reserves room for it, so
// nothing can be underneath anything. Record is still an ACTION and not a
// destination — it opens the sheet, takes no active state, and is drawn as a
// filled button rather than a tab — but it lives where the thumb already is
// instead of hovering over the page.

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

const RECORD_HIDDEN_ON = ['/signin', '/auth', '/invite', '/terms', '/privacy']

export default function BottomTabBar() {
  const pathname = usePathname()
  const sheetOpen = useRecordSheetOpen()
  const recordAvailable = useRecordAvailable()
  if (pathname.startsWith('/signin') || pathname.startsWith('/auth')) return null
  const showRecord = recordAvailable && !sheetOpen && pathname !== '/' && !RECORD_HIDDEN_ON.some(p => pathname.startsWith(p))
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
        {showRecord && (
          <button
            type="button"
            onClick={() => openLogIt({ type: null })}
            aria-label="Record work"
            data-audit="record-action"
            className="flex flex-1 basis-0 flex-col items-center justify-center gap-1 py-2 font-dm-sans text-[14px] font-semibold text-cream min-h-[56px] bg-forest-green"
          >
            <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Record
          </button>
        )}
      </div>
    </nav>
  )
}
