'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { todayKey } from '@/lib/jobs/format'
import { Field, Input, Select } from '@/app/components/ui/Field'
import { Button } from '@/app/components/ui/Button'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import { MANUAL_EVENT_LABELS, MANUAL_EVENT_TYPES, type ManualEventType } from '@/lib/manual-log'
import { lotLabel, type Lot } from '@/lib/herd'
import { enqueue, newEventId } from '@/lib/outbox'
import SaveStatus from './SaveStatus'

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
// The last lot fed — its OWN key, never the place key: a place and a lot are
// two different answers and one must never overwrite the other.
const LAST_LOT_KEY = 'manual_log_last_lot'
// A half-filled sheet survives an app switch (Block 2A): every keystroke is
// mirrored here and the sheet reopens on it. Cleared on save or an explicit
// Cancel/discard — never by an accident.
const DRAFT_KEY = 'manual_log_draft_v1'

// Other surfaces (Repeat last, a place page) open the sheet pre-filled by
// dispatching this event with a Draft — no prop plumbing across the server
// boundary. `open: true` opens the sheet; without it the draft just waits.
export const LOGIT_OPEN_EVENT = 'dryline:logit-open'
export interface Draft {
  type: ManualEventType | null
  n1?: string
  what?: string
  place?: string        // existing place id
  fromPlace?: string
  toPlace?: string
  lot?: string
  when?: string
  asOf?: string
}
export function openLogIt(draft: Draft) {
  try { window.dispatchEvent(new CustomEvent(LOGIT_OPEN_EVENT, { detail: draft })) } catch { /* SSR */ }
}
function readDraft(): Draft | null {
  try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? (JSON.parse(raw) as Draft) : null } catch { return null }
}
// A tiny external store so "is there a draft?" is read through
// useSyncExternalStore (server: false; client: the truth) — no setState in an
// effect, no hydration mismatch.
const draftListeners = new Set<() => void>()
function writeDraft(d: Draft | null) {
  try { if (d && d.type) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY) } catch { /* private mode */ }
  for (const l of draftListeners) l()
}
function subscribeDraft(l: () => void) { draftListeners.add(l); return () => { draftListeners.delete(l) } }
function useHasDraft(): boolean {
  return useSyncExternalStore(subscribeDraft, () => !!readDraft()?.type, () => false)
}

type Place = { id: string; name: string; kind: string }

