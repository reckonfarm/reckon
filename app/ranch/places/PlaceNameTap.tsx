'use client'

import TapValue from '@/app/components/TapValue'
import { enqueue, newEventId } from '@/lib/outbox'
import { UNDO_HOLD_MS } from '@/app/dashboard/components/RepeatLastCard'

// Block 37: a place's name IS the control. Tap it, type, Done — renamed,
// through the outbox with its ten-second Undo; every entry that names the
// place keeps naming it.
export default function PlaceNameTap({ placeId, name, className }: { placeId: string; name: string; className?: string }) {
  return (
    <TapValue
      value={name}
      kind="text"
      label="Place name"
      audit="place-name"
      className={className}
      onSave={v => {
        const id = newEventId()
        try {
          enqueue({ id, name: String(v) }, `Renamed to ${String(v)}`, UNDO_HOLD_MS, { endpoint: `/api/places/${placeId}/name`, link: { href: `/ranch/places/${placeId}`, label: 'Open this place' } })
          return id
        } catch { return null }
      }}
    />
  )
}
