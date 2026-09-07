'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Card } from '@/app/components/ui/Card'

// ─── LFP — ONE card per screen (shell pass, commit 6) ──────────────────────────
// Before: the loud alert slot, the quiet "Program status" LFP line, the Weather
// view's LfpHero, and the "Eligibility math" accordion — up to three LFP
// surfaces on one screen. Now: this card, in the always-on stack, in every
// view. The SUMMARY is the same LfpAlertCard body it always was (triggered /
// pending / building / no-trigger / unavailable — real engine values, no dollar),
// visible without a tap. The DETAIL — the hero (path to the first payment,
// payout schedule, estimate, FSA guidance) and the eligibility math
// (calculator, tier ladder, prior year, CCC-853) — expands on one 44px tap.
//
// Hash contract kept: the hero's "View FSA checklist →" points at
// #eligibility-math, which lives inside the detail; a hashchange to it opens
// the card (DashboardAccordion's mechanism) so the link never lands closed.
// Server components render the summary and detail; this shell only holds
// open/closed.

const HASH_TARGET = 'eligibility-math'

export default function LfpCard({
  summary,
  detail,
  highlight = false,
  defaultOpen = false,
}: {
  summary: ReactNode
  detail: ReactNode | null
  highlight?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash !== `#${HASH_TARGET}`) return
      setOpen(true)
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <Card
      as="section"
      shadow="soft"
      className={`p-4 sm:p-6 ${highlight ? 'border-2 border-forest-green/40' : ''}`}
    >
      {summary}

      {detail && (
        <>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-controls="lfp-detail"
            className="mt-4 flex min-h-[52px] w-full items-center justify-between border-t border-rule px-1 font-dm-sans text-[17px] font-semibold text-ink transition-colors hover:bg-forest-green/5"
          >
            <span>{open ? 'Hide payment estimate and steps' : 'Payment estimate and steps'}</span>
            <span className="ml-3 inline-flex shrink-0 items-center gap-1 font-dm-sans text-[16px] font-medium text-secondary-ink">{open ? 'Hide' : 'Show'}
            <svg
              className={`h-5 w-5 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg></span>
          </button>
          {open && (
            <div id="lfp-detail" className="mt-4 space-y-4 border-t border-forest-green/10 pt-4">
              {detail}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
