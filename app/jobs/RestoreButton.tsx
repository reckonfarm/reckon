'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Un-dismiss from the show-all list. Lives inside the card's <Link>, so it
// must swallow the click before the link navigates. router.refresh() is the
// standalone-PWA-safe way to re-pull the server payload.
export default function RestoreButton({ jobId }: { jobId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async e => {
        e.preventDefault()
        e.stopPropagation()
        setBusy(true)
        try {
          await fetch(`/api/jobs/${jobId}/annotation`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dismissed: false }),
          })
          router.refresh()
        } finally {
          setBusy(false)
        }
      }}
      className="rounded-lg border border-forest-green/20 px-3 py-1.5 font-dm-sans text-xs font-semibold text-forest-green hover:bg-forest-green/5 disabled:opacity-50"
    >
      {busy ? 'Restoring…' : 'Restore'}
    </button>
  )
}
