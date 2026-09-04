'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

// ─── Dashboard view state — Today · Jobs · Weather · Markets without a navigation ──
//
// The peer views of one county used to be four <Link>s: every tap was a soft
// navigation that re-ran the whole page on the server (every head read, every
// getUser) and streamed a fresh RSC payload just to swap the bottom of the
// page. Now the server renders ALL the view bodies once (each behind its own
// Suspense, so the heavy ones stream in without blocking the shell) and the
// active one is a piece of client state: a tap is a state change, zero
// requests, and the hidden bodies keep whatever they already loaded.
//
// URL contract unchanged: ?view= still deep-links and is kept in sync via
// history.replaceState — the same mechanism ?base= uses on the job map —
// composed with the params already present (fips, gs/ge/pt) never clobbered.
// Today is the default and carries no param, exactly as before. Next's router
// patches replaceState, so useSearchParams readers see the new value.
//
// County changes are NOT this mechanism: CountySelector / CountySearch still
// navigate through lib/standalone-nav's navigateTo (the iOS home-screen
// workaround), untouched. Nothing here navigates.

export type DashboardViewKey = 'news' | 'jobs' | 'drought' | 'hay' | 'markets'

interface DashboardViewState {
  view: DashboardViewKey
  setView: (view: DashboardViewKey) => void
}

const DashboardViewContext = createContext<DashboardViewState | null>(null)

// null outside the dashboard — components shared with /home (ConditionsStrip)
// fall back to their link behavior there.
export function useDashboardView(): DashboardViewState | null {
  return useContext(DashboardViewContext)
}

function syncUrl(view: DashboardViewKey) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (view === 'news') url.searchParams.delete('view')
  else url.searchParams.set('view', view)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function DashboardViewProvider({ initial, children }: { initial: DashboardViewKey; children: ReactNode }) {
  const [view, setViewState] = useState<DashboardViewKey>(initial)
  const setView = useCallback((next: DashboardViewKey) => {
    setViewState(next)
    syncUrl(next)
  }, [])
  return (
    <DashboardViewContext.Provider value={{ view, setView }}>
      {children}
    </DashboardViewContext.Provider>
  )
}

// The bodies, mounted ONCE and shown one at a time. `hidden` (Tailwind's
// preflight makes it display:none) keeps the inactive ones in the tree so
// their streamed content, client fetches (news), and accordion state survive
// a switch — a tap never re-pays anything.
export function DashboardViewPanels({ panels }: { panels: Partial<Record<DashboardViewKey, ReactNode>> }) {
  const ctx = useDashboardView()
  const active = ctx?.view ?? 'news'
  return (
    <>
      {(Object.keys(panels) as DashboardViewKey[]).map(key => (
        <div key={key} hidden={key !== active} className="space-y-4">
          {panels[key]}
        </div>
      ))}
    </>
  )
}
