'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/app/components/ui/Card'
import { NAME_SUGGESTIONS } from '@/lib/jobs/annotations'

// Name + dismiss controls for one job. Naming is chips-first — one tap covers
// the common case, typing is the fallback, and the whole thing is a stopgap
// until field boundaries let the place supply the name. The dismiss verb is
// what it says: hides, never deletes — the job itself is a derived artifact
// the cron rewrites every few minutes.

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
          className="rounded-full border border-forest-green/20 px-3 py-1.5 font-dm-sans text-sm text-forest-green hover:bg-forest-green/5 disabled:opacity-50"
        >
          {s}
        </button>
      ))}
      {!customOpen ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setCustomOpen(true)}
          className="rounded-full border border-dashed border-forest-green/25 px-3 py-1.5 font-dm-sans text-sm text-forest-green/60 hover:text-forest-green disabled:opacity-50"
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
            className="rounded-lg border border-forest-green/20 bg-white px-3 py-1.5 font-dm-sans text-sm text-forest-green outline-none focus:border-forest-green/40"
          />
          <button
            type="submit"
            disabled={busy || !customText.trim()}
            className="rounded-lg bg-forest-green px-3 py-1.5 font-dm-sans text-sm font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
        </form>
      )}
    </div>
  )

  return (
    <Card shadow="none" className="mt-5 px-5 py-4">
      {dismissed && (
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-forest-green/10 pb-3">
          <p className="font-dm-sans text-sm text-forest-green/60">
            Dismissed — hidden from the jobs list.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run({ dismissed: false })}
            className="rounded-lg border border-forest-green/20 px-3 py-1.5 font-dm-sans text-xs font-semibold text-forest-green hover:bg-forest-green/5 disabled:opacity-50"
          >
            Restore
          </button>
        </div>
      )}

      {name && !editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-dm-sans text-sm text-forest-green/70">
            Named <span className="font-semibold text-forest-green">{name}</span>
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(true)}
            className="font-dm-sans text-xs font-semibold text-forest-green/60 hover:text-forest-green disabled:opacity-50"
          >
            Change
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run({ name: null })}
            className="font-dm-sans text-xs font-semibold text-forest-green/60 hover:text-forest-green disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      ) : (
        <div>
          <p className="font-dm-sans text-sm text-forest-green/70">
            Name this session <span className="text-forest-green/45">(optional)</span>
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
            onClick={() => run({ dismissed: true })}
            className="rounded-lg border border-forest-green/20 px-3 py-1.5 font-dm-sans text-xs font-semibold text-forest-green hover:bg-forest-green/5 disabled:opacity-50"
          >
            Dismiss this session
          </button>
          <span className="font-dm-sans text-xs text-forest-green/40">
            Hides it from the list; find it again under “Show all sessions”.
          </span>
        </div>
      )}
    </Card>
  )
}
