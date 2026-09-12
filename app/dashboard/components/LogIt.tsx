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
import { setRecordSheetOpen } from '@/lib/record-sheet-state'
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
// Block 6D: whether a launcher (Today's, with its own status strip under Record)
// is on the page — the global strip in RecordSheetHost stands down while it is.
let launchers = 0
const launcherListeners = new Set<() => void>()
function subscribeLaunchers(l: () => void) { launcherListeners.add(l); return () => { launcherListeners.delete(l) } }
export function useLauncherMounted(): boolean {
  return useSyncExternalStore(subscribeLaunchers, () => launchers > 0, () => false)
}
function useHasDraft(): boolean {
  return useSyncExternalStore(subscribeDraft, () => !!readDraft()?.type, () => false)
}

type Place = { id: string; name: string; kind: string }

// Block 6A: the tiles are verbs. Count is its own group — it never reads as adding stock.
const TILE_VERB: Record<ManualEventType, string> = {
  rain: 'Record rain',
  hay_fed: 'Feed hay',
  bales_stacked: 'Add bales to a stack',
  cattle_moved: 'Move cattle',
  cattle_worked: 'Record cattle work',
  hay_inventory: 'Count hay',
}
const SAVE_LABEL: Record<ManualEventType, string> = {
  rain: 'Record rain',
  hay_fed: 'Record feeding',
  bales_stacked: 'Add bales',
  cattle_moved: 'Record move',
  cattle_worked: 'Record work',
  hay_inventory: 'Record count',
}
const MOVEMENT_TYPES: readonly ManualEventType[] = ['hay_fed', 'rain', 'bales_stacked', 'cattle_moved', 'cattle_worked']
// 6G: the entries that can name a bunch. Feed always could; a move and cattle work now can, optionally.
const LOT_TYPES: readonly ManualEventType[] = ['hay_fed', 'cattle_moved', 'cattle_worked']
const TILE_HINT: Record<ManualEventType, string> = {
  rain: 'inches in the gauge',
  hay_fed: 'bales put out',
  bales_stacked: 'bales into the stack',
  cattle_moved: 'head, from → to',
  cattle_worked: 'head and what you did',
  hay_inventory: 'sets the ranch\u2019s bales on hand, as of a date',
}

// The day a form is recording, in the words a person would use. '' means now.
// Named days only go back one: past that a bare "Sep 8" is clearer than
// counting backwards, and the exact picker is one tap away either way.
function whenSentence(when: string): string {
  if (!when) return 'Now.'
  const d = new Date(when)
  if (Number.isNaN(d.getTime())) return 'Now.'
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((midnight(new Date()) - midnight(d)) / 86_400_000)
  if (days === 0) return `Today, ${day} · ${time}`
  if (days === 1) return `Yesterday, ${day} · ${time}`
  return `${day} · ${time}`
}

function yesterdayAtNow(): Date {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d
}

