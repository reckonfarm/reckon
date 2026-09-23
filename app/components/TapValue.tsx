'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import SaveStatus from '@/app/dashboard/components/SaveStatus'

// ─── The number is the control (Block 37) ────────────────────────────────────
// A value on screen that can change IS its own control: tap it, a keypad (or
// the keyboard, for a name) opens on the spot, Done saves. No edit screen, no
// form, no Save button for one value — correcting is the same motion as
// recording. The caller says what a save DOES (it enqueues to the outbox and
// hands back the item's id), and the receipt with its Undo renders right here,
// under the thumb. The keypad never blocks on signal: the outbox owns sending.
//
// The value paints as the caller's typography (className); a dotted underline
// is the one hint that it answers a tap. The painted text stays the plain
// value, so every reader — a person, a check — reads the number, not a control.
export default function TapValue({ value, format, label, audit, kind = 'number', min = 0, max = 1_000_000, integer = true, maxLength = 80, className = '', onSave }: {
  value: number | string
  /** How the value paints (default: the number with thousands separators, or the text). */
  format?: (v: number | string) => string
  /** The accessible name — a short noun phrase that no form field on the same screens uses. */
  label: string
  audit: string
  kind?: 'number' | 'text'
  min?: number
  max?: number
  integer?: boolean
  maxLength?: number
  className?: string
  /** Saves the new value (enqueue it) and returns the outbox item id a receipt can follow — or null when nothing was saved. */
  onSave: (v: number | string) => string | null
}) {
  const [shown, setShown] = useState<number | string>(value)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [madeId, setMadeId] = useState<string | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  // A fresh value from the server (a refresh after the sync) wins over the
  // optimistic one — derived during render, the React way, not in an effect.
  const [seen, setSeen] = useState(value)
  if (value !== seen) { setSeen(value); setShown(value) }
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select() } }, [editing])

  const paint = (v: number | string) => format ? format(v) : typeof v === 'number' ? v.toLocaleString('en-US') : String(v)

  const start = () => { setDraft(String(shown)); setEditing(true) }
  const cancel = () => setEditing(false)
  const commit = () => {
    if (!editing) return
    setEditing(false)
    if (kind === 'number') {
      const n = Number(draft.replace(/,/g, '').trim())
      if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max || n === shown) return
      const id = onSave(n)
      if (id) { setShown(n); setMadeId(id) }
    } else {
      const t = draft.trim().slice(0, maxLength)
      if (!t || t === shown) return
      const id = onSave(t)
      if (id) { setShown(t); setMadeId(id) }
    }
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
  }

  return (
    <>
      {editing ? (
        <input
          ref={input}
          type={kind === 'number' ? 'text' : 'text'}
          inputMode={kind === 'number' ? (integer ? 'numeric' : 'decimal') : 'text'}
          enterKeyHint="done"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          onClick={e => e.stopPropagation()}
          aria-label={label}
          className={`min-h-[48px] w-[7ch] max-w-full rounded-md border border-forest-green bg-white px-2 text-ink outline-none ${kind === 'text' ? 'w-full' : ''} ${className}`}
          size={kind === 'text' ? Math.max(6, Math.min(40, draft.length + 2)) : undefined}
          data-audit={`${audit}-input`}
        />
      ) : (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); start() }}
          aria-label={label}
          className={`min-h-[48px] rounded-md underline decoration-dotted decoration-1 underline-offset-4 hover:bg-forest-green/5 ${className}`}
          data-audit={audit}
          data-tap-value
        >
          {paint(shown)}
        </button>
      )}
      {madeId && <div className="mt-2" data-audit={`${audit}-receipt`}><SaveStatus itemId={madeId} /></div>}
    </>
  )
}
