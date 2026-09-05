'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

// ─── The three ledgers as tabs (views2, commit 4) ──────────────────────────────
// A client tab strip directly under Log it: This season · Hay · Recently
// logged. The bodies are SERVER-rendered (each is the same self-gating async
// component it was, streamed behind its own Suspense) and arrive here as
// props; all three stay mounted, the inactive ones hidden — the same
// mount-and-hide pattern DashboardViewPanels uses — so a tab tap is client
// state and costs zero requests. All three still fetch on every Today render
// (deferred loading is a separate decision).
//
// THE EMPTINESS PROBLEM, solved explicitly: a server card decides "nothing to
// show" from its own data, and a client wrapper can't see through an opaque
// node. So each card wraps its output in <LedgerPanel tab empty>, which
// reports its emptiness up through this strip's context on mount (and again
// after a router.refresh re-renders it), and the strip prints an honest
// empty line for that tab instead of a blank panel. Until a body has
// streamed in, the tab shows its Suspense fallback — never blank either.

export type LedgerTab = 'season' | 'hay' | 'logged'

const TABS: LedgerTab[] = ['season', 'hay', 'logged']

const LABELS: Record<LedgerTab, string> = {
  season: 'This season',
  hay: 'Hay',
  logged: 'Recently logged',
}

// Plain-spoken, and each says what would fill it.
const EMPTY: Record<LedgerTab, string> = {
  season: 'No work sessions this season yet. Put a Scout on a machine and go to work.',
  hay: 'No hay logged this season yet. Log a count of the stack, bales stacked, or hay fed.',
  logged: 'Nothing logged yet. Log it is right above.',
}

interface LedgerCtx { report: (tab: LedgerTab, empty: boolean) => void }
const Ctx = createContext<LedgerCtx | null>(null)

// Wrap a ledger card's output in this. `empty` is the card's own verdict
// (its former `return null`). Renders children unchanged; the effect reports
// the verdict to the strip, re-running when the server re-renders the card.
export function LedgerPanel({ tab, empty, children }: { tab: LedgerTab; empty: boolean; children?: ReactNode }) {
  const ctx = useContext(Ctx)
  useEffect(() => { ctx?.report(tab, empty) }, [ctx, tab, empty])
  return <>{children}</>
}

// The Suspense fallback for a ledger body while it streams — a line, so the
// open tab is never a blank panel.
export function LedgerLoading() {
  return <p className="px-1 py-3 font-dm-sans text-sm text-forest-green/45">Adding it up…</p>
}

export default function LedgerTabs({ season, hay, logged }: Record<LedgerTab, ReactNode>) {
  const [active, setActive] = useState<LedgerTab>('season')
  const [empty, setEmpty] = useState<Partial<Record<LedgerTab, boolean>>>({})
  const report = useCallback((tab: LedgerTab, e: boolean) => {
    setEmpty(prev => (prev[tab] === e ? prev : { ...prev, [tab]: e }))
  }, [])
  const bodies: Record<LedgerTab, ReactNode> = { season, hay, logged }

  return (
    <Ctx.Provider value={{ report }}>
      <div>
        <div role="tablist" aria-label="Ledgers" className="flex gap-1 rounded-xl border border-forest-green/10 bg-white p-1">
          {TABS.map(t => {
            const isActive = t === active
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`ledger-${t}`}
                onClick={() => setActive(t)}
                className={`min-h-[44px] flex-1 rounded-lg px-2 font-dm-sans text-sm transition-colors ${
                  isActive ? 'bg-forest-green font-semibold text-cream' : 'font-medium text-forest-green/60 hover:text-forest-green'
                }`}
              >
                {LABELS[t]}
              </button>
            )
          })}
        </div>
        {TABS.map(t => (
          <div key={t} id={`ledger-${t}`} role="tabpanel" hidden={t !== active} className="mt-3">
            {empty[t] && (
              <p className="rounded-xl border border-dashed border-forest-green/20 px-4 py-5 text-center font-dm-sans text-sm text-forest-green/55">
                {EMPTY[t]}
              </p>
            )}
            {bodies[t]}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
