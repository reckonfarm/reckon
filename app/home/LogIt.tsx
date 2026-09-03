'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Field, Input, Select } from '@/app/components/ui/Field'
import { Button } from '@/app/components/ui/Button'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import { MANUAL_EVENT_LABELS, MANUAL_EVENT_TYPES, type ManualEventType } from '@/lib/manual-log'

// "Log it" — the operator writes a line in the ledger by hand. Five tiles,
// each at most three visible fields, time defaults to now (change it behind a
// tap), place defaults to the last one used (localStorage, same practice as
// the farmer-type toggle). Follows the ActualsCard write pattern: useState
// per field, fetch, busy flag, router.refresh(). The sheet is a fixed
// inset-0 overlay in the MapLightbox spirit — Esc or the backdrop closes it.
//
// A blank place is a valid answer everywhere. "New place…" reveals a name
// input and nothing else — the ONE Save button creates the place (name-only,
// /api/places) and then logs the event, in that order, in one submit. If the
// place write fails the sheet stays open with everything typed intact; the
// log is never saved without the place the operator asked for.

const LAST_PLACE_KEY = 'manual_log_last_place'

type Place = { id: string; name: string; kind: string }

const TILE_HINT: Record<ManualEventType, string> = {
  rain: 'inches in the gauge',
  hay_fed: 'bales put out',
  bales_stacked: 'bales into the stack',
  cattle_moved: 'head, from → to',
  cattle_worked: 'head and what you did',
}

// datetime-local wants local wall time without zone; the API wants ISO.
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function readLastPlace(): string {
  try { return localStorage.getItem(LAST_PLACE_KEY) ?? '' } catch { return '' }
}
function writeLastPlace(id: string) {
  try { if (id) localStorage.setItem(LAST_PLACE_KEY, id); else localStorage.removeItem(LAST_PLACE_KEY) } catch { /* private mode */ }
}

// One place slot: a chosen id, or a pending name the operator typed after
// picking "New place…". Resolution (POST /api/places) happens in the outer
// submit, never here — no second button, no way to Save past a typed name.
type PlaceSlot = { id: string; newName: string | null }
const EMPTY_SLOT: PlaceSlot = { id: '', newName: null }

function PlaceSelect({ label, slot, places, onChange, disabled }: {
  label: string
  slot: PlaceSlot
  places: Place[]
  onChange: (s: PlaceSlot) => void
  disabled?: boolean
}) {
  if (slot.newName !== null) {
    return (
      <Field label={`${label} — new place`} hint="A name is enough. Save adds it with the entry.">
        <div className="flex gap-2">
          <Input
            autoFocus
            value={slot.newName}
            onChange={e => onChange({ id: '', newName: e.target.value })}
            maxLength={60}
            placeholder="North 40"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() => onChange(EMPTY_SLOT)}
            disabled={disabled}
            className="shrink-0 px-1 font-dm-sans text-xs font-semibold text-forest-green/50 hover:text-forest-green"
          >
            Pick existing
          </button>
        </div>
      </Field>
    )
  }

  return (
    <Field label={label}>
      <Select
        value={slot.id}
        disabled={disabled}
        onChange={e => {
          if (e.target.value === '__new__') { onChange({ id: '', newName: '' }); return }
          onChange({ id: e.target.value, newName: null })
        }}
      >
        <option value="">No place</option>
        {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value="__new__">New place…</option>
      </Select>
    </Field>
  )
}

function NumberField({ label, value, onChange, step = '1', max, placeholder = '—' }: {
  label: string
  value: string
  onChange: (v: string) => void
  step?: string
  max?: number
  placeholder?: string
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        inputMode={step === '1' ? 'numeric' : 'decimal'}
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </Field>
  )
}

