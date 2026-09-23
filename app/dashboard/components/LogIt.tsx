'use client'

import RecordPicker from './RecordPicker'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { todayKey } from '@/lib/jobs/format'
import Counter from '@/app/components/ui/Counter'
import BottomSheet from '@/app/components/BottomSheet'
import { Field, Input, Select } from '@/app/components/ui/Field'
import { Button } from '@/app/components/ui/Button'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import { MANUAL_EVENT_LABELS, MANUAL_EVENT_TYPES, type ManualEventType, isManualEventType } from '@/lib/manual-log'
import { moveLine, movedWho, MOVE_NEEDS_BUNCH, type MovedBunch } from '@/lib/move-line'
import { lotLabel, LOT_CLASSES, LOT_CLASS_LABELS, type Lot, type LotClass, bunchLabel, bunchDetail } from '@/lib/herd'
import { splitBody, splitGroup, splitLabel, splitRefusal, defaultSplitClass, defaultSplitName } from '@/lib/cattle/split'
import { discard } from '@/lib/outbox'
import { warning } from '@/lib/brand-colors'
import { todayKey as ranchToday } from '@/lib/jobs/format'
import NewBunchInline from '@/app/ranch/cattle/NewBunchInline'
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
// Block 14: the bunch list, kept on the phone. A count or a feeding with no
// signal still has to offer the bunches — the last list this phone saw is
// the honest offer (offline-first, like the operation profile). Written on
// every good fetch, read only when the fetch fails.
const LOTS_CACHE_KEY = 'dryline_bunches_v1'
function readLotsCache(): Lot[] | null {
  try { const raw = localStorage.getItem(LOTS_CACHE_KEY); const v = raw ? JSON.parse(raw) as unknown : null; return Array.isArray(v) ? v as Lot[] : null } catch { return null }
}
function writeLotsCache(lots: Lot[]) { try { localStorage.setItem(LOTS_CACHE_KEY, JSON.stringify(lots)) } catch { /* private mode */ } }
// A half-filled sheet survives an app switch (Block 2A): every keystroke is
// mirrored here and the sheet reopens on it. Cleared on save or an explicit
// Cancel/discard — never by an accident.
const DRAFT_KEY = 'manual_log_draft_v1'

// Other surfaces (Repeat last, a place page) open the sheet pre-filled by
// dispatching this event with a Draft — no prop plumbing across the server
// boundary. `open: true` opens the sheet; without it the draft just waits.
export const LOGIT_OPEN_EVENT = 'dryline:logit-open'
// Block 15: the sheet records every manual entry AND the preg check — the
// chute is a sheet now, not a page, so it opens with no signal.
export type SheetType = ManualEventType | 'preg_check' | 'split'
export interface Draft {
  type: SheetType | null
  n1?: string
  what?: string
  place?: string        // existing place id
  fromPlace?: string
  toPlace?: string
  lot?: string
  when?: string
  asOf?: string
  // Block 15: the preg check's numbers and its split.
  checked?: string
  open?: string
  split?: boolean
  splitName?: string
  splitClass?: string
  // Block 19: how many head leave, on a split of its own.
  leaving?: string
  // Block 15 (ruling 2): a refused record being FIXED — the sheet re-saves
  // under this same outbox id, replacing the refused item in place.
  outboxId?: string
}

// Block 15 (ruling 2): a Draft from a refused record's own body, so Fix opens
// the sheet with the numbers already in it. Anything the sheet cannot show
// (a place capture, say) comes back null and the waiting list says so.
export function draftFromBody(body: Record<string, unknown>, outboxId: string): Draft | null {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined)
  const when = typeof body.ts === 'string' ? toLocalInput(new Date(body.ts)) : undefined
  // Block 19: a refused SPLIT opens with its numbers and its name still in it
  // — a refusal may not cost a person the typing (ruling 3).
  if (body.type === 'group_action' && body.action === 'split') {
    const g = (Array.isArray(body.results) ? body.results[0] : null) as { name?: unknown; class?: unknown; head?: unknown } | null
    return { type: 'split', lot: str(body.source_lot_id), leaving: num(g?.head), splitName: str(g?.name), splitClass: str(g?.class), when, outboxId }
  }
  if (body.type === 'group_action' && body.action === 'preg_check') {
    const results = Array.isArray(body.results) ? body.results as { name?: unknown; class?: unknown; head?: unknown }[] : []
    const detail = (body.detail && typeof body.detail === 'object' ? body.detail : {}) as { bred?: unknown; open?: unknown }
    const counted = typeof body.counted === 'number' ? body.counted : 0
    const stay = typeof body.stay === 'number' ? body.stay : counted
    const open = typeof detail.open === 'number' ? detail.open : results.reduce((n, r) => n + (typeof r.head === 'number' ? r.head : 0), 0) || Math.max(0, counted - stay)
    return { type: 'preg_check', lot: str(body.source_lot_id), checked: String(counted), open: String(open), split: results.length > 0, splitName: str(results[0]?.name), splitClass: str(results[0]?.class), when, outboxId }
  }
  if (!isManualEventType(body.type)) return null
  const n1 = num(body.bales) ?? num(body.inches) ?? num(body.count) ?? num(body.head) ?? num(body.counted)
  return { type: body.type as ManualEventType, n1, what: str(body.what), place: str(body.place_id) ?? undefined, fromPlace: str(body.from_place_id), toPlace: str(body.to_place_id), lot: str(body.herd_lot_id), when, asOf: str(body.as_of), outboxId }
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
// Block 7A: a surface with its own save strip (the capture card's answer, with
// a tappable link) registers here while mounted, so the global strip — which
// takes no taps — stands down instead of showing the same receipt twice.
export function useOwnSaveStrip(active: boolean): void {
  useEffect(() => {
    if (!active) return
    launchers++; for (const l of launcherListeners) l()
    return () => { launchers--; for (const l of launcherListeners) l() }
  }, [active])
}
function useHasDraft(): boolean {
  return useSyncExternalStore(subscribeDraft, () => !!readDraft()?.type, () => false)
}

