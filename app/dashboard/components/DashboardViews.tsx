'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { loadDashboardView } from './load-view'

// ─── Dashboard view state — Today · Jobs · Weather · Markets without a navigation ──
//
// The peer views of one county used to be four <Link>s: every tap was a soft
// navigation that re-ran the whole page on the server (every head read, every
// getUser) and streamed a fresh RSC payload just to swap the bottom of the
// page. Now the active view is a piece of client state: a tap is a state
// change, zero requests for anything already on the page.
//
// Mount policy (perf block, commit 5): the server renders Today always and the
// URL's active view eagerly; every other body is neither rendered nor fetched
// until first activated — the panel asks a server action for it once
// (load-view.tsx), then keeps it mounted (hidden, not unmounted), so switching
// back is instant and costs nothing. A body's client fetches (the news hook)
// and accordion state survive a switch for the same reason.
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

// The URL inputs a deferred body depends on; the page passes them down and the
// panel hands them back to the server action.
export interface ViewParams {
  fips: string
  gs?: string
  ge?: string
  pt?: string
}

// DOM order of the panels (the Hay entry is present only when the page includes it).
export const VIEW_ORDER: readonly DashboardViewKey[] = ['news', 'jobs', 'drought', 'hay', 'markets']

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

type Slots = Partial<Record<DashboardViewKey, ReactNode>>

// The panels. `eager` = bodies the server rendered into this response (Today,
// plus the URL's active view); `fallbacks` = what a deferred body shows while
// its first activation is in flight. A key in `order` with no eager body is
// deferred: it mounts nothing until it becomes active, then loads once.
export function DashboardViewPanels({ params, order, eager, fallbacks }: {
  params: ViewParams
  order: readonly DashboardViewKey[]
  eager: Slots
  fallbacks: Slots
}) {
  const ctx = useDashboardView()
  const active = ctx?.view ?? 'news'
  const [loaded, setLoaded] = useState<Slots>({})
  const [failed, setFailed] = useState<Partial<Record<DashboardViewKey, true>>>({})
  // In-flight guard (a ref, not state): StrictMode's double effect and a fast
  // tap-away-and-back must never start the same load twice.
  const inflight = useRef<Set<DashboardViewKey>>(new Set())
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const paramsJson = JSON.stringify(params)
  const needsLoad = !(active in eager) && !(active in loaded) && !failed[active]

  // Load on first activation. The result is stored whatever the active view is
  // by then (it's this county's body either way) — no cancel-and-refetch. State
  // is only ever set from the promise callbacks, never in the effect body.
  useEffect(() => {
    if (!needsLoad || inflight.current.has(active)) return
    inflight.current.add(active)
    const key = active
    loadDashboardView(key, JSON.parse(paramsJson) as ViewParams)
      .then(node => { if (mounted.current) setLoaded(prev => ({ ...prev, [key]: node ?? null })) })
      .catch(() => { if (mounted.current) setFailed(prev => ({ ...prev, [key]: true })) })
      .finally(() => { inflight.current.delete(key) })
  }, [needsLoad, active, paramsJson])

  const retry = (key: DashboardViewKey) => setFailed(prev => { const next = { ...prev }; delete next[key]; return next })

  return (
    <>
      {order.map(key => {
        const isActive = key === active
        let node: ReactNode
        if (key in eager) node = eager[key]
        else if (key in loaded) node = loaded[key]
        else if (isActive) {
          node = failed[key] ? (
            <div className="rounded-xl border border-forest-green/10 bg-white px-5 py-8 text-center">
              <p className="font-dm-sans text-sm text-forest-green/70">This view didn&rsquo;t load.</p>
              <button
                type="button"
                onClick={() => retry(key)}
                className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-forest-green px-5 font-dm-sans text-sm font-medium text-cream transition-colors hover:bg-forest-green/90"
              >
                Try again
              </button>
            </div>
          ) : (fallbacks[key] ?? null)
        } else {
          // Deferred and never activated: not mounted at all.
          return null
        }
        return (
          <div key={key} hidden={!isActive} className="space-y-4">
            {node}
          </div>
        )
      })}
    </>
  )
}
