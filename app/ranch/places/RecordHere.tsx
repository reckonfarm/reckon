'use client'

import { openLogIt } from '@/app/dashboard/components/LogIt'

// ─── Record here (Block 6A) ───────────────────────────────────────────────────
// The one primary action on a place (and on the places list, where the sheet's
// "new place" field is how a place is created). Opens the record sheet with
// the place pre-filled; the person picks what to record.
export default function RecordHere({ placeId, placeName }: { placeId?: string; placeName?: string } = {}) {
  return (
    <button
      type="button"
      onClick={() => openLogIt({ type: null, ...(placeId ? { place: placeId } : {}) })}
      className="inline-flex min-h-[56px] w-full items-center justify-center rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream hover:bg-forest-green/90 sm:w-auto"
      data-audit="record-here"
    >
      {placeName ? `Record here · ${placeName}` : 'Record work'}
    </button>
  )
}
