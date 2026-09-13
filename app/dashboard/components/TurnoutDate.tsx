'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { warning } from '@/lib/brand-colors'

// ─── Setting the turnout date (Block 9) ───────────────────────────────────────
//
// PK's ruling: asked once, in the hay planning surface itself, not buried in
// settings; last year's remembered and OFFERED as the default, editable; never
// auto-set. So the suggestion arrives with his own history attached — "Last
// year you turned out May 15" — and it sits in the field unsaved until he
// presses Set. Opening this screen changes nothing.
//
// One control, two states, no modal: a button that becomes a date field. The
// save is loud both ways (6A-5: every submit must be able to fail loudly), and
// a refresh is what shows the new answer, so the numbers and the date can
// never disagree on screen.

const inputCls = 'block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink'

export default function TurnoutDate({ current, suggested, lastYear, prompt }: {
  /** The turnout already set, if any. */
  current: string | null
  /** Last year's date moved to its next occurrence — a suggestion, never applied. */
  suggested: string | null
  /** Last year's actual turnout, for the sentence that explains the suggestion. */
  lastYear: string | null
  /** The words on the button when nothing is set yet. */
  prompt: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(current ?? suggested ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/ranch/turnout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const body = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) {
        setError(body?.error ?? 'That date could not be saved just now.')
        setBusy(false)
        return
      }
      setOpen(false)
      setBusy(false)
      router.refresh()
    } catch {
      setError('That date could not be saved — you may be off the network.')
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex min-h-[48px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[17px] font-semibold text-brand"
        data-audit="turnout-open"
      >
        {current ? 'Change turnout date' : prompt}
      </button>
    )
  }

  return (
    <div className="mt-2" data-audit="turnout-form">
      <label className="block font-dm-sans text-[14px] font-medium text-secondary-ink" htmlFor="turnout-date">
        Turnout date
      </label>
      <input
        id="turnout-date"
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        className={`mt-1 ${inputCls}`}
        data-audit="turnout-input"
      />
      {/* The suggestion carries its reason, so it reads as his own record
          rather than the app deciding for him. */}
      {lastYear && (
        <p className="mt-1.5 font-dm-sans text-[14px] text-ink" data-audit="turnout-suggestion">
          Last year you turned out {lastYear}.
        </p>
      )}
      {error && (
        <p className="mt-2 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} role="alert" data-audit="turnout-error">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || !date}
          onClick={() => void save()}
          className="inline-flex min-h-[48px] items-center rounded-lg bg-brand px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50"
          data-audit="turnout-save"
        >
          {busy ? 'Saving…' : 'Set turnout date'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => { setOpen(false); setError(null); setDate(current ?? suggested ?? '') }}
          className="inline-flex min-h-[48px] items-center rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink"
          data-audit="turnout-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
