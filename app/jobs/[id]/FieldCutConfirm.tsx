'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FieldCutStatus } from '@/lib/jobs/annotations'

// System proposes, operator confirms — same doctrine as MachineConfirm. When
// a field's boundary is confirmed, the machine has left it, and the sweep is
// either essentially complete or flagged as a floor (undersampled), the card
// asks: "Looks like you finished this field — mark it cut?" One tap writes
// the completion into job_annotations.fields_cut (040) — user intent over a
// derived layer, survives every re-derivation. Never auto-marks; dismissable;
// undoable. The completion changes the STORY (headline + full-polygon fill),
// never the measurements.

async function patchFieldCut(jobId: string, index: number, status: FieldCutStatus | null) {
  await fetch(`/api/jobs/${jobId}/annotation`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field_cut: { index, status } }),
  })
}

export default function FieldCutConfirm({ jobId, fieldIndex, status, proposed }: {
  jobId: string
  fieldIndex: number
  status: FieldCutStatus | null
  proposed: boolean // the system's conditions for asking are met
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const run = async (next: FieldCutStatus | null) => {
    setBusy(true)
    try {
      await patchFieldCut(jobId, fieldIndex, next)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (status === 'cut') {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => run(null)}
        className="mt-0.5 font-dm-sans text-xs text-forest-green/45 hover:text-forest-green disabled:opacity-50"
      >
        Not finished after all? Undo
      </button>
    )
  }

  if (status === 'dismissed') {
    // Dismissed the proposal but can still mark it later, quietly.
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => run('cut')}
        className="mt-0.5 font-dm-sans text-xs text-forest-green/45 hover:text-forest-green disabled:opacity-50"
      >
        Mark field cut
      </button>
    )
  }

  if (!proposed) return null

  return (
    <div className="mt-1.5">
      <p className="font-dm-sans text-sm text-forest-green/70">
        Looks like you finished this field — mark it cut?
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run('cut')}
          className="rounded-full bg-forest-green px-4 py-1.5 font-dm-sans text-sm font-semibold text-white disabled:opacity-50"
        >
          Mark it cut
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run('dismissed')}
          className="rounded-full border border-forest-green/20 px-3 py-1.5 font-dm-sans text-sm text-forest-green hover:bg-forest-green/5 disabled:opacity-50"
        >
          Not yet
        </button>
      </div>
    </div>
  )
}
