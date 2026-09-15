'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/app/components/ui/Card'
import { PLACE_KINDS, MAX_NAME, allowedParentKinds, kindLabel, parentRule } from '@/lib/places/kinds'
import { warning } from '@/lib/brand-colors'
import { deleteWithUndo, callDelete, restoreFromTrash, showNotice } from '@/lib/undo'

// ─── Correcting a place (057) ─────────────────────────────────────────────────
//
// Name, kind, retire. The route has been able to do most of this for a while;
// nothing reached it, which is the whole reason "Preston's house" is a field
// and both drawn places are typed pasture.
//
// THE CONCURRENCY CONTRACT, and why the copy matters more than the mechanism:
// the form reads `updated_at` when it opens and sends it back as
// `expected_updated_at`. If someone else saved in between, the write matches
// nothing and the route answers 409 with the sentence lib/stale-edit.ts holds
// for both places and herd lots — naming who changed it and when. On that
// answer this component does three things, and all three are the point:
//   · keeps every character the person typed, exactly where it was;
//   · refreshes the page behind so the OTHER person's version is what the
//     record now shows, which is what the message promises;
//   · adopts their token, so the very next Save wins instead of 409ing
//     forever. The message says "check theirs, then save yours again" — this
//     is what makes that instruction true.
//
// Retire is not "are you sure". It says what actually happens, because the
// honest answer is reassuring: the place leaves the pickers and keeps naming
// every entry that already happened there. Nothing is deleted, and it comes
// back with one tap.

export interface EditablePlace {
  id: string
  name: string
  kind: string
  updatedAt: string
  retiredAt: string | null
  /** Block 7A: the live parent, if any. */
  parentId: string | null
  parentName: string | null
  /** Block 13: shown on Weather (7D.4's pin), now a switch on this form. */
  pinned: boolean
}

interface PlaceOption { id: string; name: string; kind: string }

type Mode = 'idle' | 'editing'

const inputCls = 'mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink'
const labelCls = 'block font-dm-sans text-[14px] font-medium text-secondary-ink'