export default function LogIt() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<ManualEventType | null>(null)
  const [places, setPlaces] = useState<Place[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fields — strings until submit, like ActualsCard.
  const [n1, setN1] = useState('')          // inches | bales | count | head
  const [what, setWhat] = useState('')
  const [place, setPlace] = useState<PlaceSlot>(EMPTY_SLOT)
  const [fromPlace, setFromPlace] = useState<PlaceSlot>(EMPTY_SLOT)
  const [toPlace, setToPlace] = useState<PlaceSlot>(EMPTY_SLOT)
  const [when, setWhen] = useState('')      // '' = now
  const [editWhen, setEditWhen] = useState(false)

  const close = useCallback(() => {
    setOpen(false); setType(null); setError(null)
    setN1(''); setWhat(''); setPlace(EMPTY_SLOT); setFromPlace(EMPTY_SLOT); setToPlace(EMPTY_SLOT); setWhen(''); setEditWhen(false)
  }, [])

  // Load places on open; the last-used place only applies if it still exists.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/places')
      .then(r => (r.ok ? r.json() : { places: [] }))
      .then(j => {
        if (cancelled) return
        const list: Place[] = j.places ?? []
        setPlaces(list)
        const last = readLastPlace()
        setPlace(list.some(p => p.id === last) ? { id: last, newName: null } : EMPTY_SLOT)
      })
      .catch(() => { /* offline: select still offers blank + new */ })
    return () => { cancelled = true }
  }, [open])

  // Typed input is never dropped by an accident: once anything has been typed
  // (a number, a "what", a new place name, or a changed time) a backdrop tap
  // does nothing and Escape asks before discarding; Cancel stays the explicit
  // way out. Picking an existing place from the list is a choice, not typing —
  // an otherwise untouched sheet still closes freely. No dialog on the
  // backdrop: on a phone that's the accidental path, and a prompt there is
  // one more tap in the way.
  const dirty =
    n1.trim() !== '' ||
    what.trim() !== '' ||
    editWhen ||
    [place, fromPlace, toPlace].some(s => s.newName !== null && s.newName.trim() !== '')
  const dismiss = dirty ? undefined : close

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!dirty || window.confirm('Discard what you typed?')) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dirty, close])

  const addPlace = (p: Place) => setPlaces(prev => [...prev, p].sort((a, b) => a.name.localeCompare(b.name)))

  // Save = (create any pending places) then (log the event), one intent.
  // A pending slot with an empty name is a blank place — nothing typed,
  // nothing lost. A failed place write stops here: error shown, sheet open,
  // every field intact, the log NOT saved without its place. A slot that did
  // resolve is pinned to its new id so a retry never creates it twice.
  const resolveSlot = async (slot: PlaceSlot, set: (s: PlaceSlot) => void): Promise<string | null> => {
    if (slot.newName === null) return slot.id || null
    const name = slot.newName.trim()
    if (!name) return null
    const res = await fetch('/api/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? `Could not save the place "${name}"`)
    const created: Place = json.place
    addPlace(created)
    set({ id: created.id, newName: null })
    return created.id
  }

  const submit = async () => {
    if (!type) return
    setBusy(true); setError(null)
    try {
      const placeId = type === 'cattle_moved' ? null : await resolveSlot(place, setPlace)
      const fromId = type === 'cattle_moved' ? await resolveSlot(fromPlace, setFromPlace) : null
      const toId = type === 'cattle_moved' ? await resolveSlot(toPlace, setToPlace) : null

      const num = n1.trim() === '' ? NaN : Number(n1)
      const body: Record<string, unknown> = { type }
      if (when) body.ts = new Date(when).toISOString()
      switch (type) {
        case 'rain':          body.inches = num; body.place_id = placeId; break
        case 'hay_fed':       body.bales = num; body.herd_lot_id = null; body.place_id = placeId; break
        case 'bales_stacked': body.count = num; body.place_id = placeId; break
        case 'cattle_moved':
          body.head = num; body.from_place_id = fromId; body.to_place_id = toId
          body.place_id = toId   // where they are now
          break
        case 'cattle_worked': body.head = num; body.what = what; body.place_id = placeId; break
      }
      const res = await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Could not save'); return }
      writeLastPlace((type === 'cattle_moved' ? toId : placeId) ?? '')
      close()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'No connection — try again')
    } finally {
      setBusy(false)
    }
  }

  const placeField = (label = 'Where') => (
    <PlaceSelect label={label} slot={place} places={places} onChange={setPlace} disabled={busy} />
  )

  let fields: ReactNode = null
  if (type === 'rain') fields = (<>
    <NumberField label="Inches" value={n1} onChange={setN1} step="0.01" max={30} placeholder="0.00" />
    {placeField()}
  </>)
  if (type === 'hay_fed') fields = (<>
    <NumberField label="Bales" value={n1} onChange={setN1} max={10000} />
    {placeField()}
  </>)
  if (type === 'bales_stacked') fields = (<>
    <NumberField label="Bales" value={n1} onChange={setN1} max={10000} />
    {placeField('Stacked at')}
  </>)
  if (type === 'cattle_moved') fields = (<>
    <NumberField label="Head" value={n1} onChange={setN1} max={20000} />
    <PlaceSelect label="From" slot={fromPlace} places={places} onChange={setFromPlace} disabled={busy} />
    <PlaceSelect label="To" slot={toPlace} places={places} onChange={setToPlace} disabled={busy} />
  </>)
  if (type === 'cattle_worked') fields = (<>
    <NumberField label="Head" value={n1} onChange={setN1} max={20000} />
    <Field label="What">
      <Input value={what} onChange={e => setWhat(e.target.value)} maxLength={80} placeholder="pregged, vaccinated, weaned…" />
    </Field>
    {placeField()}
  </>)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg bg-forest-green px-4 py-3 text-center font-dm-sans text-sm font-semibold text-white transition-colors hover:bg-forest-green/90"
      >
        Log it
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center"
          onClick={dismiss}
          role="dialog"
          aria-modal="true"
          aria-label="Log it"
        >
          <Card
            shadow="soft"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-b-none px-5 py-5 sm:rounded-b-xl"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <Heading level={5}>{type ? MANUAL_EVENT_LABELS[type] : 'Log it'}</Heading>
              <button
                type="button"
                onClick={type ? () => { setType(null); setError(null) } : close}
                className="px-1 font-dm-sans text-xs font-semibold text-forest-green/50 hover:text-forest-green"
              >
                {type ? 'Back' : 'Close'}
              </button>
            </div>

            {!type ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {MANUAL_EVENT_TYPES.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className="min-h-[72px] rounded-lg border border-forest-green/15 bg-white px-3 py-3 text-left transition-colors hover:bg-forest-green/5"
                  >
                    <span className="block font-dm-sans text-base font-semibold text-forest-green">{MANUAL_EVENT_LABELS[t]}</span>
                    <span className="mt-0.5 block font-dm-sans text-xs text-forest-green/55">{TILE_HINT[t]}</span>
                  </button>
                ))}
              </div>
            ) : (
              <form
                className="mt-4 flex flex-col gap-4"
                onSubmit={e => { e.preventDefault(); submit() }}
              >
                {fields}

                {/* Time: now by default, one tap to change — never a fourth field. */}
                {editWhen ? (
                  <Field label="When">
                    <Input
                      type="datetime-local"
                      value={when || toLocalInput(new Date())}
                      max={toLocalInput(new Date())}
                      onChange={e => setWhen(e.target.value)}
                    />
                  </Field>
                ) : (
                  <p className="font-dm-sans text-xs text-forest-green/60">
                    Now ·{' '}
                    <button
                      type="button"
                      onClick={() => { setWhen(toLocalInput(new Date())); setEditWhen(true) }}
                      className="font-semibold text-forest-green/70 underline-offset-2 hover:text-forest-green hover:underline"
                    >
                      change time
                    </button>
                  </p>
                )}

                {error && (
                  <p className="font-dm-sans text-sm font-medium text-warning" role="alert">{error}</p>
                )}

                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={busy} className="flex-1 min-h-[44px]">
                    {busy ? 'Saving…' : 'Save'}
                  </Button>
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="px-2 font-dm-sans text-xs font-semibold text-forest-green/50 hover:text-forest-green disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}
    </>
  )
}
