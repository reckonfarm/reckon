'use client'

import { openLogIt } from './LogIt'

// ─── Log rain — the action that sits with Rain on my places (Block 7, Part 3) ─
// Opens the one record sheet on Rain, with the place already chosen when the
// button belongs to a row. A reading is the only way a place's rain is known.
export default function LogRainButton({ placeId, placeName, compact = false }: { placeId?: string; placeName?: string; compact?: boolean }) {
  return (
    <button type="button" onClick={() => openLogIt({ type: 'rain', ...(placeId ? { place: placeId } : {}) })} data-audit={compact ? 'log-rain-here' : 'log-rain'}
      className={compact
        ? 'inline-flex min-h-[44px] items-center font-dm-sans text-[15px] font-semibold text-forest-green underline underline-offset-2'
        : 'inline-flex min-h-[48px] items-center rounded-lg bg-forest-green px-4 font-dm-sans text-[16px] font-semibold text-cream hover:bg-forest-green/90'}>
      {compact ? `Log rain${placeName ? ` at ${placeName}` : ' here'}` : 'Log rain'}
    </button>
  )
}
