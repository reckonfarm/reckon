'use client'

import { todayKey } from '@/lib/jobs/format'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  LOT_CLASSES,
  LOT_PURPOSES,
  LOT_PURPOSE_LABELS,
  type LotPurpose,
  LOT_CLASS_LABELS,
  LOT_FRAMES,
  LOT_NAME_MAX,
  DEFAULT_FRAME,
  lotLabel,
  type Lot,
  type LotClass,
  type LotFrame,
  type WeightUnit,
} from '@/lib/herd'
import { Card } from '@/app/components/ui/Card'
import { Button } from '@/app/components/ui/Button'
import { Field, Input, Select } from '@/app/components/ui/Field'
import { Segmented } from '@/app/components/ui/Segmented'
import Counter from '@/app/components/ui/Counter'
import Link from 'next/link'
import type { LastWork, BunchWhere } from '@/lib/ranch-summary'
import { enqueue, newEventId } from '@/lib/outbox'
import { moveLine, NO_PLACE_RECORDED } from '@/lib/move-line'
import RowActions from '@/app/components/RowActions'
import TapValue from '@/app/components/TapValue'
import { UNDO_HOLD_MS } from '@/app/dashboard/components/RepeatLastCard'
import { openLogIt } from '@/app/dashboard/components/LogIt'
import { navigateTo } from '@/lib/standalone-nav'
import { deleteWithUndo, callDelete, restoreFromTrash, showNotice } from '@/lib/undo'

// Capture-first herd entry. The fast path is class → head → weight (+ lb/cwt); those four
// make a valid lot, saved instantly. Frame / weaned / sale windows are pre-filled defaults
// behind "Sharpen details" — available, never blocking. Saves go ONE LOT AT A TIME to
// /api/herd/lots (Block 4B: rows, not a blob); the server's rows are adopted back into state.
// No dollars here — valuation lands with the MARS/HerdEstimate engine later.

const FEEDER_CLASSES: readonly LotClass[] = ['steers', 'heifers', 'yearlings']
const isFeeder = (c: LotClass) => FEEDER_CLASSES.includes(c)

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type Editing = 'new' | string | null

// What we PATCH. New lots omit id/timestamps (server stamps + generates id). Edits keep id +
// created_at and omit updated_at, so the server bumps only the edited lot's updated_at.
interface LotPayload {
  id?: string
  name?: string        // optional; the server trims, caps, and drops a blank one
  class: LotClass
  head_count: number
  avg_weight: number | null
  weight_unit: WeightUnit
  frame: LotFrame
  weaned: boolean
  sale_windows: { month: string }[]
  purpose?: LotPurpose
  created_at?: string
  as_of?: string      // Block 36: the day the opening count was true (a new bunch only)
}

function formatMonth(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00`)
  if (Number.isNaN(d.getTime())) return ym
  return `${d.toLocaleDateString('en-US', { month: 'short' })} ’${d.toLocaleDateString('en-US', { year: '2-digit' })}`
}

// "2 days ago" · "today" — the count's age, for the card's one line.
function agoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const d = Math.floor(ms / 86_400_000)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d} days ago`
  const m = Math.floor(d / 30)
  return m === 1 ? 'a month ago' : `${m} months ago`
}

