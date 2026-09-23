'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── Reviewed — the review boundary is an action (Block 6 · 6H) ───────────────
// "Checked" used to mean the page had been open for four seconds. Now it means
// this button was pressed with the entries in front of the person. It moves
// ranch_members.last_seen_at (POST /api/seen) and nothing else: the entries
// stay findable in the record, and the quiet state links to them. Offered only
// where EVERY entry since the last review is on the page — never where a
// "View all" or an older page could hide one.
// Block 29: `through` is the newest made-at this surface showed. The cursor is
// stamped no earlier than that, so a phone ahead of the server cannot keep its
// own last records "new" after a review.
export default function ReviewedButton({ count, through = null }: { count: number; through?: string | null }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy')
          try {
            const r = await fetch('/api/seen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ through }) })
            if (!r.ok) throw new Error(String(r.status))
            router.refresh()
          } catch { setState('failed') }
        }}
        className="inline-flex min-h-[48px] items-center rounded-lg border border-forest-green/25 bg-surface px-4 font-dm-sans text-[16px] font-semibold text-forest-green hover:bg-forest-green/5 disabled:opacity-60"
        data-audit="mark-reviewed"
      >
        {state === 'busy' ? 'Marking…' : `Reviewed · ${count}`}
      </button>
      {state === 'failed' && <p className="mt-1 font-dm-sans text-[15px] text-rust" role="alert">Couldn’t mark it — try again when you have signal.</p>}
    </div>
  )
}
