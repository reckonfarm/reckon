'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import type { ProgramAlert } from '@/lib/program-alerts'

// ─── Change-only program alerts on Today (Block 7.9) ──────────────────────────
//
// These are the only program words left on Today, and they appear only when
// something changed. Everything standing — the LFP card, the drought
// designation, the deadline list — lives in Weather → Programs, which is where
// each of these links.
//
// Dismissal is optimistic and per person: the card goes at once, and the POST
// records the specific change key. If the POST cannot store it (migration 059
// not run yet) the alert comes back on the next load rather than pretending to
// be remembered — nothing was recorded, so nothing should look recorded.

export default function ProgramAlerts({ alerts }: { alerts: ProgramAlert[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set())
  const live = alerts.filter(a => !gone.has(a.key))
  if (live.length === 0) return null

  const dismiss = (key: string) => {
    setGone(prev => new Set(prev).add(key))
    fetch('/api/program-alerts/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_key: key }),
    }).catch(() => { /* it returns on the next load; never a dead end */ })
  }

  return (
    <section aria-labelledby="program-alerts-h" data-audit="program-alerts">
      <h2 id="program-alerts-h" className={`${EYEBROW} !text-ink`}>Changed</h2>
      <div className="mt-2 space-y-3">
        {live.map(a => (
          <Card key={a.key} className="p-4 sm:p-5" data-audit={`program-alert-${a.kind}`}>
            <p className="font-dm-sans text-[17px] font-semibold leading-snug text-ink">{a.headline}</p>
            <p className="mt-1 font-dm-sans text-[16px] leading-snug text-secondary-ink">{a.detail}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Link href="/weather#wx-programs-h" className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">
                Programs →
              </Link>
              <button
                type="button"
                onClick={() => dismiss(a.key)}
                className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-secondary-ink underline underline-offset-2"
                data-audit="program-alert-dismiss"
              >
                Seen it
              </button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}
