'use client'

import { useState } from 'react'
import type { PlaceMemory } from '@/lib/places/history'

// The two or three actions that make sense at a place — each opens the Log
// it sheet pre-filled with this place — and the retrieval chips: tap "Last
// feeding" and the record answers underneath, from the same ledger lines the
// page opened with. No chatbot; the ledger already knows.

const CHIP_ORDER: PlaceMemory['kind'][] = ['feeding', 'rain', 'stacked', 'count', 'moved', 'worked', 'device']
const CHIP_LABEL: Record<PlaceMemory['kind'], string> = {
  feeding: 'Last feeding', rain: 'Last rain', stacked: 'Last stacked', count: 'Last count',
  moved: 'Last move', worked: 'Last worked', device: 'Last reading',
}

export default function PlaceActions({ placeId, placeName, memory }: { placeId: string; placeName: string; memory: PlaceMemory[] }) {
  const [openChip, setOpenChip] = useState<PlaceMemory['kind'] | null>(null)
  const byKind = new Map(memory.map(m => [m.kind, m]))
  const chips = CHIP_ORDER.filter(k => byKind.has(k))
  const shown = openChip ? byKind.get(openChip) ?? null : null

  return (
    <div className="space-y-4">
      {/* Block 6A: the full-width log bar is gone — Record here (above) is the one primary action. The retrieval chips stay. */}
      {chips.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={`When did we last… at ${placeName}`}>
            {chips.map(k => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={openChip === k}
                onClick={() => setOpenChip(openChip === k ? null : k)}
                className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${openChip === k ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green hover:bg-forest-green/5'}`}
              >
                {CHIP_LABEL[k]}
              </button>
            ))}
          </div>
          {shown && (
            <p role="status" aria-live="polite" className="mt-3 rounded-lg bg-forest-green/[0.06] px-4 py-3 font-dm-sans text-[17px] leading-snug text-forest-green">
              <span className="font-semibold">{shown.label}:</span> {shown.answer}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
