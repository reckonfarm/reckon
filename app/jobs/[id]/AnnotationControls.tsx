'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/app/components/ui/Card'
import { NAME_SUGGESTIONS } from '@/lib/jobs/annotations'
import { deleteWithUndo, callDelete, restoreFromTrash, showNotice } from '@/lib/undo'

// Name + delete controls for one job. Naming is chips-first — one tap covers
// the common case, typing is the fallback, and the whole thing is a stopgap
// until field boundaries let the place supply the name.
//
// Block 13: DELETE MEANS ONE THING. The job row is derived and the cron
// rewrites it, so "deleted" for a session is job_annotations.dismissed_at —
// but the person sees the same thing they see everywhere: Delete, the strip's
// Undo for ten seconds, and the session in /account/trash after that. The
// word "dismiss" is gone from the screen.

async function patch(jobId: string, body: Record<string, unknown>) {
  await fetch(`/api/jobs/${jobId}/annotation`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export default function AnnotationControls({ jobId, name, dismissed }: {
  jobId: string
  name: string | null
  dismissed: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  // Block 13: a row held for Fix lands here with the name form open (#fix).
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#fix') return
    const t = setTimeout(() => { setEditing(true); document.getElementById('job-fix')?.scrollIntoView({ block: 'start' }) }, 0)
    return () => clearTimeout(t)
  }, [])
  const [customOpen, setCustomOpen] = useState(false)
  const [customText, setCustomText] = useState('')

  const run = async (body: Record<string, unknown>) => {
    setBusy(true)
    try {
      await patch(jobId, body)
      setEditing(false)
      setCustomOpen(false)
      setCustomText('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const chips = (
    <div className="mt-2 flex flex-wrap gap-2">
      {NAME_SUGGESTIONS.map(s => (
        <button
          key={s}
          type="button"
          disabled={busy}
          onClick={() => run({ name: s })}
          className="rounded-full border border-forest-green/20 px-3 py-1.5 font-dm-sans text-[16px] text-forest-green hover:bg-forest-green/5 disabled:opacity-50"
        >
          {s}
        </button>
      ))}
      {!customOpen ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setCustomOpen(true)}
          className="rounded-full border border-dashed border-forest-green/25 px-3 py-1.5 font-dm-sans text-[16px] text-secondary-ink hover:text-forest-green disabled:opacity-50"
        >
          Custom…
        </button>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={e => {
            e.preventDefault()
            if (customText.trim()) run({ name: customText })
          }}
        >
          <input
            autoFocus
            value={customText}
            onChange={e => setCustomText(e.target.value)}
            maxLength={80}
            placeholder="Session name"
            className="rounded-lg border border-forest-green/20 bg-white px-3 py-1.5 font-dm-sans text-[16px] text-forest-green outline-none focus:border-forest-green/40"
          />
          <button
            type="submit"
            disabled={busy || !customText.trim()}
            className="rounded-lg bg-forest-green px-3 py-1.5 font-dm-sans text-[16px] font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
        </form>
      )}
    </div>
  )

  async function remove() {
    setBusy(true)
    const r = await deleteWithUndo({ label: name ?? 'this session', run: () => callDelete(`/api/jobs/${jobId}/annotation`, { method: 'PATCH', body: JSON.stringify({ dismissed: true }) }), undo: restoreFromTrash('jobs', jobId) })
    setBusy(false)
    if (!r.ok) { showNotice(r.error); return }
    router.refresh()
  }

  return (
    <Card shadow="none" className="mt-5 px-5 py-4" id="job-fix" data-audit="job-fix">
      {dismissed && (
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-forest-green/10 pb-3" data-audit="job-deleted">
          <p className="font-dm-sans text-[16px] text-secondary-ink">
            Deleted — it is in the trash.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run({ dismissed: false })}
            className="min-h-[48px] rounded-lg border border-forest-green/20 px-3 py-1.5 font-dm-sans text-[16px] font-semibold text-forest-green hover:bg-forest-green/5 disabled:opacity-50"
            data-audit="job-put-back"
          >
            Put it back
          </button>
        </div>
      )}

      {name && !editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-dm-sans text-[16px] text-secondary-ink">
            Named <span className="font-semibold text-forest-green">{name}</span>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
            className="font-dm-sans text-[14px] font-semibold text-secondary-ink hover:text-forest-green disabled:opacity-50"
          >
            Change
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run({ name: null })}
            className="font-dm-sans text-[14px] font-semibold text-secondary-ink hover:text-forest-green disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      ) : (
        <div>
          <p className="font-dm-sans text-[16px] text-secondary-ink">
            Name this session <span className="text-secondary-ink">(optional)</span>
          </p>
          {chips}
        </div>
      )}

      {/* A real button, not a footnote — this control went unfound as a
          low-contrast text link. Bottom of the page is still the right home
          for a hide-this action, but it has to look like an action. */}
      {!dismissed && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-forest-green/10 pt-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="min-h-[48px] rounded-lg border px-3 py-1.5 font-dm-sans text-[16px] font-semibold disabled:opacity-50"
            style={{ color: '#C2410C', borderColor: '#C2410C' }}
            data-audit="job-delete"
          >
            {busy ? 'Deleting…' : 'Delete this session'}
          </button>
          <span className="font-dm-sans text-[14px] text-secondary-ink">
            It goes to the trash. Undo for ten seconds, or put it back from Account → Trash.
          </span>
        </div>
      )}
    </Card>
  )
}
