'use client'

import { useState } from 'react'
import Link from 'next/link'
import HeldRow from '@/app/components/HeldRow'
import { fmtAcres } from '@/lib/places/geo'

// ─── Places sorted by what they are (Block 43) ───────────────────────────────
// Four groups — pastures, fields, yards, points — each a count you tap open.
// Inside, a name and its acres, nothing else. The one gesture everywhere: tap
// opens the place, hold is Fix and Delete. No sentence explains any of it.

export interface KindGroup {
  key: string
  label: string
  rows: { id: string; name: string; kind: string; acres: number | null }[]
}

export default function PlacesByKind({ groups }: { groups: KindGroup[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const shown = groups.filter(g => g.rows.length > 0)
  if (shown.length === 0) return null
  return (
    <div className="mt-4 divide-y divide-rule rounded-xl border border-rule bg-surface" data-audit="places-by-kind">
      {shown.map(g => {
        const isOpen = open === g.key
        return (
          <section key={g.key} aria-label={g.label} data-audit="place-group" data-group={g.key} data-open={isOpen ? 'true' : 'false'}>
            <button type="button" onClick={() => setOpen(o => (o === g.key ? null : g.key))} aria-expanded={isOpen}
              className="flex min-h-[60px] w-full items-center justify-between gap-3 px-4 py-3 text-left font-dm-sans text-[17px] font-semibold text-ink"
              data-audit="place-group-open" data-group={g.key}>
              <span>{g.label}</span>
              <span className="tabular-nums text-secondary-ink" data-audit="place-group-count">{g.rows.length}</span>
            </button>
            {isOpen && (
              <ul className="divide-y divide-rule border-t border-rule" data-audit="place-rows" data-group={g.key}>
                {g.rows.map(p => (
                  <li key={p.id} data-audit="place-branch" data-kind={p.kind} id={`place-${p.id}`}>
                    <HeldRow label={p.name} openHref={`/ranch/places/${p.id}`} fixHref={`/ranch/places/${p.id}#edit`} del={{ kind: 'place', id: p.id }}>
                      <Link href={`/ranch/places/${p.id}`} className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 pl-8 hover:bg-forest-green/[0.03]" data-audit="place-row" data-id={p.id}>
                        <span className="min-w-0 truncate font-dm-sans text-[17px] font-semibold text-ink">{p.name}</span>
                        {fmtAcres(p.acres) && <span className="shrink-0 font-dm-sans text-[16px] tabular-nums text-ink" data-audit="place-acres">{fmtAcres(p.acres)}</span>}
                      </Link>
                    </HeldRow>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