export default function HerdForm({ initialLots, lastWork = {}, where = {}, purposeSupported = false, followed = [] }: { followed?: string[]; initialLots?: Lot[]; lastWork?: Record<string, LastWork>; where?: Record<string, BunchWhere>; purposeSupported?: boolean } = {}) {
  const router = useRouter()
  const [lots, setLots] = useState<Lot[]>(initialLots ?? [])
  // Block 40: the bunches Markets prices. Following one from its row is a
  // single tap that then lands on Markets; a failed send stays here and says so.
  const [followedIds, setFollowedIds] = useState<Set<string>>(() => new Set(followed))
  const followThenGo = async (id: string) => {
    try {
      const r = await fetch('/api/herd/follow', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lot_id: id, followed: true }) })
      if (!r.ok) throw new Error(String(r.status))
      setFollowedIds(s => new Set([...s, id]))
      navigateTo(router, `/markets?lot=${id}`)
    } catch {
      showNotice("Couldn't send")
    }
  }
  // Block 13: the server's list is the truth after a refresh — an Undo puts a
  // bunch back, router.refresh() re-renders the page with it, and this form
  // must show it. Adjusting state from a changed prop DURING render is the
  // React pattern for this (no effect, no extra commit).
  const [seenLots, setSeenLots] = useState(initialLots)
  if (initialLots !== seenLots) { setSeenLots(initialLots); if (initialLots) setLots(initialLots) }
  const [loading, setLoading] = useState(!initialLots)
  const [dPurpose, setDPurpose] = useState<LotPurpose | ''>('')
  const [loadError, setLoadError] = useState('')

  const [editing, setEditing] = useState<Editing>(null)
  // Block 12 (12.3): a lot row held for Fix lands with the form already open.
  // Block 13: Delete no longer lands anywhere — it happens on the row.
  useEffect(() => {
    const h = typeof window !== 'undefined' ? window.location.hash : ''
    const e = /^#edit-([0-9a-f-]{36})$/i.exec(h)
    if (e) { const lot = (initialLots ?? []).find(l => l.id === e[1]); if (lot) openEdit(lot) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Block 14: where a NEW bunch is. Block 25b: and where an existing one is — picking
  // a different place on an edit records a MOVE there, through the outbox.
  const [dPlace, setDPlace] = useState<string>('')
  const [dAsOf, setDAsOf] = useState<string>('')   // Block 36: '' = today
  const [placeOptions, setPlaceOptions] = useState<{ id: string; name: string }[] | null>(null)
  useEffect(() => {
    if (editing === null || placeOptions !== null) return
    let alive = true
    fetch('/api/places').then(r => (r.ok ? r.json() : { places: [] })).then(j => { if (alive) setPlaceOptions((j.places ?? []) as { id: string; name: string }[]) }).catch(() => { if (alive) setPlaceOptions([]) })
    return () => { alive = false }
  }, [editing, placeOptions])
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // Draft editor fields.
  const [dName, setDName] = useState('')
  const [dClass, setDClass] = useState<LotClass | ''>('')
  const [dHead, setDHead] = useState('')
  const [dWeight, setDWeight] = useState('')
  const [dUnit, setDUnit] = useState<WeightUnit>('lb')
  const [dFrame, setDFrame] = useState<LotFrame>(DEFAULT_FRAME)
  const [dWeaned, setDWeaned] = useState(true)
  const [dWindows, setDWindows] = useState<string[]>([])
  const [dMonth, setDMonth] = useState('')
  const [showDetail, setShowDetail] = useState(false)
  // Block 15 (ruling 7): after a save the list does not jump to the top — the
  // row you touched is scrolled into view and lit for a moment.
  const [litId, setLitId] = useState<string | null>(null)
  useEffect(() => {
    if (!litId) return
    const el = document.getElementById(`lot-${litId}`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const t = setTimeout(() => setLitId(null), 2_500)
    return () => clearTimeout(t)
  }, [litId])

  useEffect(() => {
    if (initialLots) return   // Block 6A: the page hands the rows in; writes reload from /api/herd/lots
    fetch('/api/operation-profile')
      .then(async r => {
        if (!r.ok) throw new Error('Could not load your herd. Refresh to try again.')
        return r.json()
      })
      .then((data: { profile?: { herd?: { lots?: Lot[] } } }) => {
        const loaded = data?.profile?.herd?.lots
        setLots(Array.isArray(loaded) ? loaded : [])
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false))
  }, [initialLots])

  function resetDraft() {
    setDName(''); setDClass(''); setDHead(''); setDWeight(''); setDUnit('lb')
    setDFrame(DEFAULT_FRAME); setDWeaned(true); setDWindows([]); setDMonth(''); setShowDetail(false); setDPurpose(''); setDPlace('')
  }

  function openAdd() { resetDraft(); setDAsOf(''); setErrorMsg(''); setEditing('new') }

  function openEdit(lot: Lot) {
    setDName(lot.name ?? '')
    setDClass(lot.class)
    setDHead(String(lot.head_count))
    setDWeight(lot.avg_weight == null ? '' : String(lot.avg_weight))
    setDUnit(lot.weight_unit)
    setDFrame(lot.frame)
    setDWeaned(lot.weaned)
    setDWindows(lot.sale_windows?.map(w => w.month) ?? [])
    setDPurpose(lot.purpose ?? '')
    setDMonth('')
    setDPlace(lot.place_id ?? '')
    setShowDetail((lot.sale_windows?.length ?? 0) > 0)
    setErrorMsg(''); setEditing(lot.id)
  }

  function cancel() { setEditing(null); setErrorMsg(''); if (status === 'error') setStatus('idle') }

  const headNum = Number(dHead)
  const weightNum = Number(dWeight)
  // Block 14: weight is optional — blank means "no weight set", never a block.
  const draftValid = dClass !== '' && /^\d+$/.test(dHead.trim()) && headNum > 0 && (dWeight.trim() === '' || weightNum > 0)

  function buildPayloadLot(): LotPayload {
    const lot: LotPayload = {
      name: dName.trim(),
      class: dClass as LotClass,
      head_count: headNum,
      avg_weight: dWeight.trim() === '' ? null : weightNum,
      ...(editing === 'new' && dPlace ? { place_id: dPlace } : {}),
      ...(editing === 'new' && dAsOf ? { as_of: dAsOf } : {}),
      weight_unit: dUnit,
      frame: dFrame,
      weaned: dWeaned,
      sale_windows: dWindows.map(month => ({ month })),
      ...(purposeSupported && dPurpose ? { purpose: dPurpose } : {}),
    }
    if (editing && editing !== 'new') {
      lot.id = editing
      const orig = lots.find(l => l.id === editing)
      if (orig) lot.created_at = orig.created_at
    }
    return lot
  }

  // Block 4B — lots are rows: each save touches ONE lot (POST new, PATCH by id with the
  // updated_at this form last saw; DELETE retires). Two people editing different lots
  // never overwrite each other; a same-lot edit that lost the race comes back 409 and the
  // form reloads the other person's version instead of writing over it.
  async function reload(): Promise<Lot[]> {
    const res = await fetch('/api/herd/lots')
    const json = await res.json().catch(() => ({}))
    const next = Array.isArray((json as { lots?: Lot[] }).lots) ? (json as { lots: Lot[] }).lots : []
    setLots(next)
    return next
  }
  async function write(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<boolean> {
    setStatus('saving'); setErrorMsg('')
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('error')
        setErrorMsg((json as { error?: string }).error ?? 'Could not save.')
        if (res.status === 409 || res.status === 404) await reload()   // show the ranch's current version, never write over it
        return false
      }
      await reload()
      router.refresh()   // the server-computed HerdEstimate above re-reads the rows
      setStatus('saved')
      setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 2000)
      return true
    } catch {
      setStatus('error')
      setErrorMsg('Could not reach the server. Check your connection and try again.')
      return false
    }
  }

  async function saveDraft() {
    if (!draftValid) return
    const lot = buildPayloadLot()
    const before = new Set(lots.map(l => l.id))
    const was = editing
    // Block 25b (ruling 3): a place picked on an EDIT is a move to it — saved on
    // this phone first and sent by the outbox, so it works at a gate. When the
    // place is all that changed there is nothing else to send.
    const orig = editing === 'new' ? null : lots.find(l => l.id === editing) ?? null
    const movedTo = orig && dPlace && dPlace !== (orig.place_id ?? '') ? dPlace : null
    if (orig && movedTo) {
      const nameOf = (id: string | null | undefined) => placeOptions?.find(pl => pl.id === id)?.name ?? null
      try {
        enqueue({ id: newEventId(), type: 'cattle_moved', ts: new Date().toISOString(), head: orig.head_count, herd_lot_id: orig.id, from_place_id: orig.place_id ?? null, to_place_id: movedTo, place_id: movedTo },
          moveLine(orig.head_count, orig, nameOf(orig.place_id), nameOf(movedTo)))
      } catch {
        setStatus('error'); setErrorMsg('This phone is full, so the move was not saved. Free some space on the phone, then pick the place again.'); return
      }
    }
    const same = !!orig && (orig.name ?? '') === (lot.name ?? '') && orig.class === lot.class && orig.head_count === lot.head_count && (orig.avg_weight ?? null) === (lot.avg_weight ?? null)
      && orig.weight_unit === lot.weight_unit && orig.frame === lot.frame && orig.weaned === lot.weaned && (orig.purpose ?? '') === (lot.purpose ?? '')
      && JSON.stringify((orig.sale_windows ?? []).map(w => w.month)) === JSON.stringify((lot.sale_windows ?? []).map(w => w.month))
    const ok = editing === 'new'
      ? await write('/api/herd/lots', 'POST', lot)
      : movedTo && same ? true
      : await write(`/api/herd/lots/${editing}`, 'PATCH', { ...lot, expected_updated_at: orig?.updated_at ?? null })
    if (ok) {
      setEditing(null); resetDraft()
      const now = await reload()
      setLitId(was === 'new' ? (now.find(l => !before.has(l.id))?.id ?? null) : was)
    }
  }

  // Block 13: Delete is one tap to the trash, Undo on the strip for ten
  // seconds. Archive (retire) is gone from the screen; the route stays.
  async function removeLot(lot: Lot) {
    const r = await deleteWithUndo({ label: `${lot.head_count.toLocaleString('en-US')} head · ${lotLabel(lot)}`, run: () => callDelete(`/api/herd/lots/${lot.id}`, { method: 'DELETE' }), undo: restoreFromTrash('herd_lots', lot.id) })
    if (!r.ok) { showNotice(r.error); return }
    if (editing === lot.id) setEditing(null)
    setLots(prev => prev.filter(l => l.id !== lot.id))
    router.refresh()
  }

  // Block 14: "Change bunch to N?" — the bunch's head count set to the count,
  // through the same PATCH as any edit (a head_count_set row, the projection
  // follows). Everything else on the bunch is sent as it stands.
  async function setHeadFromCount(lot: Lot, counted: number) {
    await write(`/api/herd/lots/${lot.id}`, 'PATCH', { ...lot, head_count: counted, expected_updated_at: lot.updated_at })
  }

  function addWindow() {
    if (!/^\d{4}-\d{2}$/.test(dMonth)) return
    setDWindows(w => (w.includes(dMonth) ? w : [...w, dMonth].sort()))
    setDMonth('')
  }

  // ── Editor (shared by add + edit) ───────────────────────────────────────────────
  function renderEditor() {
    return (
      <Card shadow="soft" className="p-4 sm:p-5">
        <p className="font-dm-sans text-[14px] font-medium uppercase tracking-wide text-secondary-ink">
          {editing === 'new' ? 'Add a bunch' : 'Fix this bunch'}
        </p>

        <div className="mt-3">
          <p className="mb-1.5 font-dm-sans text-[16px] font-medium text-ink">Class</p>
          <div role="group" aria-label="Class" className="flex flex-wrap gap-2">
            {LOT_CLASSES.map(c => {
              const on = dClass === c
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDClass(c)}
                  className={[
                    'min-h-[48px] rounded-lg border px-3 font-dm-sans text-[16px] transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    on ? 'border-accent bg-accent font-semibold text-cream' : 'border-line/20 text-accent hover:bg-accent/5',
                  ].join(' ')}
                >
                  {LOT_CLASS_LABELS[c]}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-4">
          <Field label="Name">
            <Input
              value={dName}
              maxLength={LOT_NAME_MAX}
              placeholder="Optional — e.g. Replacement heifers"
              onChange={e => setDName(e.target.value)}
            />
          </Field>
        </div>

        {/* Block 15 (ruling 9): a NEW bunch is name, head, class, place. Purpose,
            weight, frame, weaned and sale windows are on Fix — the row is made
            in the corral; it is sharpened at the kitchen table. */}
        <div className="mt-6">
          <Counter label="Head count" value={dHead} onChange={setDHead} audit="lot-head-count" min={0} max={20000} />
        </div>
        {/* Block 36: a bunch can carry an opening date — the day that count was true,
            so a bunch put on the books late opens on the right day. Today unless changed. */}
        {editing === 'new' && (
          <label className="mt-6 block font-dm-sans text-[16px] font-semibold text-ink">As of
            <input type="date" value={dAsOf} max={todayKey()} onChange={e => setDAsOf(e.target.value)} placeholder={todayKey()} className="mt-1 block min-h-[48px] w-full rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink" data-audit="lot-as-of" />
          </label>
        )}

        <div className={`mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 ${editing === 'new' ? 'hidden' : ''}`}>
          {purposeSupported && editing !== 'new' && (
            <Field label="Purpose">
              <Select value={dPurpose} onChange={e => setDPurpose(e.target.value as LotPurpose | '')} data-audit="lot-purpose">
                <option value="">Not set</option>
                {LOT_PURPOSES.map(v => <option key={v} value={v}>{LOT_PURPOSE_LABELS[v]}</option>)}
              </Select>
            </Field>
          )}
          <div className={editing === 'new' ? 'hidden' : ''}>
            <Field label="Average weight">
              <Input
                type="number" inputMode="decimal" min={0} step="any"
                placeholder={dUnit === 'cwt' ? 'e.g. 5.5' : 'e.g. 550'}
                value={dWeight} onChange={e => setDWeight(e.target.value)}
              />
            </Field>
            <div className="mt-2">
              <Segmented<WeightUnit>
                ariaLabel="Weight unit"
                value={dUnit}
                onChange={setDUnit}
                options={[{ value: 'lb', label: 'lb' }, { value: 'cwt', label: 'cwt' }]}
              />
            </div>
          </div>
        </div>

        {placeOptions !== null && placeOptions.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 font-dm-sans text-[16px] font-medium text-ink" id="lot-place-label">Where they are <span className="font-normal text-secondary-ink">· optional</span></p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="lot-place-label" data-audit="lot-place">
{/* Block 25b: a bunch that has a place cannot be un-placed by hand — only its
                  moves say where it is — so the "none" chip is offered only while there is none. */}
              {(editing === 'new' || !lots.find(l => l.id === editing)?.place_id) && (              <button type="button" role="radio" aria-checked={dPlace === ''} onClick={() => setDPlace('')} className={`min-h-[48px] rounded-lg border px-3 font-dm-sans text-[16px] ${dPlace === '' ? 'border-accent bg-accent font-semibold text-cream' : 'border-line/20 text-accent'}`}>Not said</button>)}
              {placeOptions.map(pl => (
                <button key={pl.id} type="button" role="radio" aria-checked={dPlace === pl.id} onClick={() => setDPlace(pl.id)} className={`min-h-[48px] rounded-lg border px-3 font-dm-sans text-[16px] ${dPlace === pl.id ? 'border-accent bg-accent font-semibold text-cream' : 'border-line/20 text-accent'}`} data-audit="lot-place-option">{pl.name}</button>
              ))}
            </div>
          </div>
        )}

        <div className={`mt-6 ${editing === 'new' ? 'hidden' : ''}`}>
          <button
            type="button"
            onClick={() => setShowDetail(s => !s)}
            className="font-dm-sans text-[16px] font-medium text-brand hover:text-accent"
          >
            {showDetail ? 'Hide details' : 'Sharpen details (optional)'}
          </button>

          {showDetail && (
            <div className="mt-3 space-y-4 border-t border-line/10 pt-4">
              <Field label="Frame">
                <Select value={dFrame} onChange={e => setDFrame(e.target.value as LotFrame)}>
                  {LOT_FRAMES.map(f => <option key={f} value={f}>{f}</option>)}
                </Select>
              </Field>

              {dClass !== '' && isFeeder(dClass) && (
                <div>
                  <p className="mb-1.5 font-dm-sans text-[16px] font-medium text-ink">Weaned</p>
                  <Segmented<'weaned' | 'unweaned'>
                    ariaLabel="Weaned"
                    value={dWeaned ? 'weaned' : 'unweaned'}
                    onChange={v => setDWeaned(v === 'weaned')}
                    options={[{ value: 'weaned', label: 'Weaned' }, { value: 'unweaned', label: 'Unweaned' }]}
                  />
                </div>
              )}

              <div>
                <p className="mb-1.5 font-dm-sans text-[16px] font-medium text-ink">Sale windows</p>
                <p className="mb-2 font-dm-sans text-[14px] text-secondary-ink">
                  When you expect to sell. Leave empty if you&rsquo;re not sure yet.
                </p>
                {dWindows.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {dWindows.map(m => (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1 rounded-full border border-line/20 bg-accent/[0.05] px-2.5 py-1 font-dm-sans text-[14px] text-accent"
                      >
                        {formatMonth(m)}
                        <button
                          type="button"
                          aria-label={`Remove ${formatMonth(m)}`}
                          onClick={() => setDWindows(w => w.filter(x => x !== m))}
                          className="text-secondary-ink hover:text-warning"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input type="month" value={dMonth} onChange={e => setDMonth(e.target.value)} className="flex-1" />
                  <Button variant="secondary" onClick={addWindow} className="shrink-0">Add</Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {errorMsg && <p className="mt-3 font-dm-sans text-[16px] font-medium text-warning">{errorMsg}</p>}

        <div className="mt-6 flex flex-col items-center gap-3">
          <Button variant="primary" onClick={saveDraft} disabled={!draftValid || status === 'saving'} className="w-full min-h-[56px] text-[18px]" data-audit="lot-save">
            {status === 'saving' ? 'Saving…' : editing === 'new' ? 'Add the bunch' : 'Save the bunch'}
          </Button>
          <button type="button" onClick={cancel} className="min-h-[44px] font-dm-sans text-[16px] text-secondary-ink hover:text-ink">
            Cancel
          </button>
        </div>
      </Card>
    )
  }

  function renderRow(lot: Lot) {
    const work = lastWork[lot.id]
    return (
      <RowActions key={lot.id} links={{
        label: `${lot.head_count.toLocaleString('en-US')} head · ${lotLabel(lot)}`,
        // Block 23 (ruling 1): NO Open. A bunch has no page of its own — it is
        // this row — and the link pointed at `#<id>` while the row answers to
        // `#lot-<id>`, so the button navigated to the page you were already on
        // and did nothing visible. A control that does nothing when tapped
        // teaches people the app is broken where it is not.
        fix: { onSelect: () => openEdit(lot) },
        // Block 19 (ruling 1): splitting is something you do to ANY bunch, so
        // it is on the hold gesture every row already has — not buried inside
        // a preg check the bunch may never have come through.
        // Block 33 (ruling 2): a feeding starts from the bunch — hold the row, Feed,
        // the number, Record. The sheet takes this bunch and its recorded place.
        // Block 22: counting at a gate is a thing you do TO a bunch, so it is
        // on the same gesture as Split rather than buried under Record.
        extra: [
          { label: 'Feed', onSelect: () => openLogIt({ type: 'hay_fed', lot: lot.id }) },
          { label: 'Count at a gate', href: `/ranch/tally?lot=${lot.id}` },
          { label: 'Split', onSelect: () => openLogIt({ type: 'split', lot: lot.id }) },
        ],
        del: { onSelect: () => removeLot(lot) },
      }}>
      <Card shadow="sm" className={`p-4 transition-shadow ${litId === lot.id ? 'ring-2 ring-forest-green' : ''}`} data-audit="lot-row" id={`lot-${lot.id}`} data-lit={litId === lot.id ? 'true' : undefined}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-dm-sans text-[17px] font-semibold text-ink">
              {/* Block 37: the head count IS the control — tap it, type, Done; a head_count_set anchor through the outbox with its Undo. */}
              <TapValue value={lot.head_count} label={`Bunch size, ${lotLabel(lot)}`} audit="lot-head" min={1} max={20_000} className="tabular-nums font-dm-sans text-[17px] font-semibold text-ink" onSave={n => { const id = newEventId(); try { enqueue({ id, head_count: n }, `${n} head · ${lotLabel(lot)}`, UNDO_HOLD_MS, { endpoint: `/api/herd/lots/${lot.id}/head` }); return id } catch { return null } }} /> head · {lotLabel(lot)}
            </p>
            <p className="mt-0.5 font-dm-sans text-[16px] text-ink">
              {lot.name?.trim() ? `${LOT_CLASS_LABELS[lot.class]} · ` : ''}
              {lot.purpose ? <span data-audit="lot-purpose-label">{LOT_PURPOSE_LABELS[lot.purpose]} · </span> : null}
              {lot.avg_weight == null ? <span data-audit="lot-no-weight">no weight set</span> : <><span className="tabular-nums">{lot.avg_weight}</span> {lot.weight_unit} avg</>}
              {isFeeder(lot.class) ? ` · ${lot.weaned ? 'weaned' : 'unweaned'}` : ''}
            </p>
            {/* Block 25: where the bunch is — set by its last move, which is
                also its as-of and one tap away. */}
            {!where[lot.id] && <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="lot-where">{NO_PLACE_RECORDED}</p>}
            {where[lot.id] && (
              <p className="mt-1 font-dm-sans text-[15px] text-ink" data-audit="lot-where">
                At <Link href={`/ranch/places/${where[lot.id].placeId}`} className="font-semibold underline underline-offset-2" data-audit="lot-where-place">{where[lot.id].placeName}</Link>
                {where[lot.id].moved && <span className="text-secondary-ink"> · <Link href={`/ranch/activity/${where[lot.id].moved!.eventId}`} className="underline underline-offset-2">{where[lot.id].moved!.placement ? 'placed' : 'moved'} {agoLabel(where[lot.id].moved!.ts)}</Link></span>}
              </p>
            )}
            {/* Block 14: the last count, one line, with the difference — and the
                one button when it differs. A count never changed this number;
                this button does, through the same save as any edit. */}
            {work?.count && (
              <p className="mt-1 font-dm-sans text-[15px] text-ink" data-audit="lot-last-count">
                Last count: <Link href={`/ranch/activity/${work.count.eventId}`} className="underline underline-offset-2"><span className="font-semibold">{work.count.counted.toLocaleString()} counted</span>{work.count.expected != null && <> · {work.count.expected.toLocaleString()} expected · {work.count.counted - work.count.expected === 0 ? 'same' : work.count.counted - work.count.expected > 0 ? `+${(work.count.counted - work.count.expected).toLocaleString()}` : `−${(work.count.expected - work.count.counted).toLocaleString()}`}</>}</Link>
                <span className="text-secondary-ink"> · {agoLabel(work.count.ts)}</span>
                {work.count.counted !== lot.head_count && (
                  <button type="button" disabled={status === 'saving'} onClick={() => void setHeadFromCount(lot, work.count!.counted)} className="ml-3 inline-flex min-h-[44px] items-center rounded-lg border border-forest-green/40 px-3 font-dm-sans text-[15px] font-semibold text-forest-green disabled:opacity-50" data-audit="lot-change-to-count">
                    Change bunch to {work.count.counted.toLocaleString()}?
                  </button>
                )}
              </p>
            )}
            {work && (work.bales != null || work.what) && (
              <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="lot-last-work">
                Last recorded work: <Link href={`/ranch/activity/${work.eventId}`} className="underline underline-offset-2">{work.what ? `${work.what}${work.head != null ? ` ${work.head.toLocaleString('en-US')} head` : ''}` : work.bales != null ? `fed ${work.bales} ${work.bales === 1 ? 'bale' : 'bales'}` : 'fed hay'} · {new Date(work.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' })}</Link>
              </p>
            )}
            <p className="mt-1">
              {/* Block 40: Markets prices followed bunches only. A bunch not yet
                  followed is followed by this tap, then shown — one tap, no
                  detour through a list. */}
              {followedIds.has(lot.id)
                ? <Link href={`/markets?lot=${lot.id}`} className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="lot-market-link" data-followed="true">Markets →</Link>
                : <button type="button" onClick={() => void followThenGo(lot.id)} className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="lot-market-link" data-followed="false">Follow on Markets →</button>}
            </p>
          </div>
          <div className="relative flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => openEdit(lot)} className="inline-flex min-h-[44px] items-center px-2 font-dm-sans text-[16px] font-medium text-accent hover:text-brand" data-audit="lot-fix">
              Fix
            </button>
          </div>
        </div>
      </Card>
      </RowActions>
    )
  }
  // ── Render ──────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mt-8 space-y-3">
        {[0, 1, 2].map(i => <div key={i} className="h-20 rounded-xl bg-accent/[0.06]" />)}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mt-8">
        <Card shadow="none" className="border-warning/30 bg-warning/[0.06] px-4 py-3">
          <p className="font-dm-sans text-[16px] text-warning">{loadError}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="mt-8 space-y-4">
      {status === 'saved' && (
        <p className="font-dm-sans text-[16px] font-medium text-up">Saved ✓</p>
      )}

      {lots.length === 0 && editing !== 'new' && (
        <Card shadow="soft" className="px-6 py-10 text-center">
          <p className="font-fraunces text-xl font-semibold text-ink">Add your first bunch</p>
          <p className="mx-auto mt-2 max-w-sm font-dm-sans text-[16px] text-secondary-ink">
            Tell us what you&rsquo;re running — a class, a head count, an average weight. A few
            seconds a lot, and you can sharpen the details later.
          </p>
          <div className="mt-5">
            <Button variant="primary" onClick={openAdd} className="w-full min-h-[56px]" data-audit="new-bunch-button">New bunch</Button>
          </div>
        </Card>
      )}

      {/* Block 15 (ruling 8): Add is one button, at the top, saying what it makes. */}
      {editing === null && lots.length > 0 && (
        <Button variant="primary" onClick={openAdd} className="w-full min-h-[56px]" data-audit="new-bunch-button">New bunch</Button>
      )}

      {editing === 'new' && renderEditor()}

      {lots.length > 0 && (
        <div className="space-y-4">
          {lots.map(lot => (editing === lot.id ? <div key={lot.id}>{renderEditor()}</div> : renderRow(lot)))}
        </div>
      )}
    </div>
  )
}
