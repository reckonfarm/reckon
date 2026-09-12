'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'

// ─── The filters, behind one tap (Block 8B.3) ─────────────────────────────────
// Three pickers and two date fields sat above the record on every visit — 243px
// of a 390px screen, before a single entry. Most visits filter nothing.
//
// The row states the ACTIVE filter when there is one, so a filtered view can
// never look unfiltered. That is the whole risk of hiding a filter, and it is
// the one thing this must not get wrong: someone reading a short record and
// concluding the ranch was quiet, when really a place filter was on.

export default function ActivityFilters({ active, filtering, children }: {
  /** Plain description of what is filtered, e.g. "Test Hand · Home pasture". */
  active: string | null
  filtering: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(filtering)

  return (
    <div className="mt-4" data-audit="activity-filters-wrap">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
          className="inline-flex min-h-[48px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink"
          data-audit="activity-filter-toggle">
          {open ? 'Hide filters' : 'Filter'}
        </button>
        {active && (
          <span className="font-dm-sans text-[16px] font-semibold text-brand" data-audit="activity-filter-active">
            Showing {active}
          </span>
        )}
        {filtering && (
          <Link href="/ranch/activity" className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="activity-filter-clear">
            Clear
          </Link>
        )}
      </div>
      {open && <div className="mt-3" data-audit="activity-filters">{children}</div>}
    </div>
  )
}
