'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteWithUndo, callDelete, restoreFromTrash, showNotice } from '@/lib/undo'

// ─── "Undo this working" (Block 15, ruling 3) ─────────────────────────────────
// A preg check is one record: the check and the split. One tap here takes it
// all back — the working goes to the trash, the projection puts the heads
// back, the bunch it made goes with it — and the strip offers to put it back
// for ten seconds, like any delete.
export default function TakeBackButton({ eventId, label }: { eventId: string; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  if (done) return null
  return (
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true)
      const r = await deleteWithUndo({ label, run: () => callDelete(`/api/activity/${eventId}/delete`, { method: 'DELETE' }), undo: restoreFromTrash('events', eventId) })
      setBusy(false)
      if (!r.ok) { showNotice(r.error); return }
      setDone(true); router.refresh()
    }} className="mt-2 min-h-[48px] rounded-lg border border-rust/40 bg-surface px-4 font-dm-sans text-[16px] font-semibold text-rust disabled:opacity-50" data-audit="take-back">
      {busy ? 'Taking it back…' : 'Undo this'}
    </button>
  )
}