type Place = { id: string; name: string; kind: string }

// Block 6A: the tiles are verbs. Count is its own group — it never reads as adding stock.
const TILE_VERB: Record<SheetType, string> = {
  preg_check: 'Preg check',
  split: 'Split a bunch',
  rain: 'Record rain',
  hay_fed: 'Feed hay',
  bales_stacked: 'Add bales to a stack',
  cattle_moved: 'Move cattle',
  cattle_worked: 'Record cattle work',
  hay_inventory: 'Count hay',
  cattle_counted: 'Count cattle',
  bunch_seen: 'Seen here',   // Block 30: one tap on the place sheet; never in the picker
}
const SAVE_LABEL: Record<SheetType, string> = {
  preg_check: 'Record preg check',
  split: 'Record the split',
  rain: 'Record rain',
  hay_fed: 'Record feeding',
  bales_stacked: 'Add bales',
  cattle_moved: 'Record move',
  cattle_worked: 'Record work',
  hay_inventory: 'Record count',
  cattle_counted: 'Record count',
  bunch_seen: 'Record sighting',
}
// 6G: the entries that can name a bunch. Feed always could; a move and cattle work now can, optionally.
const LOT_TYPES: readonly SheetType[] = ['hay_fed', 'cattle_moved', 'cattle_worked', 'cattle_counted', 'preg_check', 'split']

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
      <Field label={`${label} — new place`}>
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
        data-audit="place-select"
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
  // Block 15 (ruling 6): a whole number gets − and +; a decimal (inches) keeps the keyboard.
  if (step === '1') return <Counter label={label} unit={unit} value={value} onChange={onChange} audit={`num-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`} max={max ?? 20000} />
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
  type: SheetType, n: number, what: string,
  lot: string | null, place: string | null, from: string | null, to: string | null,
  bunch: MovedBunch | null = null,
): string {
  const at = place ? ` at ${place}` : ''
  const bales = (k: number) => `${k} ${k === 1 ? 'bale' : 'bales'}`
  switch (type) {
    case 'rain':          return `${Number.isFinite(n) ? n.toFixed(2) : '?'}" of rain${at}`
    case 'hay_fed':       return `Fed ${bales(n)}${lot ? ` to ${lot}` : ''}${at}`
    case 'bales_stacked': return `Stacked ${bales(n)}${at}`
    case 'cattle_moved':  return moveLine(Number.isFinite(n) ? n : null, bunch, from, to)   // Block 25: the one move wording
    case 'cattle_worked': return `${what ? what[0].toUpperCase() + what.slice(1) : 'Worked'} ${n} head${at}`
    case 'hay_inventory': return `${bales(n)} on hand${at}`
    case 'cattle_counted': return `Counted ${n} head${lot ? ` of ${lot}` : ''}`
    case 'bunch_seen': return `Seen ${lot ?? 'cattle'}${at}`   // Block 30 (never opened from the sheet; the label lives on the place sheet)
    case 'preg_check': return `Preg check · ${n} checked${lot ? ` · ${lot}` : ''}`
    case 'split': return `Split · ${n} head${lot ? ` from ${lot}` : ''}`
  }
}

