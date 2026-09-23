'use client'

import { useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import { enqueue, newEventId, useOutbox } from '@/lib/outbox'
import { openLogIt } from './LogIt'
import SaveStatus from './SaveStatus'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

// ─── Repeat a feeding (Block 2B · Block 33) — the ten-second path ─────────────
// Most feedings are yesterday's feeding. The server component hands in the
// feedings the ranch repeats (Block 33: the last one, and the latest for every
// bunch fed regularly); each row offers itself back:
//   Record {n} bales now → saved on the phone NOW under its own id, with a 10 s hold
//                before upload so Undo can pull it back before anything
//                leaves the phone (the ledger is append-only; there is no
//                undo after sync, so the hold IS the undo window).
//   Adjust first → opens the record sheet pre-filled with these values, for a
//                NEW feeding with changes (5F: never 'Change' — correcting the
//                old feeding is Correct this entry on its event page).
// The status strip for the entry a row made renders right there, with the Undo
// countdown, so the answer to "did that save?" is where the thumb is.

export const UNDO_HOLD_MS = 10_000

export interface LastFeeding {
  id: string                 // the feeding this row repeats
  bales: number
  lotId: string | null
  lotLabel: string | null
  placeId: string | null
  placeName: string | null
  whenLabel: string          // "yesterday 7:10 AM"
}

function RepeatRow({ last }: { last: LastFeeding }) {
  const [madeId, setMadeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const items = useOutbox()
  const made = madeId ? items.find(i => i.id === madeId) ?? null : null
  // Once the entry it made has synced (or was undone), the row is offered again.
  const active = made && made.state !== 'synced'

  const label = `Fed ${last.bales} ${last.bales === 1 ? 'bale' : 'bales'}${last.lotLabel ? ` to ${last.lotLabel}` : ''}${last.placeName ? ` at ${last.placeName}` : ''}`

  const sameToday = () => {
    setError(null)
    const id = newEventId()
    try {
      enqueue({ id, type: 'hay_fed', bales: last.bales, herd_lot_id: last.lotId, place_id: last.placeId }, label, UNDO_HOLD_MS)
      setMadeId(id)
    } catch {
      setError('This phone is full, so nothing was saved. Free some space on the phone, then record it again.')
    }
  }

  const change = () => openLogIt({ type: 'hay_fed', n1: String(last.bales), lot: last.lotId ?? '', place: last.placeId ?? '' })

  return (
    <div className="py-3 first:pt-2 last:pb-0" data-audit="repeat-row" data-lot={last.lotId ?? ''}>
      <p className="font-fraunces text-[28px] font-semibold leading-tight text-forest-green sm:text-[32px]">
        {last.bales} {last.bales === 1 ? 'bale' : 'bales'}
        {last.lotLabel && <span className="font-dm-sans text-[17px] font-medium text-ink"> · {last.lotLabel}</span>}
      </p>
      <p className="mt-1 font-dm-sans text-[16px] text-ink">
        {last.placeName ? `${last.placeName} · ` : ''}last logged {last.whenLabel}
      </p>


      {active ? (
        <div className="mt-4"><SaveStatus itemId={madeId!} /></div>
      ) : (
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={sameToday}
            className="min-h-[56px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-white hover:bg-forest-green/90"
          >
            Record {last.bales} {last.bales === 1 ? 'bale' : 'bales'} now
          </button>
          <button
            type="button"
            onClick={change}
            className="min-h-[56px] rounded-lg border border-forest-green/25 px-5 font-dm-sans text-[17px] font-semibold text-forest-green hover:bg-forest-green/5"
          >
            Adjust first
          </button>
        </div>
      )}
      {made && made.state === 'synced' && (
        <div className="mt-3"><SaveStatus itemId={madeId!} /></div>
      )}
      {error && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-medium text-warning">{error}</p>}
    </div>
  )
}

export default function RepeatLastCard({ feedings }: { feedings: LastFeeding[] }) {
  if (feedings.length === 0) return null
  return (
    <Card shadow="soft" className="p-4 sm:p-5">
      <p className={EYEBROW}>{feedings.length > 1 ? 'Repeat a feeding' : 'Repeat last feeding'}</p>
      <div className="divide-y divide-forest-green/10">
        {feedings.map(f => <RepeatRow key={f.id} last={f} />)}
      </div>
    </Card>
  )
}