export default function EditPlace({ place }: { place: EditablePlace }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [name, setName] = useState(place.name)
  const [kind, setKind] = useState(place.kind)
  // Block 7A: the parent. Candidates are the ranch's live places, loaded when
  // the form opens, filtered by the kind table for the kind being chosen —
  // change the kind and the parent row changes with it. This place and the
  // places inside it are never offered (a loop the route and 068 would refuse
  // anyway; better not to offer the chip).
  const [parentId, setParentId] = useState<string | null>(place.parentId)
  const [pinned, setPinned] = useState(place.pinned)
  const [options, setOptions] = useState<PlaceOption[] | null>(null)
  useEffect(() => {
    if (mode !== 'editing' || options !== null) return
    let alive = true
    fetch('/api/places').then(r => (r.ok ? r.json() : { places: [] })).then(j => { if (alive) setOptions(((j.places ?? []) as PlaceOption[]).filter(p => p.id !== place.id)) }).catch(() => { if (alive) setOptions([]) })
    return () => { alive = false }
  }, [mode, options, place.id])
  const allowed = allowedParentKinds(kind)
  const parentOptions = (options ?? []).filter(p => allowed.includes(p.kind))
  // DERIVED: a parent the current kind cannot sit inside reads as none. The
  // chip is off the row, so the value is not read — never synced by an effect.
  const effectiveParent: string | null = options === null
    ? parentId
    : parentOptions.some(p => p.id === parentId) ? parentId : null
  const [expected, setExpected] = useState(place.updatedAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Block 13: DELETE MEANS ONE THING. One tap, to the trash, and the strip
  // offers Undo for ten seconds; the entries that name this place keep naming
  // it. No count, no cascade, no "are you sure".
  const remove = async () => {
    setBusy(true); setError(null)
    const r = await deleteWithUndo({ label: place.name, run: () => callDelete(`/api/places/${place.id}`, { method: 'DELETE' }), undo: restoreFromTrash('places', place.id), after: `/ranch/places/${place.id}` })
    setBusy(false)
    if (!r.ok) { showNotice(r.error); return }
    router.push('/ranch/places'); router.refresh()
  }

  // Block 12 (12.3): a row held for Fix lands here with the form open.
  // Block 13: #delete deletes at once — the strip's Undo is the safety.
  useEffect(() => {
    const h = typeof window !== 'undefined' ? window.location.hash : ''
    if (h !== '#edit' && h !== '#delete') return
    const t = setTimeout(() => { if (h === '#edit') setMode('editing'); else void remove() }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/places/${place.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // A stale edit: keep their typing, show theirs, and let the next save win.
        if (res.status === 409 && json.code === 'stale') {
          if (typeof json.changed_at === 'string') setExpected(json.changed_at)
          router.refresh()
        }
        throw new Error(json.error ?? 'That change could not be saved.')
      }
      const saved = json.place as { updated_at?: string } | undefined
      if (saved?.updated_at) setExpected(saved.updated_at)
      setMode('idle')
      router.refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That change could not be saved.')
      return false
    } finally {
      setBusy(false)
    }
  }

  // ── A retired place: say so, and offer the way back ─────────────────────────
  if (place.retiredAt) {
    return (
      <Card className="mt-4 border-forest-green/25 p-4 sm:p-5" data-audit="place-retired">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">This place is off the list.</p>
        <p className="mt-1 font-dm-sans text-[16px] leading-snug text-secondary-ink">
          Nothing new can be recorded here until it is back. It still names the entries that already happened here, and it always will.
        </p>
        {error && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="place-edit-error">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ retired: false, expected_updated_at: expected })}
          className="mt-4 inline-flex min-h-[52px] w-full items-center justify-center rounded-lg border border-forest-green/30 px-4 font-dm-sans text-[17px] font-semibold text-forest-green disabled:opacity-50 sm:w-auto"
          data-audit="place-unretire"
        >
          {busy ? 'Putting it back…' : 'Put it back'}
        </button>
      </Card>
    )
  }

  // ── The form ────────────────────────────────────────────────────────────────
  if (mode === 'editing') {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="place-edit">
        <label className={labelCls} htmlFor="edit-place-name">Name
          <input id="edit-place-name" value={name} onChange={e => setName(e.target.value)} maxLength={MAX_NAME} className={inputCls} data-audit="place-edit-name" />
        </label>

        <p className="mt-4 font-dm-sans text-[14px] font-medium text-secondary-ink" id="edit-place-kind-label">What kind of place</p>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="edit-place-kind-label" data-audit="place-edit-kind">
          {PLACE_KINDS.map(k => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => setKind(k.value)}
              className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${kind === k.value ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink">{PLACE_KINDS.find(k => k.value === kind)?.hint ?? ' '}</p>

        {/* Block 7A: inside what. No row for a kind that is never inside
            anything, and none while the candidates are still loading — a
            control that cannot yet say anything true is not shown. */}
        {allowed.length > 0 && options !== null && (parentOptions.length > 0 || effectiveParent) && (
          <>
            <p className="mt-4 font-dm-sans text-[14px] font-medium text-secondary-ink" id="edit-place-parent-label">Inside</p>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="edit-place-parent-label" data-audit="place-edit-parent">
              <button type="button" role="radio" aria-checked={effectiveParent === null} onClick={() => setParentId(null)} className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${effectiveParent === null ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`} data-audit="place-edit-parent-none">
                None
              </button>
              {parentOptions.map(p => (
                <button key={p.id} type="button" role="radio" aria-checked={effectiveParent === p.id} onClick={() => setParentId(p.id)} className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${effectiveParent === p.id ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`} data-audit="place-edit-parent-option" data-kind={p.kind}>
                  {p.name} <span className="font-normal opacity-80">· {kindLabel(p.kind).toLowerCase()}</span>
                </button>
              ))}
            </div>
            <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink">{parentRule(kind)}</p>
          </>
        )}

        {/* Block 13: the Weather list's pin, where a person would look for it —
            on the place's own form, not a link on the Weather row. */}
        <label className="mt-4 flex min-h-[48px] items-center gap-3 font-dm-sans text-[16px] text-ink" data-audit="place-edit-pinned">
          <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} className="h-6 w-6 accent-forest-green" />
          <span>Show on Weather <span className="text-secondary-ink">· even before any rain is recorded here</span></span>
        </label>

        {error && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold leading-snug" style={{ color: warning }} data-audit="place-edit-error">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => send({ name: name.trim(), kind, ...(effectiveParent !== place.parentId ? { parent_id: effectiveParent } : {}), ...(pinned !== place.pinned ? { pinned } : {}), expected_updated_at: expected })}
            className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50"
            data-audit="place-edit-save"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" disabled={busy} onClick={() => { setName(place.name); setKind(place.kind); setParentId(place.parentId); setPinned(place.pinned); setError(null); setMode('idle') }} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2 disabled:opacity-50" data-audit="place-edit-cancel">
            Cancel
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          {/* Block 13: one tap. It goes to the trash, the strip offers Undo. */}
          <button type="button" disabled={busy} onClick={() => void remove()} className="inline-flex min-h-[44px] items-center font-dm-sans text-[16px] font-semibold underline underline-offset-2 disabled:opacity-50" style={{ color: warning }} data-audit="place-delete-open">
            Delete this place
          </button>
        </div>
      </Card>
    )
  }

  return (
    <button
      type="button"
      onClick={() => { setName(place.name); setKind(place.kind); setParentId(place.parentId); setError(null); setMode('editing') }}
      className="mt-3 inline-flex min-h-[44px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2"
      data-audit="place-edit-open"
    >
      Fix name, kind or where it sits
    </button>
  )
}
