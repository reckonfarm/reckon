'use client'

import { useState, type ReactNode } from 'react'

// ─── Recent activity on the hub, two rows deep (Block 7B.2) ───────────────────
//
// The hub showed five rows and offered nothing else — the only way to see a
// sixth was the Activity row further down the Sections list, which is a
// navigation away from the hub and back.
//
// Two rows now, and the rest open IN PLACE. The rows are not fetched here and
// they are not fetched again: listActivity already reads a full page on the
// server (PAGE_SIZE + 1), and the hub was throwing all but five of them away.
// The expander reveals what the page already holds, so opening it costs one
// re-render and no request — which is the whole reason it can be a disclosure
// instead of a link.
//
// The button NAMES ITS COUNT ("Show 12 more"), because a person deciding
// whether to tap on one bar of signal deserves to know whether that is three
// rows or thirty. `hasMore` says the record continues past what is here —
// either because the hub capped the list at HUB_ROWS or because the ledger has
// a further page — so the expanded state never implies it is showing
// everything. Activity, still in the Sections list below, is where the rest
// lives.

export default function RecentActivityList({
  rows,
  initial = 2,
  hasMore = false,
}: {
  rows: ReactNode[]
  initial?: number
  hasMore?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const hidden = Math.max(0, rows.length - initial)
  const shown = expanded ? rows : rows.slice(0, initial)

  return (
    <>
      <ol className="divide-y divide-rule" data-audit="ranch-recent" data-open={expanded ? 'true' : 'false'}>
        {shown}
      </ol>
      {hidden > 0 && (
        <div className="border-t border-rule">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            className="min-h-[48px] w-full px-4 py-3 text-left font-dm-sans text-[16px] font-semibold text-brand hover:bg-forest-green/[0.03]"
            data-audit="ranch-recent-more"
          >
            {expanded ? 'Show fewer' : `Show ${hidden} more`}
          </button>
          {expanded && hasMore && (
            <p className="px-4 pb-3 font-dm-sans text-[15px] text-secondary-ink" data-audit="ranch-recent-truncated">
              Older entries are in the full record.
            </p>
          )}
        </div>
      )}
    </>
  )
}
