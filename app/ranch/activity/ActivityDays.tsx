'use client'

import { useState, type ReactNode } from 'react'

// ─── Day groups: recent open, older one tap away (Block 8B.3) ─────────────────
//
// PK's ruling: today and yesterday STAY OPEN. That is what he came to Activity
// to see, and making him tap for it defeats the screen. Older days collapse to
// a dated summary — "Sep 8 · 4 entries ▾".
//
// OPEN BY DATE, NOT BY COUNT, and the measurement is why. On the real record
// the most recent day carried 17 entries and the nineteen days behind it
// carried one or two each — so "the last three days" would have opened 26
// entries on one visit and two on another. A day is the unit a rancher thinks
// in; the number of entries in it is not something to design around.
//
// THE QUIET-RANCH GUARD. If today and yesterday are both empty the screen
// would open on nothing but collapsed headings, which reads as broken — the
// same lesson as an empty Weather. So when the open window holds no entries,
// the most recent day that HAS any is opened instead.

export interface DayGroup { day: string; label: string; count: number; body: ReactNode }

const SHOW_COLLAPSED = 7

export default function ActivityDays({ groups, openDays }: { groups: DayGroup[]; openDays: string[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)

  const openSet = new Set(openDays)
  // The guard: nothing in the open window, so open the most recent day there is.
  const anyOpen = groups.some(g => openSet.has(g.day) && g.count > 0)
  if (!anyOpen && groups.length > 0) openSet.add(groups[0].day)

  const closed = groups.filter(g => !openSet.has(g.day))
  const shown = showAll ? closed : closed.slice(0, SHOW_COLLAPSED)
  const hidden = closed.length - shown.length

  return (
    <>
      {groups.filter(g => openSet.has(g.day)).map(g => (
        <section key={g.day} className="mt-5" aria-label={g.label} data-audit="activity-day-open">
          <h2 className="font-dm-sans text-[16px] font-semibold uppercase tracking-wide text-secondary-ink">{g.label}</h2>
          {g.body}
        </section>
      ))}

      {shown.length > 0 && (
        <div className="mt-5" data-audit="activity-older">
          {shown.map(g => {
            const isOpen = expanded.has(g.day)
            return (
              <section key={g.day} className="border-b border-rule last:border-b-0" aria-label={g.label}>
                <button type="button" onClick={() => setExpanded(s => { const n = new Set(s); if (n.has(g.day)) n.delete(g.day); else n.add(g.day); return n })}
                  aria-expanded={isOpen}
                  className="flex min-h-[52px] w-full items-center justify-between gap-3 py-2 text-left font-dm-sans text-[16px] text-ink"
                  data-audit="activity-day-toggle">
                  <span className="font-semibold uppercase tracking-wide text-secondary-ink">{g.label}</span>
                  <span className="shrink-0 text-secondary-ink">{g.count} {g.count === 1 ? 'entry' : 'entries'} {isOpen ? '▴' : '▾'}</span>
                </button>
                {isOpen && <div className="pb-3" data-audit="activity-day-body">{g.body}</div>}
              </section>
            )
          })}
        </div>
      )}

      {hidden > 0 && (
        <button type="button" onClick={() => setShowAll(true)}
          className="mt-4 min-h-[48px] w-full rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink"
          data-audit="activity-show-more-days">
          Show {hidden} more {hidden === 1 ? 'day' : 'days'}
        </button>
      )}
    </>
  )
}