const TILE_HINT: Record<ManualEventType, string> = {
  rain: 'inches in the gauge',
  hay_fed: 'bales put out',
  bales_stacked: 'bales into the stack',
  cattle_moved: 'head, from → to',
  cattle_worked: 'head and what you did',
  hay_inventory: 'a count of the stack, as of a date',
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
function readLastLot(): string {
  try { return localStorage.getItem(LAST_LOT_KEY) ?? '' } catch { return '' }
}
function writeLastLot(id: string) {
  try { if (id) localStorage.setItem(LAST_LOT_KEY, id); else localStorage.removeItem(LAST_LOT_KEY) } catch { /* private mode */ }
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

// One plain line for the status strip and the outbox: what was saved.
function describe(
  type: ManualEventType, n: number, what: string,
  lot: string | null, place: string | null, from: string | null, to: string | null,
): string {
  const at = place ? ` at ${place}` : ''
  const bales = (k: number) => `${k} ${k === 1 ? 'bale' : 'bales'}`
  switch (type) {
    case 'rain':          return `${Number.isFinite(n) ? n.toFixed(2) : '?'}" of rain${at}`
    case 'hay_fed':       return `Fed ${bales(n)}${lot ? ` to ${lot}` : ''}${at}`
    case 'bales_stacked': return `Stacked ${bales(n)}${at}`
    case 'cattle_moved':  return `Moved ${n} head${from && to ? ` ${from} → ${to}` : to ? ` to ${to}` : from ? ` from ${from}` : ''}`
    case 'cattle_worked': return `${what ? what[0].toUpperCase() + what.slice(1) : 'Worked'} ${n} head${at}`
    case 'hay_inventory': return `${bales(n)} on hand${at}`
  }
}

export default function LogIt() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<ManualEventType | null>(null)
  const [places, setPlaces] = useState<Place[]>([])
  // Herd lots for the hay_fed picker: null = not fetched yet (fetched once, the
  // first time Hay fed is picked — the other tiles never pay for it).
  const [lots, setLots] = useState<Lot[] | null>(null)
  const [lot, setLot] = useState('')            // hay_fed: herd lot id, '' = no lot
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Two guards a thumb can't beat: a synchronous in-flight ref (React's
  // disabled state lands a render later than a second tap in the same tick),
  // and ONE event id per sheet, minted the moment a type is picked — so even
  // two racing submits carry the same id and the server keeps one row.
  const submitting = useRef(false)
  const eventId = useRef<string | null>(null)

  // Fields — strings until submit, like ActualsCard.
  const [n1, setN1] = useState('')          // inches | bales | count | head
  const [what, setWhat] = useState('')
  const [place, setPlace] = useState<PlaceSlot>(EMPTY_SLOT)
  const [fromPlace, setFromPlace] = useState<PlaceSlot>(EMPTY_SLOT)
  const [toPlace, setToPlace] = useState<PlaceSlot>(EMPTY_SLOT)
  const [when, setWhen] = useState('')      // '' = now
  const [editWhen, setEditWhen] = useState(false)
  const [asOf, setAsOf] = useState('')      // hay_inventory: 'YYYY-MM-DD', '' = today

  const hasDraft = useHasDraft()

  const close = useCallback(() => {
    eventId.current = null
    setOpen(false); setType(null); setError(null)
    setN1(''); setWhat(''); setPlace(EMPTY_SLOT); setFromPlace(EMPTY_SLOT); setToPlace(EMPTY_SLOT); setWhen(''); setEditWhen(false); setAsOf('')
    setLots(null); setLot('')
    writeDraft(null)
  }, [])

  // Apply a Draft to the fields (restore after an app switch, or a pre-fill
  // from Repeat last / a place page).
  const applyDraft = useCallback((d: Draft, andOpen: boolean) => {
    setType(d.type)
    setN1(d.n1 ?? ''); setWhat(d.what ?? '')
    setPlace(d.place ? { id: d.place, newName: null } : EMPTY_SLOT)
    setFromPlace(d.fromPlace ? { id: d.fromPlace, newName: null } : EMPTY_SLOT)
    setToPlace(d.toPlace ? { id: d.toPlace, newName: null } : EMPTY_SLOT)
    setLot(d.lot ?? ''); setWhen(d.when ?? ''); setEditWhen(!!d.when); setAsOf(d.asOf ?? '')
    setError(null)
    if (andOpen) setOpen(true)
  }, [])

  // Another surface asked for the sheet, pre-filled.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<Draft>).detail
      if (d && d.type) { writeDraft(d); applyDraft(d, true) }
    }
    window.addEventListener(LOGIT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(LOGIT_OPEN_EVENT, onOpen)
  }, [applyDraft])

  // Mirror every change into the draft while a type is chosen.
  useEffect(() => {
    if (!open || !type) return
    writeDraft({
      type, n1, what,
      place: place.newName === null ? place.id : undefined,
      fromPlace: fromPlace.newName === null ? fromPlace.id : undefined,
      toPlace: toPlace.newName === null ? toPlace.id : undefined,
      lot, when: editWhen ? when : undefined, asOf,
    })
  }, [open, type, n1, what, place, fromPlace, toPlace, lot, when, editWhen, asOf])

  const openSheet = () => {
    const d = readDraft()
    if (d && d.type) applyDraft(d, true); else setOpen(true)
  }

  // Lots load the first time Hay fed is picked (same promise-chain shape as the
  // places load; no setState in the effect body). The last lot fed only applies
  // if it still exists. A failed load leaves the picker at "No lot" — a log
  // never blocks on choosing one.
  useEffect(() => {
    if (!open || type !== 'hay_fed' || lots !== null) return
    let cancelled = false
    fetch('/api/operation-profile')
      .then(r => (r.ok ? r.json() : null))
      .then((j: { profile?: { herd?: { lots?: Lot[] } } } | null) => {
        if (cancelled) return
        const list = Array.isArray(j?.profile?.herd?.lots) ? j!.profile!.herd!.lots! : []
        setLots(list)
        const last = readLastLot()
        setLot(prev => prev && list.some(l => l.id === prev) ? prev : (list.some(l => l.id === last) ? last : ''))
      })
      .catch(() => { if (!cancelled) setLots([]) })
    return () => { cancelled = true }
  }, [open, type, lots])

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
        setPlace(prev => prev.id || prev.newName !== null ? prev : (list.some(p => p.id === last) ? { id: last, newName: null } : EMPTY_SLOT))
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
    asOf !== '' ||
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
    if (submitting.current) return
    submitting.current = true
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
        case 'hay_fed':       body.bales = num; body.herd_lot_id = lot || null; body.place_id = placeId; break
        case 'bales_stacked': body.count = num; body.place_id = placeId; break
        case 'cattle_moved':
          body.head = num; body.from_place_id = fromId; body.to_place_id = toId
          body.place_id = toId   // where they are now
          break
        case 'cattle_worked': body.head = num; body.what = what; body.place_id = placeId; break
        case 'hay_inventory': body.bales = num; body.as_of = asOf || todayKey(); body.place_id = placeId; break
      }
      if (!Number.isFinite(num) && type !== 'rain') { setError('Enter a number'); return }

      // Block 2A: the entry is saved ON THIS PHONE first, under an id minted
      // here and now; the outbox uploads it (and retries with the same id).
      // A refused local write is the one failure that means "not saved".
      const placeName = (id: string | null) => places.find(p => p.id === id)?.name ?? null
      const lotName = lots?.find(l => l.id === lot)
      body.id = eventId.current ?? (eventId.current = newEventId())
      const label = describe(type, num, what, lotName ? lotLabel(lotName) : null, placeName(placeId), placeName(fromId), placeName(toId))
      try {
        enqueue(body, label)
      } catch {
        setError("Couldn't save — try again. This phone refused to store the entry.")
        return
      }
      writeLastPlace((type === 'cattle_moved' ? toId : placeId) ?? '')
      if (type === 'hay_fed') writeLastLot(lot)
      close()
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : ''
      // Creating a NEW place needs the server; an existing place saves offline.
      setError(msg && !/fetch|network|load failed/i.test(msg) ? msg : 'No connection — a new place needs one. Pick an existing place, or try again.')
    } finally {
      submitting.current = false
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
    {/* Which bunch — optional; labeled the way the herd page labels them
        (lotLabel: the name if given, else the class). Hidden until the herd
        has lots: an empty herd gets no empty picker. */}
    {lots && lots.length > 0 && (
      <Field label="Fed to">
        <Select value={lot} disabled={busy} onChange={e => setLot(e.target.value)}>
          <option value="">No lot</option>
          {lots.map(l => <option key={l.id} value={l.id}>{lotLabel(l)}</option>)}
        </Select>
      </Field>
    )}
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
  if (type === 'hay_inventory') fields = (<>
    <NumberField label="Bales on hand" value={n1} onChange={setN1} max={100000} placeholder="0" />
    <Field label="As of" hint="The day you counted.">
      <Input type="date" value={asOf || todayKey()} max={todayKey()} onChange={e => setAsOf(e.target.value)} />
    </Field>
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
      <div className="space-y-3">
        <button
          type="button"
          onClick={openSheet}
          className="min-h-[56px] w-full rounded-lg bg-forest-green px-4 py-3 text-center font-dm-sans text-[17px] font-semibold text-white shadow-sm shadow-forest-green/20 transition-colors hover:bg-forest-green/90"
        >
          {hasDraft && !open ? 'Log it · finish your unsaved entry' : 'Log it'}
        </button>
        <SaveStatus />
      </div>

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
                onClick={type ? () => { eventId.current = null; setType(null); setError(null) } : close}
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
                    onClick={() => { if (!dirty || window.confirm('Discard what you typed?')) close() }}
                    disabled={busy}
                    className="min-h-[48px] px-3 font-dm-sans text-[15px] font-semibold text-forest-green/70 hover:text-forest-green disabled:opacity-50"
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
