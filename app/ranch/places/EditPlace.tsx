'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card } from '@/app/components/ui/Card'
import { PLACE_KINDS, MAX_NAME } from '@/lib/places/kinds'
import { warning } from '@/lib/brand-colors'

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
}

type Mode = 'idle' | 'editing' | 'confirmRetire' | 'confirmDelete' | 'referenced'

const inputCls = 'mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink'
const labelCls = 'block font-dm-sans text-[14px] font-medium text-secondary-ink'

export default function EditPlace({ place }: { place: EditablePlace }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [name, setName] = useState(place.name)
  const [kind, setKind] = useState(place.kind)
  const [expected, setExpected] = useState(place.updatedAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 7D.3: what the route said still points at this place. Set only by a 409
  // from DELETE, so the message is counted server-side, never guessed here.
  const [refs, setRefs] = useState<{ message: string; entries: number; cascadeMessage?: string; hard?: number; record?: number } | null>(null)

  const send = async (body: Record<string, unknown>, method: 'PATCH' | 'DELETE' = 'PATCH', qs = '') => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/places/${place.id}${qs}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 7D.3: it is referenced. Not an error to apologise for — an answer.
        if (res.status === 409 && json.error === 'still referenced') {
          setRefs({
            message: String(json.message ?? ''),
            entries: Number(json.refs?.entries ?? 0),
            cascadeMessage: typeof json.cascadeMessage === 'string' ? json.cascadeMessage : undefined,
            hard: json.cascade?.hard, record: json.cascade?.record,
          })
          setMode('referenced')
          setBusy(false)
          return
        }
        // A stale edit: keep their typing, show theirs, and let the next save win.
        if (res.status === 409 && json.code === 'stale') {
          if (typeof json.changed_at === 'string') setExpected(json.changed_at)
          router.refresh()
        }
        throw new Error(json.error ?? 'That change could not be saved.')
      }
      // 7D.3: it is actually gone — this page is about a row that no longer
      // exists, so leave rather than re-render an empty shell.
      if (json.deleted) { router.push('/ranch/places'); router.refresh(); return }
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
        <p className="font-dm-sans text-[17px] font-semibold text-ink">This place is retired.</p>
        <p className="mt-1 font-dm-sans text-[16px] leading-snug text-secondary-ink">
          It is off every picker, so nothing new can be recorded here. It still names the entries that already happened here, and it always will.
        </p>
        {error && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="place-edit-error">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ retired: false, expected_updated_at: expected })}
          className="mt-4 inline-flex min-h-[52px] w-full items-center justify-center rounded-lg border border-forest-green/30 px-4 font-dm-sans text-[17px] font-semibold text-forest-green disabled:opacity-50 sm:w-auto"
          data-audit="place-unretire"
        >
          {busy ? 'Putting it back…' : 'Put it back on the list'}
        </button>
      </Card>
    )
  }

  // ── It is referenced: not deleted, and told why (7D.3) ──────────────────────
  // The count is the route's, taken across four untyped jsonb keys plus the
  // real foreign keys. The offer is to GO AND LOOK — this screen will not
  // decide for someone whether history should be detached from its place.
  if (mode === 'referenced') {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="place-referenced">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">{place.name} wasn&rsquo;t deleted.</p>
        {/* 8B.2 — the plain answer STAYS, and the way through it is offered in
            the same breath. Both numbers are stated before the tap, so the
            cascade is one decision rather than a refusal followed by a
            second, differently-worded prompt. */}
        <p className="mt-1 font-dm-sans text-[16px] leading-snug text-secondary-ink" data-audit="place-referenced-count">
          {refs?.cascadeMessage || refs?.message || 'Something still points at it.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {refs?.cascadeMessage && (
            <button type="button" disabled={busy} onClick={() => send({}, 'DELETE', '?cascade=1')}
              className="min-h-[52px] w-full rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50"
              style={{ backgroundColor: warning }} data-audit="place-cascade-delete">
              {busy ? 'Deleting…' : `Delete ${place.name} and everything recorded there`}
            </button>
          )}
          {(refs?.entries ?? 0) > 0 && (
            <Link href={`/ranch/activity?place=${place.id}`} className="inline-flex min-h-[52px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[17px] font-semibold text-ink" data-audit="place-referenced-go">
              See what points at it
            </Link>
          )}
          <button type="button" onClick={() => { setRefs(null); setMode('confirmRetire') }} className="inline-flex min-h-[52px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[17px] font-semibold text-ink" data-audit="place-referenced-retire">
            Retire it instead
          </button>
          <button type="button" onClick={() => { setRefs(null); setMode('idle') }} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="place-referenced-cancel">
            Leave it
          </button>
        </div>
      </Card>
    )
  }

  // ── Delete, explained (7D.3) ────────────────────────────────────────────────
  if (mode === 'confirmDelete') {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="place-confirm-delete">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">Delete {place.name}?</p>
        <p className="mt-1 font-dm-sans text-[16px] leading-snug text-secondary-ink">
          If nothing points at it, it is gone for good. If anything still does, it won&rsquo;t be
          deleted — you&rsquo;ll be told what, and can go and look.
        </p>
        {error && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="place-edit-error">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => send({}, 'DELETE')} className="min-h-[52px] flex-1 rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50" style={{ backgroundColor: warning }} data-audit="place-delete-confirm">
            {busy ? 'Deleting…' : 'Delete it'}
          </button>
          <button type="button" disabled={busy} onClick={() => { setError(null); setMode('idle') }} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2 disabled:opacity-50" data-audit="place-delete-cancel">
            Keep it
          </button>
        </div>
      </Card>
    )
  }

  // ── Retire, explained ───────────────────────────────────────────────────────
  if (mode === 'confirmRetire') {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="place-confirm-retire">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">Retire {place.name}?</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 font-dm-sans text-[16px] leading-snug text-secondary-ink">
          <li>It leaves every picker — nothing new can be recorded here.</li>
          <li>It keeps naming every entry that already happened here.</li>
          <li>Nothing is deleted, and you can put it back any time.</li>
        </ul>
        {error && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="place-edit-error">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => send({ retired: true })} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50" data-audit="place-retire-confirm">
            {busy ? 'Retiring…' : 'Retire it'}
          </button>
          <button type="button" disabled={busy} onClick={() => { setError(null); setMode('idle') }} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2 disabled:opacity-50" data-audit="place-retire-cancel">
            Keep it
          </button>
        </div>
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

        {error && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold leading-snug" style={{ color: warning }} data-audit="place-edit-error">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => send({ name: name.trim(), kind, expected_updated_at: expected })}
            className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50"
            data-audit="place-edit-save"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" disabled={busy} onClick={() => { setName(place.name); setKind(place.kind); setError(null); setMode('idle') }} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2 disabled:opacity-50" data-audit="place-edit-cancel">
            Cancel
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button type="button" disabled={busy} onClick={() => { setError(null); setMode('confirmRetire') }} className="inline-flex min-h-[44px] items-center font-dm-sans text-[16px] font-semibold text-secondary-ink underline underline-offset-2 disabled:opacity-50" data-audit="place-retire-open">
            Retire this place
          </button>
          {/* 7D.3: one tap. Whether it deletes or answers with what points at
              it is the route's call, made against a real count — this screen
              does not pre-judge it, so the button never lies about what it
              will do by being absent or disabled on a guess. */}
          <button type="button" disabled={busy} onClick={() => { setError(null); setMode('confirmDelete') }} className="inline-flex min-h-[44px] items-center font-dm-sans text-[16px] font-semibold underline underline-offset-2 disabled:opacity-50" style={{ color: warning }} data-audit="place-delete-open">
            Delete this place
          </button>
        </div>
      </Card>
    )
  }

  return (
    <button
      type="button"
      onClick={() => { setName(place.name); setKind(place.kind); setError(null); setMode('editing') }}
      className="mt-3 inline-flex min-h-[44px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2"
      data-audit="place-edit-open"
    >
      Edit name or kind
    </button>
  )
}
