'use client'

import { useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import { enqueue, newEventId, useOutbox } from '@/lib/outbox'
import { openLogIt } from './LogIt'
import SaveStatus from './SaveStatus'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

// ─── Repeat last feeding (Block 2B) — the ten-second path ─────────────────────
// Most feedings are yesterday's feeding. The server component hands in the
// most recent hay_fed line (group, place, quantity); this card offers it back:
//   Same today → saved on the phone NOW under its own id, with a 10 s hold
//                before upload so Undo can pull it back before anything
//                leaves the phone (the ledger is append-only; there is no
//                undo after sync, so the hold IS the undo window).
//   Change     → opens the Log it sheet pre-filled with these values.
// The status strip for the entry it made renders right here, with the Undo
// countdown, so the answer to "did that save?" is where the thumb is.

export const UNDO_HOLD_MS = 10_000

export interface LastFeeding {
  bales: number
  lotId: string | null
  lotLabel: string | null
  placeId: string | null
  placeName: string | null
  whenLabel: string          // "yesterday 7:10 AM"
}

export default function RepeatLastCard({ last }: { last: LastFeeding }) {
  const [madeId, setMadeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const items = useOutbox()
  const made = madeId ? items.find(i => i.id === madeId) ?? null : null
  // Once the entry it made has synced (or was undone), the card is offered again.
  const active = made && made.state !== 'synced'

  const label = `Fed ${last.bales} ${last.bales === 1 ? 'bale' : 'bales'}${last.lotLabel ? ` to ${last.lotLabel}` : ''}${last.placeName ? ` at ${last.placeName}` : ''}`

  const sameToday = () => {
    setError(null)
    const id = newEventId()
    try {
      enqueue({ id, type: 'hay_fed', bales: last.bales, herd_lot_id: last.lotId, place_id: last.placeId }, label, UNDO_HOLD_MS)
      setMadeId(id)
    } catch {
      setError("Couldn't save — try again. This phone refused to store the entry.")
    }
  }

  const change = () => openLogIt({ type: 'hay_fed', n1: String(last.bales), lot: last.lotId ?? '', place: last.placeId ?? '' })

  return (
    <Card shadow="soft" className="p-4 sm:p-5">
      <p className={EYEBROW}>Repeat last feeding</p>
      <p className="mt-2 font-fraunces text-[28px] font-semibold leading-tight text-forest-green sm:text-[32px]">
        {last.bales} {last.bales === 1 ? 'bale' : 'bales'}
        {last.lotLabel && <span className="font-dm-sans text-[17px] font-medium text-forest-green/80"> · {last.lotLabel}</span>}
      </p>
      <p className="mt-1 font-dm-sans text-[15px] text-forest-green/75">
        {last.placeName ? `${last.placeName} · ` : ''}last logged {last.whenLabel}
      </p>

      {active ? (
        <div className="mt-4"><SaveStatus itemId={madeId!} /></div>
      ) : (
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={sameToday}
            className="min-h-[56px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-white shadow-sm shadow-forest-green/20 hover:bg-forest-green/90"
          >
            Same today
          </button>
          <button
            type="button"
            onClick={change}
            className="min-h-[56px] rounded-lg border border-forest-green/25 px-5 font-dm-sans text-[17px] font-semibold text-forest-green hover:bg-forest-green/5"
          >
            Change
          </button>
        </div>
      )}
      {made && made.state === 'synced' && (
        <div className="mt-3"><SaveStatus itemId={madeId!} /></div>
      )}
      {error && <p role="alert" className="mt-3 font-dm-sans text-[15px] font-medium text-warning">{error}</p>}
    </Card>
  )
}