function isYesterday(when: string): boolean {
  if (!when) return false
  const d = new Date(when)
  if (Number.isNaN(d.getTime())) return false
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  return Math.round((midnight(new Date()) - midnight(d)) / 86_400_000) === 1
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
            className="min-h-[48px] shrink-0 px-2 font-dm-sans text-[16px] font-semibold text-ink hover:text-forest-green"
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

// A quantity with its UNIT beside it, always (2D): bales, inches, head are
// never bare numbers, and bale sizes are never silently equated. The number
// itself is the biggest thing on the sheet.
function NumberField({ label, unit, value, onChange, step = '1', max, placeholder = '—' }: {
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
  step?: string
  max?: number
  placeholder?: string
}) {
  return (
    <Field label={label}>
      <UnitInput
        unit={unit}
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

// Field wires id / invalid / aria into its ONE child, so the unit badge must
// live inside a control that forwards those props to the real <input> —
// wrapping in a bare div would leave the label pointing at nothing.
function UnitInput({ unit, id, invalid, className = '', ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { unit: string; invalid?: boolean }) {
  return (
    <div className="relative">
      <Input
        id={id}
        invalid={invalid}
        className={`min-h-[64px] pr-20 text-[32px] font-semibold tabular-nums ${className}`}
        {...rest}
      />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-4 flex items-center font-dm-sans text-[17px] font-medium text-ink">{unit}</span>
    </div>
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

// Block 6A: one sheet is mounted for the whole app (RecordSheetHost); any
// surface may render a launcher alone. `sheet` instances listen for openLogIt();
// `launcher` instances only ask.
export default function LogIt({ launcher = true, sheet = true }: { launcher?: boolean; sheet?: boolean } = {}) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<ManualEventType | null>(null)
  const [places, setPlaces] = useState<Place[]>([])
  // Herd lots for the hay_fed picker: null = not fetched yet (fetched once, the
  // first time Hay fed is picked — the other tiles never pay for it).
  const [lots, setLots] = useState<Lot[] | null>(null)
  const [lot, setLot] = useState('')            // hay_fed / cattle_moved / cattle_worked: herd lot id, '' = no lot
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Two guards a thumb can't beat: a synchronous in-flight ref (React's
  // disabled state lands a render later than a second tap in the same tick),
  // and ONE event id per sheet, minted the moment a type is picked — so even
  // two racing submits carry the same id and the server keeps one row.
  const submitting = useRef(false)
  // Block 6B: the control that opened the sheet gets focus back when it closes; Tab stays inside while it is open.
  const openerRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const eventId = useRef<string | null>(null)

  // Fields — strings until submit, like ActualsCard.
  const [n1, setN1] = useState('')          // inches | bales | count | head
  // Block 7.4 — what the ranch is at now, so Count hay can say what it will DO
  // before it does it. null = not fetched or no counted baseline; the sentence
  // shortens rather than inventing a previous number.
  const [onHandNow, setOnHandNow] = useState<number | null>(null)
  const [what, setWhat] = useState('')
  const [place, setPlace] = useState<PlaceSlot>(EMPTY_SLOT)
  const [fromPlace, setFromPlace] = useState<PlaceSlot>(EMPTY_SLOT)
  const [toPlace, setToPlace] = useState<PlaceSlot>(EMPTY_SLOT)
  const [when, setWhen] = useState('')      // '' = now
  const [editWhen, setEditWhen] = useState(false)
  const [asOf, setAsOf] = useState('')      // hay_inventory: 'YYYY-MM-DD', '' = today
  const [note, setNote] = useState('')      // hay_fed, behind More
  const [stock, setStock] = useState<PlaceSlot>(EMPTY_SLOT)   // hay_fed: the stack it came from, behind More
  const [more, setMore] = useState(false)
  const [lotsError, setLotsError] = useState(false)

  const hasDraft = useHasDraft()

  const close = useCallback(() => {
    eventId.current = null
    setOpen(false); setType(null); setError(null)
    setN1(''); setWhat(''); setPlace(EMPTY_SLOT); setFromPlace(EMPTY_SLOT); setToPlace(EMPTY_SLOT); setWhen(''); setEditWhen(false); setAsOf('')
    setLots(null); setLot(''); setLotsError(false); setNote(''); setStock(EMPTY_SLOT); setMore(false)
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
    if (!sheet) return
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<Draft>).detail
      if (d && d.type) { writeDraft(d); applyDraft(d, true) }
      else if (d && (d.place || d.fromPlace || d.toPlace)) { applyDraft(d, true) }   // Record here: the picker, with the place already chosen
      else { const saved = readDraft(); if (saved && saved.type) applyDraft(saved, true); else setOpen(true) }   // the picker, or the unfinished draft
    }
    window.addEventListener(LOGIT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(LOGIT_OPEN_EVENT, onOpen)
  }, [applyDraft, sheet])

  // The FAB and anything else that must get out of the way read this (Block 6A).
  useEffect(() => { if (sheet) setRecordSheetOpen(open); return () => { if (sheet) setRecordSheetOpen(false) } }, [open, sheet])

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
    if (!sheet) { openLogIt({ type: null }); return }   // a launcher alone asks the mounted sheet
    const d = readDraft()
    if (d && d.type) applyDraft(d, true); else setOpen(true)
  }

  // Lots load the first time Hay fed is picked (same promise-chain shape as the
  // places load; no setState in the effect body). The last lot fed only applies
  // if it still exists. A failed load leaves the picker at "No lot" — a log
  // never blocks on choosing one.
  useEffect(() => {
    if (!launcher) return
    launchers++; for (const l of launcherListeners) l()
    return () => { launchers--; for (const l of launcherListeners) l() }
  }, [launcher])

  useEffect(() => {
    if (!open || !type || !LOT_TYPES.includes(type) || lots !== null) return
    let cancelled = false
    fetch('/api/operation-profile')
      .then(r => (r.ok ? r.json() : null))
      .then((j: { profile?: { herd?: { lots?: Lot[] } } } | null) => {
        if (cancelled) return
        const list = Array.isArray(j?.profile?.herd?.lots) ? j!.profile!.herd!.lots! : []
        setLots(list)
        const last = readLastLot()
        // A draft's lot that the list no longer names is left UNASSIGNED, never
        // swapped for the last-used lot (6A: a slow option load rewrites nothing
        // the person chose). The last-used default applies only to an empty draft.
        setLot(prev => prev ? (list.some(l => l.id === prev) ? prev : '') : (list.some(l => l.id === last) ? last : ''))
      })
      .catch(() => { if (!cancelled) { setLots([]); setLotsError(true) } })   // a real error state, not a silent empty picker
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
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = dialogRef.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    first?.focus()
    const opener = openerRef.current
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && dialogRef.current) {
        const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(n => !n.hasAttribute('disabled'))
        if (nodes.length === 0) return
        const firstNode = nodes[0], lastNode = nodes[nodes.length - 1]
        if (e.shiftKey && document.activeElement === firstNode) { e.preventDefault(); lastNode.focus() }
        else if (!e.shiftKey && document.activeElement === lastNode) { e.preventDefault(); firstNode.focus() }
        return
      }
      if (e.key !== 'Escape') return
      if (!dirty || window.confirm('Discard what you typed?')) close()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); requestAnimationFrame(() => opener?.focus()) }
  }, [open, dirty, close])

  const addPlace = (p: Place) => setPlaces(prev => [...prev, p].sort((a, b) => a.name.localeCompare(b.name)))

  // Save = (create any pending places) then (log the event), one intent.
  // A pending slot with an empty name is a blank place — nothing typed,
  // nothing lost. A failed place write stops here: error shown, sheet open,
  // every field intact, the log NOT saved without its place. A slot that did
  // resolve is pinned to its new id so a retry never creates it twice.
  useEffect(() => {
    if (type !== 'hay_inventory') return
    let alive = true
    fetch('/api/ranch/hay-on-hand')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j && typeof j.bales === 'number') setOnHandNow(j.bales) })
      .catch(() => { /* a courtesy sentence, never a gate */ })
    return () => { alive = false }
  }, [type])

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
      // Block 7.4 — an empty field used to travel as NaN, become null in JSON,
      // and be rejected by the server AFTER the entry had already landed in the
      // outbox as 'failed'. Refuse it here, where the person can still fix it.
      if (!Number.isFinite(num)) { setError('Enter a number first.'); setBusy(false); return }
      const body: Record<string, unknown> = { type }
      if (when) body.ts = new Date(when).toISOString()
      switch (type) {
        case 'rain':          body.inches = num; body.place_id = placeId; break
        case 'hay_fed':       body.bales = num; body.herd_lot_id = lot || null; body.place_id = placeId; if (note.trim()) body.note = note.trim(); { const sid = await resolveSlot(stock, setStock); if (sid) body.stock_place_id = sid } break
        case 'bales_stacked': body.count = num; body.place_id = placeId; break
        case 'cattle_moved':
          body.head = num; body.from_place_id = fromId; body.to_place_id = toId; body.herd_lot_id = lot || null
          body.place_id = toId   // where they are now
          break
        case 'cattle_worked': body.head = num; body.what = what; body.place_id = placeId; body.herd_lot_id = lot || null; break
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
      if (LOT_TYPES.includes(type)) writeLastLot(lot)
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
    <NumberField label="Rain" unit="inches" value={n1} onChange={setN1} step="0.01" max={30} placeholder="0.00" />
    {placeField()}
  </>)
  if (type === 'hay_fed') fields = (<>
    <NumberField label="Hay fed" unit="bales" value={n1} onChange={setN1} max={10000} />
    {/* Which bunch (Block 6A): the field's space is reserved while lots load, Save waits
        for them, a failed load is said out loud, and "no lot" reads as what it is. A lot
        is never created from here. */}
    <Field label="Fed to" hint={lots && lots.length === 0 && !lotsError ? 'No lots on the ranch yet — add them under Ranch → Cattle.' : undefined} error={lotsError ? 'Couldn’t load your lots — record without one, or try again below.' : undefined}>
      {lots === null ? (
        <Select value="" disabled aria-busy="true" data-audit="lots-loading"><option value="">Loading lots…</option></Select>
      ) : (
        <Select value={lot} disabled={busy} onChange={e => setLot(e.target.value)} data-audit="fed-to">
          <option value="">Not assigned to a lot</option>
          {lots.map(l => <option key={l.id} value={l.id}>{lotLabel(l)}</option>)}
        </Select>
      )}
    </Field>
    {lotsError && (
      <button type="button" onClick={() => { setLots(null); setLotsError(false) }} className="-mt-2 self-start min-h-[44px] font-dm-sans text-[16px] font-semibold text-forest-green underline underline-offset-2" data-audit="lots-retry">Try loading lots again</button>
    )}
    {placeField()}
    {n1.trim() !== '' && Number.isFinite(Number(n1)) && (
      <p className="font-dm-sans text-[16px] leading-snug text-ink" data-audit="feed-preview">
        {Number(n1)} {Number(n1) === 1 ? 'bale' : 'bales'}{lots?.find(l => l.id === lot) ? ` to ${lotLabel(lots.find(l => l.id === lot)!)}` : ''}{place.newName !== null ? (place.newName.trim() ? ` at ${place.newName.trim()}` : '') : (places.find(p => p.id === place.id)?.name ? ` at ${places.find(p => p.id === place.id)!.name}` : '')}, {editWhen && when ? new Date(when).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : `today ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
      </p>
    )}
    <div>
      <button type="button" onClick={() => setMore(m => !m)} aria-expanded={more} className="min-h-[44px] font-dm-sans text-[16px] font-semibold text-forest-green underline underline-offset-2" data-audit="feed-more">{more ? 'Less' : 'More'}</button>
      {more && (
        <div className="mt-2 flex flex-col gap-4">
          <PlaceSelect label="Stock source (the stack it came from)" slot={stock} places={places} onChange={setStock} disabled={busy} />
          <Field label="Note">
            <Input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="anything worth remembering" />
          </Field>
        </div>
      )}
    </div>
  </>)
  if (type === 'bales_stacked') fields = (<>
    <NumberField label="Stacked" unit="bales" value={n1} onChange={setN1} max={10000} />
    {placeField('Stacked at')}
  </>)
  // 6G: which bunch — optional, with "Unassigned" plain. What a move DOES is said
  // on the field: it records the move; it never changes a lot's head count.
  const lotField = (label: string, hint: string, audit: string) => (
    <Field label={label} hint={lotsError ? undefined : lots && lots.length === 0 ? 'No lots on the ranch yet — add them under Ranch → Cattle.' : hint} error={lotsError ? 'Couldn’t load your lots — record without one, or try again below.' : undefined}>
      {lots === null ? (
        <Select value="" disabled aria-busy="true" data-audit="lots-loading"><option value="">Loading lots…</option></Select>
      ) : (
        <Select value={lot} disabled={busy} onChange={e => setLot(e.target.value)} data-audit={audit}>
          <option value="">Unassigned</option>
          {lots.map(l => <option key={l.id} value={l.id}>{lotLabel(l)}</option>)}
        </Select>
      )}
    </Field>
  )
  if (type === 'cattle_moved') fields = (<>
    <NumberField label="Moved" unit="head" value={n1} onChange={setN1} max={20000} />
    {lotField('Lot', 'Records the move against this bunch. A move never changes a lot’s head count — edit the lot under Ranch → Cattle for that.', 'lot-for-move')}
    <PlaceSelect label="From" slot={fromPlace} places={places} onChange={setFromPlace} disabled={busy} />
    <PlaceSelect label="To" slot={toPlace} places={places} onChange={setToPlace} disabled={busy} />
  </>)
  if (type === 'hay_inventory') fields = (<>
    <NumberField label="On hand" unit="bales" value={n1} onChange={setN1} max={100000} placeholder="0" />
    <p className="font-dm-sans text-[16px] text-ink" data-audit="count-scope">Count for: <span className="font-semibold">{place.newName !== null ? (place.newName.trim() || 'Entire ranch') : (places.find(p => p.id === place.id)?.name ?? 'Entire ranch')}</span></p>
    <Field label="Counted on" hint="The day you counted — the effective date. When you record it is kept separately.">
      <Input type="date" value={asOf || todayKey()} max={todayKey()} onChange={e => setAsOf(e.target.value)} />
    </Field>
    {/* Block 7.4 — say what saving DOES, before it is saved. A count is not an
        entry in a running tally; it REPLACES the ranch's on-hand figure and
        every later bale is measured from it. */}
    {n1.trim() !== '' && Number.isFinite(Number(n1)) && (
      <p className="font-dm-sans text-[16px] leading-snug text-ink" data-audit="count-effect">
        This sets ranch hay on hand to <span className="font-semibold">{Number(n1).toLocaleString()} {Number(n1) === 1 ? 'bale' : 'bales'}</span>
        {onHandNow != null && <> (was {onHandNow.toLocaleString()})</>}.
      </p>
    )}
  </>)
  if (type === 'cattle_worked') fields = (<>
    <NumberField label="Worked" unit="head" value={n1} onChange={setN1} max={20000} />
    <Field label="What">
      <Input value={what} onChange={e => setWhat(e.target.value)} maxLength={80} placeholder="pregged, vaccinated, weaned…" />
    </Field>
    {lotField('Lot', 'Records the work against this bunch — it shows as the lot’s last recorded work.', 'lot-for-work')}
    {placeField()}
  </>)

  return (
    <>
      {launcher && (
      <div className="space-y-3">
        <button
          type="button"
          onClick={openSheet}
          className="min-h-[56px] w-full rounded-lg bg-forest-green px-4 py-3 text-center font-dm-sans text-[17px] font-semibold text-white transition-colors hover:bg-forest-green/90"
        >
          {hasDraft && !open ? 'Record work · finish your unsaved entry' : 'Record work'}
        </button>
        <SaveStatus />
      </div>
      )}

      {sheet && open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center"
          onClick={dismiss}
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Record work"
        >
          <Card
            shadow="soft"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-b-none px-5 py-5 sm:rounded-b-xl"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <Heading level={3} visual={5}>{type ? TILE_VERB[type] : 'Record work'}</Heading>
              <button
                type="button"
                onClick={type ? () => { eventId.current = null; setType(null); setError(null) } : close}
                className="min-h-[48px] px-2 font-dm-sans text-[16px] font-semibold text-ink hover:text-forest-green"
              >
                {type ? 'Back' : 'Close'}
              </button>
            </div>

            {!type ? (
              <div className="mt-4" data-audit="record-picker">
                <div className="grid grid-cols-2 gap-3">
                  {MOVEMENT_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setType(t)} className="min-h-[84px] rounded-lg border border-forest-green/15 bg-white px-4 py-3 text-left transition-colors hover:bg-forest-green/5" data-audit={`tile-${t}`}>
                      <span className="block font-dm-sans text-[17px] font-semibold text-forest-green">{TILE_VERB[t]}</span>
                      <span className="mt-1 block font-dm-sans text-[16px] text-ink">{TILE_HINT[t]}</span>
                    </button>
                  ))}
                </div>
                {/* Count stands apart: it states what is there; it never adds or takes stock. */}
                <p className="mt-4 font-dm-sans text-[14px] font-medium uppercase tracking-wide text-secondary-ink">Count · not a stock movement</p>
                <button type="button" onClick={() => setType('hay_inventory')} className="mt-2 min-h-[72px] w-full rounded-lg border border-dashed border-forest-green/30 bg-white px-4 py-3 text-left transition-colors hover:bg-forest-green/5" data-audit="tile-hay_inventory">
                  <span className="block font-dm-sans text-[17px] font-semibold text-forest-green">{TILE_VERB.hay_inventory}</span>
                  <span className="mt-1 block font-dm-sans text-[16px] text-ink">{TILE_HINT.hay_inventory}</span>
                </button>
              </div>
            ) : (
              <form
                className="mt-4 flex flex-col gap-4"
                onSubmit={e => { e.preventDefault(); submit() }}
              >
                {fields}

                {/* ── WHEN, INLINE, ABOVE SAVE (Block 7.5) ──────────────────
                    Every form says which day it is recording, in a sentence,
                    right where the thumb already is. It used to be one word —
                    "Now ·" — with the day only ever visible after tapping
                    "change time", so a backdate you had set two fields ago was
                    invisible at the moment you committed it.

                    Today and Yesterday are chips because those are the two
                    answers a rancher actually gives; anything else opens the
                    exact picker, which is unchanged. No expander is added and
                    no form grows a field: this is one line plus two chips, and
                    it collapses back to "Now." the moment Today is tapped. */}
                <div className="flex flex-col gap-2">
                  <p className="font-dm-sans text-[16px] text-ink" data-audit="when-sentence">
                    <span className="font-semibold">{whenSentence(editWhen ? when : '')}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => { setWhen(''); setEditWhen(false) }} aria-pressed={!editWhen}
                      className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${!editWhen ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`}
                      data-audit="when-today">Today</button>
                    <button type="button" onClick={() => { setWhen(toLocalInput(yesterdayAtNow())); setEditWhen(true) }} aria-pressed={editWhen && isYesterday(when)}
                      className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${editWhen && isYesterday(when) ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`}
                      data-audit="when-yesterday">Yesterday</button>
                    <button type="button" onClick={() => { if (!editWhen) setWhen(toLocalInput(new Date())); setEditWhen(v => !v) }}
                      className="min-h-[48px] font-dm-sans text-[16px] font-semibold text-forest-green underline underline-offset-2"
                      data-audit="when-exact">{editWhen ? 'Hide exact time' : 'Exact time'}</button>
                  </div>
                  {editWhen && (
                    <Field label="When">
                      <Input
                        type="datetime-local"
                        value={when || toLocalInput(new Date())}
                        max={toLocalInput(new Date())}
                        onChange={e => setWhen(e.target.value)}
                      />
                    </Field>
                  )}
                </div>

                {error && (
                  <p className="font-dm-sans text-[16px] font-medium text-warning" role="alert">{error}</p>
                )}

                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={busy || (LOT_TYPES.includes(type) && lots === null)} className="flex-1 min-h-[56px] text-[17px]" data-audit="record-save">
                    {busy ? 'Saving…' : LOT_TYPES.includes(type) && lots === null ? 'Loading lots…' : SAVE_LABEL[type]}
                  </Button>
                  <button
                    type="button"
                    onClick={() => { if (!dirty || window.confirm('Discard what you typed?')) close() }}
                    disabled={busy}
                    className="min-h-[48px] px-3 font-dm-sans text-[16px] font-semibold text-secondary-ink hover:text-forest-green disabled:opacity-50"
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
