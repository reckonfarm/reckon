'use client'

import TapValue from '@/app/components/TapValue'
import { enqueue, newEventId } from '@/lib/outbox'
import { UNDO_HOLD_MS } from '@/app/dashboard/components/RepeatLastCard'

// Block 37: a feeding's quantity IS the control. Tap the number, type, Done —
// that is a correction (a new entry that supersedes this one, Block 5B), made
// through the outbox with its ten-second Undo, in the same motion as recording.
export default function QuantityTap({ eventId, bales, className }: { eventId: string; bales: number; className?: string }) {
  return (
    <TapValue
      value={bales}
      format={v => `${Number(v).toLocaleString('en-US')} ${Number(v) === 1 ? 'bale' : 'bales'}`}
      label="Bales fed"
      audit="event-quantity"
      min={1}
      max={10_000}
      className={className}
      onSave={n => {
        const id = newEventId()
        try {
          enqueue({ id, bales: n }, `Fed ${n} ${n === 1 ? 'bale' : 'bales'} (was ${bales})`, UNDO_HOLD_MS, { endpoint: `/api/activity/${eventId}/correct`, link: { href: `/ranch/activity/${eventId}`, label: 'Open this entry' } })
          return id
        } catch { return null }
      }}
    />
  )
}