// Block 6A: one sheet is mounted for the whole app (RecordSheetHost); any
// surface may render a launcher alone. `sheet` instances listen for openLogIt();
// `launcher` instances only ask.
export default function LogIt({ launcher = true, sheet = true }: { launcher?: boolean; sheet?: boolean } = {}) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<SheetType | null>(null)
  // Block 15: the preg check — checked and open are set; bred is the rest.
  const [pcChecked, setPcChecked] = useState('')
  const [pcOpen, setPcOpen] = useState('')
  const [split, setSplit] = useState(true)
  const [splitName, setSplitName] = useState('')
  const [splitClass, setSplitClass] = useState<LotClass | ''>('')
  // Block 19: how many head leave on a split of its own.
  const [leaving, setLeaving] = useState('')
  // Block 15 (ruling 2): the refused record this sheet is fixing, if any.
  const [fixingId, setFixingId] = useState<string | null>(null)
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
  // Block 33 (ruling 1): Where follows the BUNCH — its recorded place, not the
  // last place this phone used (the audit kept SIM-Corrals for the cows after a
  // bull move). A place the person picked, or a draft that names one, is kept;
  // a bunch with no recorded place leaves the last-used default in place.
  const placeChosen = useRef(false)
  const [fromPlace, setFromPlace] = useState<PlaceSlot>(EMPTY_SLOT)
  const [toPlace, setToPlace] = useState<PlaceSlot>(EMPTY_SLOT)
  const [when, setWhen] = useState('')      // '' = now
  const [editWhen, setEditWhen] = useState(false)
  const [asOf, setAsOf] = useState('')      // hay_inventory: 'YYYY-MM-DD', '' = today
  const [note, setNote] = useState('')      // hay_fed, behind More
  const [stock, setStock] = useState<PlaceSlot>(EMPTY_SLOT)   // hay_fed: the stack it came from, behind More
  const [lotsError, setLotsError] = useState(false)
  // Block 14: "New bunch" inside any bunch picker opens the on-the-spot form
  // below it; a made bunch joins the list and is picked at once.
  const [newBunch, setNewBunch] = useState(false)
  const bunchMade = (made: Lot) => { setLots(prev => { const next = [...(prev ?? []), made]; writeLotsCache(next); return next }); setLot(made.id); setNewBunch(false); writeLastLot(made.id) }

  const hasDraft = useHasDraft()

  const close = useCallback(() => {
    eventId.current = null
    setOpen(false); setType(null); setError(null)
    setN1(''); setWhat(''); setPlace(EMPTY_SLOT); setFromPlace(EMPTY_SLOT); setToPlace(EMPTY_SLOT); setWhen(''); setEditWhen(false); setAsOf('')
    setLots(null); setLot(''); setLotsError(false); setNote(''); setStock(EMPTY_SLOT)
    setPcChecked(''); setPcOpen(''); setSplit(true); setSplitName(''); setSplitClass(''); setFixingId(null); setNewBunch(false)
    placeChosen.current = false
    writeDraft(null)
  }, [])

  // Apply a Draft to the fields (restore after an app switch, or a pre-fill
  // from Repeat last / a place page).
  const applyDraft = useCallback((d: Draft, andOpen: boolean) => {
    setType(d.type)
    setN1(d.n1 ?? ''); setWhat(d.what ?? '')
    setPlace(d.place ? { id: d.place, newName: null } : EMPTY_SLOT)
    placeChosen.current = !!d.place   // a draft that names a place (Record here, Adjust first) chose it
    setFromPlace(d.fromPlace ? { id: d.fromPlace, newName: null } : EMPTY_SLOT)
    setToPlace(d.toPlace ? { id: d.toPlace, newName: null } : EMPTY_SLOT)
    setLot(d.lot ?? ''); setWhen(d.when ?? ''); setEditWhen(!!d.when); setAsOf(d.asOf ?? '')
    setPcChecked(d.checked ?? ''); setPcOpen(d.open ?? ''); setSplit(d.split ?? true); setSplitName(d.splitName ?? ''); setSplitClass((d.splitClass as LotClass | undefined) ?? '')
    setLeaving(d.leaving ?? '')
    setFixingId(d.outboxId ?? null)
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

  // Block 15: /ranch/preg-check redirects to /today?record=preg_check — the
  // chute is this sheet now. Read once, on a task; the query is a request.
  useEffect(() => {
    if (!sheet || typeof window === 'undefined') return
    const want = new URLSearchParams(window.location.search).get('record')
    if (want !== 'preg_check') return
    const t = setTimeout(() => { applyDraft({ type: 'preg_check' }, true); window.history.replaceState(null, '', window.location.pathname) }, 0)
    return () => clearTimeout(t)
  }, [sheet, applyDraft])

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
      checked: pcChecked, open: pcOpen, split, splitName, splitClass: splitClass || undefined, leaving, outboxId: fixingId ?? undefined,
    })
  }, [open, type, n1, what, place, fromPlace, toPlace, lot, when, editWhen, asOf, pcChecked, pcOpen, split, splitName, splitClass, leaving, fixingId])

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
        writeLotsCache(list)
        const last = readLastLot()
        // A draft's lot that the list no longer names is left UNASSIGNED, never
        // swapped for the last-used lot (6A: a slow option load rewrites nothing
        // the person chose). The last-used default applies only to an empty draft.
        setLot(prev => prev ? (list.some(l => l.id === prev) ? prev : '') : (list.some(l => l.id === last) ? last : ''))
      })
      .catch(() => {
        if (cancelled) return
        // No signal: the last list this phone saw, so the entry can still be
        // recorded against a bunch and sync later. No list ever seen → a real
        // error state, never a silent empty picker.
        const cached = readLotsCache()
        if (cached && cached.length > 0) { setLots(cached); setLotsError(false) }
        else { setLots([]); setLotsError(true) }
      })
    return () => { cancelled = true }
  }, [open, type, lots])

  // Block 33 (ruling 1): the bunch decides Where. Whenever the chosen bunch has
  // a recorded place the ranch knows, Where is that place — until the person
  // picks one themselves. Runs after the lots and the places have loaded, and
  // again when the bunch changes; a bunch without a place changes nothing.
  useEffect(() => {
    if (!open || !type || !['hay_fed', 'cattle_worked', 'cattle_counted'].includes(type) || placeChosen.current) return
    const pid = lot ? lots?.find(l => l.id === lot)?.place_id : null
    if (!pid || !places.some(p => p.id === pid)) return
    // On a task, not in the effect body (the cascading-render rule).
    const t = setTimeout(() => { if (!placeChosen.current) setPlace(prev => prev.id === pid ? prev : { id: pid, newName: null }) }, 0)
    return () => clearTimeout(t)
  }, [open, type, lot, lots, places])

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
      .catch(() => {
        // Block 20: no signal. The phone's copy of the ranch map (RecordPicker
        // keeps it) names every place, so the select can still SHOW the place
        // that was picked instead of a blank over a record that carries it.
        if (cancelled) return
        try {
          const raw = localStorage.getItem('dryline_ranch_map_v1')
          const cached = raw ? (JSON.parse(raw) as { places?: { id: string; name: string; kind: string }[] }) : null
          if (cached?.places?.length) setPlaces(cached.places.map(pl => ({ id: pl.id, name: pl.name, kind: pl.kind })))
        } catch { /* nothing kept: the select offers blank + new, as before */ }
      })
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
    n1.trim() !== '' || pcChecked.trim() !== '' || pcOpen.trim() !== '' ||
    what.trim() !== '' ||
    editWhen ||
    asOf !== '' ||
    [place, fromPlace, toPlace].some(s => s.newName !== null && s.newName.trim() !== '')
  // Block 15 (ruling 6): a pull down on the sheet closes it — asking first if something was typed.

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
      // Block 26c: Escape is the sheet's (BottomSheet), with the same dirty check.
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

      // Block 15 (ruling 3, ruling 10): THE PREG CHECK. One record: the bunch,
      // checked, bred, open, and — split on — the opens as a new bunch of the
      // class shown. Saved on the phone at once; the server function runs when
      // it lands. A fix re-saves under the refused record's own id.
      if (type === 'preg_check') {
        const source = lots?.find(l => l.id === lot) ?? null
        if (!source) { setError('Pick the bunch you checked.'); setBusy(false); return }
        const checked = Math.floor(Number(pcChecked) || 0), openN = Math.floor(Number(pcOpen) || 0)
        if (checked <= 0) { setError('How many did you check?'); setBusy(false); return }
        if (openN > checked) { setError(`${openN} open is more than the ${checked} checked.`); setBusy(false); return }
        const bred = checked - openN
        // Block 19 (ruling 1): the preg check is a CALLER of the split, not its
        // owner. The group that leaves is built by lib/cattle/split.ts, the
        // same one the split sheet uses — there is no second implementation.
        const name = (splitName.trim() || defaultSplitName(source, ranchToday(), { culls: true })).slice(0, 40)
        const klass = splitClass || defaultSplitClass(source.class, { culls: true })
        const doSplit = split && openN > 0
        const id = fixingId ?? eventId.current ?? (eventId.current = newEventId())
        const pbody: Record<string, unknown> = {
          id, type: 'group_action', action: 'preg_check',
          source_lot_id: source.id, expected_head: source.head_count,
          counted: checked, stay: bred,
          results: doSplit ? [splitGroup(openN, name, klass)] : [],
          detail: { bred, open: openN },
          ...(when ? { ts: new Date(when).toISOString() } : {}),
        }
        const label = `Preg check · ${checked} checked · ${bred} bred · ${openN} open${doSplit ? ` · ${openN} to ${name}` : ''}`
        try { enqueue(pbody, label) } catch { setError('This phone is full, so nothing was saved. Free some space on the phone, then record it again.'); setBusy(false); return }
        writeLastLot(lot)
        close()
        return
      }

      // Block 19 — SPLIT A BUNCH. Some head leave and become their own bunch;
      // the one they came from drops by that many. The arithmetic is 071's
      // (the count is what the bunch holds, what stays is the rest), so this
      // sends neither — it sends who, how many, and what they are called.
      //
      // Ruling 3: the only thing that can be untrue is more head leaving than
      // the bunch holds, and it is refused HERE only so a corral with no
      // signal gets the answer now; the words are the database's own
      // (lib/cattle/split.ts pins them). Nothing typed is thrown away — the
      // sheet stays open with the numbers and the name still in it.
      if (type === 'split') {
        const source = lots?.find(l => l.id === lot) ?? null
        if (!source) { setError('Pick the bunch that is splitting.'); setBusy(false); return }
        const head = Math.floor(Number(leaving) || 0)
        const refusal = splitRefusal(head, source.head_count)
        if (refusal) { setError(refusal); setBusy(false); return }
        const name = (splitName.trim() || defaultSplitName(source, ranchToday())).slice(0, 40)
        const klass = splitClass || defaultSplitClass(source.class)
        const id = fixingId ?? eventId.current ?? (eventId.current = newEventId())
        const sbody = splitBody({ id, source, head, name, class: klass, ...(when ? { ts: new Date(when).toISOString() } : {}) })
        try { enqueue(sbody, splitLabel(source, head, name)) } catch { setError('This phone is full, so nothing was saved. Free some space on the phone, then record it again.'); setBusy(false); return }
        writeLastLot(lot)
        close()
        return
      }

      // Block 25: a move left blank is the whole bunch — the number the field
      // shows in grey, and the one the preview line under it spells out.
      const wholeBunch = type === 'cattle_moved' ? lots?.find(l => l.id === lot)?.head_count : undefined
      const num = n1.trim() === '' ? (wholeBunch ?? NaN) : Number(n1)
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
          // Block 25: a move names its bunch. The route refuses without one in
          // these same words; said here first so a corral never waits on it.
          if (!lot) { setError(MOVE_NEEDS_BUNCH); setBusy(false); return }
          body.head = num; body.from_place_id = fromId; body.to_place_id = toId; body.herd_lot_id = lot
          body.place_id = toId   // where they are now
          break
        case 'cattle_worked': body.head = num; body.what = what; body.place_id = placeId; body.herd_lot_id = lot || null; break
        case 'hay_inventory': body.bales = num; body.as_of = asOf || todayKey(); body.place_id = placeId; break
        case 'cattle_counted':
          if (!lot) { setError('Pick the bunch you counted.'); setBusy(false); return }
          body.counted = num; body.herd_lot_id = lot; body.expected = lots?.find(l => l.id === lot)?.head_count ?? null
          break
      }
      if (!Number.isFinite(num) && type !== 'rain') { setError('Enter the number first'); return }

      // Block 2A: the entry is saved ON THIS PHONE first, under an id minted
      // here and now; the outbox uploads it (and retries with the same id).
      // A refused local write is the one failure that means "not saved".
      const placeName = (id: string | null) => places.find(p => p.id === id)?.name ?? null
      const lotName = lots?.find(l => l.id === lot)
      body.id = fixingId ?? eventId.current ?? (eventId.current = newEventId())
      const label = describe(type, num, what, lotName ? lotLabel(lotName) : null, placeName(placeId), placeName(fromId), placeName(toId), lotName ?? null)
      try {
        enqueue(body, label)
      } catch {
        setError('This phone is full, so nothing was saved. Free some space on the phone, then record it again.')
        return
      }
      writeLastPlace((type === 'cattle_moved' ? toId : placeId) ?? '')
      if (LOT_TYPES.includes(type)) writeLastLot(lot)
      close()
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : ''
      // Creating a NEW place needs the server; an existing place saves offline.
      setError(msg && !/fetch|network|load failed/i.test(msg) ? msg : 'No signal. A new place needs one — pick an existing place.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  const placeField = (label = 'Where') => (
    <PlaceSelect label={label} slot={place} places={places} onChange={s => { placeChosen.current = true; setPlace(s) }} disabled={busy} />
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
    <Field label="Fed to" hint={undefined} error={lotsError ? 'Couldn’t load your bunches — record without one, or try again below.' : undefined}>
      {lots === null ? (
        <Select value="" disabled aria-busy="true" data-audit="lots-loading"><option value="">Loading bunches…</option></Select>
      ) : (
        <Select value={lot} disabled={busy} onChange={e => { if (e.target.value === '__new__') { setNewBunch(true); return } setLot(e.target.value) }} data-audit="fed-to">
          <option value="">Not assigned to a bunch</option>
          {lots.map(l => <option key={l.id} value={l.id}>{bunchLabel(l)}</option>)}
          <option value="__new__">New bunch…</option>
        </Select>
      )}
    </Field>
    {newBunch && <NewBunchInline onMade={bunchMade} onCancel={() => setNewBunch(false)} />}
    {lotsError && (
      <button type="button" onClick={() => { setLots(null); setLotsError(false) }} className="-mt-2 self-start min-h-[44px] font-dm-sans text-[16px] font-semibold text-forest-green underline underline-offset-2" data-audit="lots-retry">Try loading bunches again</button>
    )}
    {placeField()}
    {n1.trim() !== '' && Number.isFinite(Number(n1)) && (
      <p className="font-dm-sans text-[16px] leading-snug text-ink" data-audit="feed-preview">
        {Number(n1)} {Number(n1) === 1 ? 'bale' : 'bales'}{lots?.find(l => l.id === lot) ? ` to ${lotLabel(lots.find(l => l.id === lot)!)}` : ''}{place.newName !== null ? (place.newName.trim() ? ` at ${place.newName.trim()}` : '') : (places.find(p => p.id === place.id)?.name ? ` at ${places.find(p => p.id === place.id)!.name}` : '')}, {editWhen && when ? new Date(when).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : `today ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
      </p>
    )}
  </>)
  if (type === 'bales_stacked') fields = (<>
    <NumberField label="Stacked" unit="bales" value={n1} onChange={setN1} max={10000} />
    {placeField('Stacked at')}
  </>)
  // 6G: which bunch — optional, with "Unassigned" plain. What a move DOES is said
  // on the field: it records the move; it never changes a lot's head count.
  const lotField = (label: string, hint: string | undefined, audit: string, required = false) => (<>
    <Field label={label} hint={lotsError ? undefined : hint} error={lotsError ? 'Couldn’t load your bunches — record without one, or try again below.' : undefined}>
      {lots === null ? (
        <Select value="" disabled aria-busy="true" data-audit="lots-loading"><option value="">Loading bunches…</option></Select>
      ) : (
        <Select value={lot} disabled={busy} onChange={e => { if (e.target.value === '__new__') { setNewBunch(true); return } setLot(e.target.value) }} data-audit={audit}>
          <option value="">{required ? 'Pick a bunch' : 'Unassigned'}</option>
          {lots.map(l => <option key={l.id} value={l.id}>{bunchLabel(l)}</option>)}
          <option value="__new__">New bunch…</option>
        </Select>
      )}
    </Field>
    {newBunch && <NewBunchInline onMade={bunchMade} onCancel={() => setNewBunch(false)} />}
  </>)
  // Block 25: a move names ONE bunch and it is required — picked first, since
  // it answers "how many" too. Blank head = the whole bunch.
  const movedLot = lots?.find(l => l.id === lot) ?? null
  const movedTo = toPlace.newName !== null ? toPlace.newName.trim() : (places.find(p => p.id === toPlace.id)?.name ?? '')
  if (type === 'cattle_moved') fields = (<>
    {lotField('Bunch', undefined, 'lot-for-move', true)}
    <NumberField label="Moved" unit="head" value={n1} onChange={setN1} max={20000} placeholder={movedLot ? String(movedLot.head_count) : '—'} />
    <PlaceSelect label="From" slot={fromPlace} places={places} onChange={setFromPlace} disabled={busy} />
    <PlaceSelect label="To" slot={toPlace} places={places} onChange={setToPlace} disabled={busy} />
    {movedLot && (
      <p className="font-dm-sans text-[16px] leading-snug text-ink" data-audit="move-preview">
        {movedWho(n1.trim() !== '' && Number.isFinite(Number(n1)) ? Number(n1) : movedLot.head_count, movedLot)}{movedTo ? ` → ${movedTo}` : ''}
      </p>
    )}
  </>)
  if (type === 'hay_inventory') fields = (<>
    <NumberField label="On hand" unit="bales" value={n1} onChange={setN1} max={100000} placeholder="0" />
    <p className="font-dm-sans text-[16px] text-ink" data-audit="count-scope">Count for: <span className="font-semibold">{place.newName !== null ? (place.newName.trim() || 'Entire ranch') : (places.find(p => p.id === place.id)?.name ?? 'Entire ranch')}</span></p>
    <Field label="Counted on">
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
  // Block 14 — Count cattle: tap the bunch, type the number, save. Expected
  // is what the bunch says now, shown so the difference is known before Save;
  // the server re-reads it when the entry lands. The bunch's number does not
  // move here — the answer offers "Change bunch to N?" afterward.
  if (type === 'cattle_counted') {
    const chosen = lots?.find(l => l.id === lot) ?? null
    const n = n1.trim() === '' ? null : Number(n1)
    fields = (<>
      <div>
        <p className="font-dm-sans text-[16px] font-medium text-ink" id="count-bunch-label">Which bunch</p>
        {lots === null ? (
          <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink" data-audit="lots-loading">Loading bunches…</p>
        ) : lotsError ? (
          <p className="mt-1 font-dm-sans text-[16px] font-semibold text-warning">Couldn’t load your bunches — try again below.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="count-bunch-label" data-audit="count-bunch">
            {lots.map(l => (
              <button key={l.id} type="button" role="radio" aria-checked={lot === l.id} onClick={() => setLot(l.id)} disabled={busy}
                className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${lot === l.id ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`} data-audit="count-bunch-option" data-lot={l.id}>
                {lotLabel(l)} <span className="font-normal opacity-80">· {bunchDetail(l)}</span>
              </button>
            ))}
            <button type="button" onClick={() => setNewBunch(true)} disabled={busy} className="min-h-[48px] rounded-full border border-dashed border-forest-green/40 px-4 font-dm-sans text-[16px] font-semibold text-forest-green" data-audit="count-new-bunch">New bunch…</button>
          </div>
        )}
        {newBunch && <div className="mt-2"><NewBunchInline onMade={bunchMade} onCancel={() => setNewBunch(false)} /></div>}
      </div>
      <NumberField label="Counted" unit="head" value={n1} onChange={setN1} max={20000} placeholder="0" />
      {chosen && (
        <p className="font-dm-sans text-[17px] text-ink" data-audit="count-preview">
          {n != null && Number.isFinite(n)
            ? <><span className="font-semibold">{n.toLocaleString()} counted</span> · {chosen.head_count.toLocaleString()} expected · <span className="font-semibold">{n - chosen.head_count === 0 ? 'same' : n - chosen.head_count > 0 ? `+${(n - chosen.head_count).toLocaleString()}` : `−${(chosen.head_count - n).toLocaleString()}`}</span></>
            : <>{lotLabel(chosen)} says <span className="font-semibold">{chosen.head_count.toLocaleString()} head</span>.</>}
        </p>
      )}
    </>)
  }
  // Block 19 — SPLIT A BUNCH. Held from any bunch row, or picked here. Which
  // bunch, how many leave, what they are called. The parent's new count is
  // shown as it will be, but it is never sent: 071 works it out.
  if (type === 'split') {
    const source = lots?.find(l => l.id === lot) ?? null
    const head = Math.floor(Number(leaving) || 0)
    const nameShown = splitName || (source ? defaultSplitName(source, ranchToday()) : '')
    const classShown = splitClass || (source ? defaultSplitClass(source.class) : 'cows')
    const refusal = source && leaving.trim() !== '' ? splitRefusal(head, source.head_count) : null
    fields = (<>
      <div>
        <p className="font-dm-sans text-[16px] font-medium text-ink" id="split-bunch-label">Which bunch</p>
        {lots === null ? (
          <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink" data-audit="lots-loading">Loading bunches…</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="split-bunch-label" data-audit="split-bunch">
            {lots.map(l => (
              <button key={l.id} type="button" role="radio" aria-checked={lot === l.id} onClick={() => setLot(l.id)} disabled={busy}
                className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${lot === l.id ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`} data-audit="split-lot-choice" data-lot={l.id}>
                {lotLabel(l)} <span className="font-normal opacity-80">· {bunchDetail(l)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Counter label="How many leave" value={leaving} onChange={setLeaving} unit="head" audit="split-leaving" max={source?.head_count} />
      <div>
        <label className="block font-dm-sans text-[16px] font-medium text-ink" htmlFor="split-name">Name the new bunch
          <input id="split-name" value={nameShown} onChange={e => setSplitName(e.target.value.slice(0, 40))} maxLength={40} className="mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink" data-audit="split-name" />
        </label>
        <p className="mt-3 font-dm-sans text-[16px] font-medium text-ink" id="split-class-label">Class</p>
        <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="split-class-label" data-audit="split-class">
          {LOT_CLASSES.map(c => (
            <button key={c} type="button" role="radio" aria-checked={classShown === c} onClick={() => setSplitClass(c)}
              className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${classShown === c ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`} data-audit={`split-class-${c}`}>
              {LOT_CLASS_LABELS[c]}
            </button>
          ))}
        </div>
      </div>
      {refusal && <p className="font-dm-sans text-[17px] font-semibold text-warning" role="alert" data-audit="split-refusal">{refusal}</p>}
      {source && !refusal && head > 0 && (
        <p className="font-dm-sans text-[17px] text-ink" data-audit="split-preview">
          {lotLabel(source)} keeps <span className="font-semibold">{(source.head_count - head).toLocaleString()}</span> · <span className="font-semibold">{head.toLocaleString()}</span> to {nameShown}
        </p>
      )}
    </>)
  }
  // Block 15 — THE CHUTE, in the sheet. Bunch, checked, bred, open by thumb;
  // the split on by default with its name and class shown and changeable.
  if (type === 'preg_check') {
    const source = lots?.find(l => l.id === lot) ?? null
    const checked = Math.floor(Number(pcChecked) || 0), openN = Math.floor(Number(pcOpen) || 0)
    const bred = Math.max(0, checked - openN)
    const nameShown = splitName || (source ? defaultSplitName(source, ranchToday(), { culls: true }) : '')
    const classShown = splitClass || (source ? defaultSplitClass(source.class, { culls: true }) : 'old_cows')
    fields = (<>
      <div>
        <p className="font-dm-sans text-[16px] font-medium text-ink" id="preg-bunch-label">Which bunch</p>
        {lots === null ? (
          <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink" data-audit="lots-loading">Loading bunches…</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="preg-bunch-label" data-audit="preg-bunch">
            {lots.map(l => (
              <button key={l.id} type="button" role="radio" aria-checked={lot === l.id} onClick={() => setLot(l.id)} disabled={busy}
                className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${lot === l.id ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`} data-audit="preg-lot-choice" data-lot={l.id}>
                {lotLabel(l)} <span className="font-normal opacity-80">· {bunchDetail(l)}</span>
              </button>
            ))}
            <button type="button" onClick={() => setNewBunch(true)} disabled={busy} className="min-h-[48px] rounded-full border border-dashed border-forest-green/40 px-4 font-dm-sans text-[16px] font-semibold text-forest-green" data-audit="preg-new-bunch">New bunch…</button>
          </div>
        )}
        {newBunch && <div className="mt-2"><NewBunchInline onMade={bunchMade} onCancel={() => setNewBunch(false)} /></div>}
      </div>
      <Counter label="Checked" value={pcChecked} onChange={v => { setPcChecked(v); const c = Math.floor(Number(v) || 0); if (openN > c) setPcOpen(String(c)) }} unit="head" audit="preg-checked" />
      <Counter label="Bred" value={String(bred)} onChange={v => { const b = Math.max(0, Math.min(checked, Math.floor(Number(v) || 0))); setPcOpen(String(checked - b)) }} unit="head" audit="preg-bred" max={checked} />
      <Counter label="Open" value={pcOpen} onChange={v => { const o = Math.max(0, Math.min(checked, Math.floor(Number(v) || 0))); setPcOpen(String(o)) }} unit="head" audit="preg-open" max={checked} />
      {source && checked > 0 && (
        <p className="font-dm-sans text-[17px] text-ink" data-audit="preg-equation">
          <span className="font-semibold">{bred.toLocaleString()} bred</span> + <span className="font-semibold">{openN.toLocaleString()} open</span> = {checked.toLocaleString()} checked
          {checked !== source.head_count && <span className="text-secondary-ink"> · {lotLabel(source)} said {source.head_count.toLocaleString()}</span>}
        </p>
      )}
      <div className="rounded-xl border border-forest-green/20 p-4" data-audit="preg-split">
        <label className="flex min-h-[48px] items-center gap-3 font-dm-sans text-[17px] font-semibold text-ink">
          <input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} className="h-6 w-6 accent-forest-green" data-audit="preg-split-toggle" />
          <span>Opens become a new bunch</span>
        </label>
        {split ? (
          <div className="mt-3">
            <label className="block font-dm-sans text-[16px] font-medium text-ink" htmlFor="preg-split-name">Name
              <input id="preg-split-name" value={nameShown} onChange={e => setSplitName(e.target.value.slice(0, 40))} maxLength={40} className="mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink" data-audit="preg-split-name" />
            </label>
            <p className="mt-3 font-dm-sans text-[16px] font-medium text-ink" id="preg-split-class-label">Class</p>
            <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="preg-split-class-label" data-audit="preg-split-class">
              {LOT_CLASSES.map(c => (
                <button key={c} type="button" role="radio" aria-checked={classShown === c} onClick={() => setSplitClass(c)}
                  className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${classShown === c ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`} data-audit={`preg-split-class-${c}`}>
                  {LOT_CLASS_LABELS[c]}
                </button>
              ))}
            </div>
            {source && checked > 0 && (
              <p className="mt-3 font-dm-sans text-[16px] text-ink" data-audit="preg-split-preview">
                {lotLabel(source)} keeps <span className="font-semibold">{bred.toLocaleString()}</span> · <span className="font-semibold">{openN.toLocaleString()}</span> to {nameShown}
              </p>
            )}
          </div>
        ) : (
          source && checked > 0 ? <p className="mt-2 font-dm-sans text-[16px] text-ink" data-audit="preg-nosplit-preview">{lotLabel(source)} goes to <span className="font-semibold">{bred.toLocaleString()}</span> · {openN.toLocaleString()} open recorded, not moved</p> : null
        )}
      </div>
    </>)
  }
  if (type === 'cattle_worked') fields = (<>
    <NumberField label="Worked" unit="head" value={n1} onChange={setN1} max={20000} />
    <Field label="What">
      <Input value={what} onChange={e => setWhat(e.target.value)} maxLength={80} placeholder="pregged, vaccinated, weaned…" />
    </Field>
    {lotField('Bunch', undefined, 'lot-for-work')}
    {placeField()}
  </>)

  return (
    <>
      {launcher && (
      <div className="space-y-3">
        {/* Block 11 (11.5) — Today had a full-width Record button AND the
            floating pill. The pill is gone into the bottom bar, which every
            screen now carries, so a second Record here would just be the same
            action twice on the one screen that needs it least.
            What survives is the thing the bar cannot say: that there is an
            unfinished entry sitting on this phone. Then it is not a duplicate
            Record — it is a way back to work already started. */}
        {hasDraft && !open && (
          <button
            type="button"
            onClick={openSheet}
            data-audit="finish-draft"
            className="min-h-[56px] w-full rounded-lg bg-forest-green px-4 py-3 text-center font-dm-sans text-[17px] font-semibold text-white transition-colors hover:bg-forest-green/90"
          >
            Finish your unsaved entry
          </button>
        )}
        {/* The strip stays in the flow here — this is where Undo, Try again and
            Sync now can be tapped without anything floating over the page. */}
        <SaveStatus />
      </div>
      )}

      {sheet && open && (
        <BottomSheet open onClose={() => close()} label="Record work" z={60} panelAudit="record-sheet" panelRef={dialogRef}>
            <div className="flex items-center justify-between">
              <Heading level={3} visual={5}>{type ? TILE_VERB[type] : 'Record work'}</Heading>
              {/* Block 26c: no Close — the pull-down and the dim are the close. Back stays: it is a different act. */}
              {type && (
                <button type="button" onClick={() => { eventId.current = null; setType(null); setError(null); setNewBunch(false) }} className="min-h-[48px] px-2 font-dm-sans text-[16px] font-semibold text-ink hover:text-forest-green">
                  Back
                </button>
              )}
            </div>

            {!type ? (
              // Block 20: the picker is the ranch map and one row of actions.
              // A place tapped first is the record's place; an action tapped
              // first takes the place under the fix, or the form asks.
              <RecordPicker
                onPick={(a, placeId) => {
                  setType(a); setError(null)
                  if (placeId) { if (a === 'cattle_moved') setToPlace({ id: placeId, newName: null }); else setPlace({ id: placeId, newName: null }) }
                }}
                onRare={(a, placeId) => { setType(a); setError(null); if (placeId) setPlace({ id: placeId, newName: null }) }}
                onClose={close}
              />
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
                  <p className="font-dm-sans text-[16px] font-medium text-warning" role="alert" data-audit="record-error">{error}</p>
                )}

                {/* Block 15 (ruling 2): a refused record being fixed says so,
                    and the way to throw it away is HERE, behind the numbers —
                    never one tap on the strip beside a real count. */}
                {fixingId && (
                  <div className="rounded-lg bg-forest-green/[0.06] px-4 py-3" data-audit="fixing-record">
                    <p className="font-dm-sans text-[16px] text-ink">Fixing a record that couldn’t send.</p>
                    <button type="button" onClick={() => { discard(fixingId); close() }} className="mt-2 min-h-[44px] font-dm-sans text-[15px] font-semibold underline underline-offset-2" style={{ color: warning }} data-audit="fixing-discard">
                      Throw this record away
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => close()}
                  disabled={busy}
                  className="self-start min-h-[44px] font-dm-sans text-[16px] font-semibold text-secondary-ink underline underline-offset-2 disabled:opacity-50"
                >
                  Cancel
                </button>
                {/* Block 15 (ruling 6): Save at the bottom, full width, thumb height, saying what it does. */}
                <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-rule bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-3">
                  <Button type="submit" disabled={busy || (LOT_TYPES.includes(type) && lots === null)} className="w-full min-h-[60px] text-[18px]" data-audit="record-save">
                    {busy ? 'Saving…' : LOT_TYPES.includes(type) && lots === null ? 'Loading bunches…' : SAVE_LABEL[type]}
                  </Button>
                </div>
              </form>
            )}
        </BottomSheet>
      )}
    </>
  )
}
