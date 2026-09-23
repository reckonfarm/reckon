'use client'

import TapValue from '@/app/components/TapValue'
import { enqueue, newEventId } from '@/lib/outbox'
import { todayKey } from '@/lib/jobs/format'
import { UNDO_HOLD_MS } from './RepeatLastCard'

// Block 37: hay on hand IS the control. Tap the number, type the count, Done —
// that records a count of the stack as of today (the one way on hand is ever
// set), through the outbox with its ten-second Undo. The tile paints the new
// number at once and the ranch's own arithmetic takes over when the count lands.
export default function HayOnHandTap({ bales, className }: { bales: number; className?: string }) {
  return (
    <TapValue
      value={bales}
      label="Hay on hand"
      audit="hay-on-hand"
      min={0}
      max={100_000}
      className={className}
      onSave={n => {
        const id = newEventId()
        try {
          enqueue({ id, type: 'hay_inventory', bales: n, as_of: todayKey(), place_id: null }, `Counted ${n} ${n === 1 ? 'bale' : 'bales'}`, UNDO_HOLD_MS)
          return id
        } catch { return null }
      }}
    />
  )
}
