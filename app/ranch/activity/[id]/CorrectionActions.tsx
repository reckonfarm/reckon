'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { navigateTo } from '@/lib/standalone-nav'
import { newEventId } from '@/lib/outbox'
import { LIMITS } from '@/lib/manual-log'
import { warning } from '@/lib/brand-colors'

// ─── Correct this entry · Void this entry (Block 5B, rebuilt Block 6 · 6A) ────
// From an event that currently stands. A correction is a crossed-out number on
// paper: the draft starts as the WHOLE original — every value, every stored
// reference — and the save sends only what changed (a field-level patch; the
// server keeps everything else). Three rules the Sept 8 audit wrote:
//   · The form holds until the lot and place names resolve. A slow option
//     load never rewrites a stored id; the id is the draft, the list only
//     names it.
//   · A reference the ranch's lists no longer name is UNRESOLVED, shown as
//     such, and kept. It is not permission to clear the field.
//   · The only path to "no lot" / "no place" is the explicit Clear action.
//   · The reason is part of the record: a new reason alone is a correction.
// Saving posts ONE superseding row (client-minted id, so a retry never lands
// twice) and lands on the new entry, which shows both values, who changed it,
// when, and the reason. The original stays where it was, marked. A void asks
// only why.

interface Option { id: string; name: string; retired?: boolean }
type Options = { state: 'loading' } | { state: 'ready'; places: Option[]; lots: Option[] } | { state: 'failed' }
export interface Editable {
  id: string
  type: string
  ts: string                 // ISO work time
  values: Record<string, unknown>
  reason?: string | null     // the reason this entry (itself a correction) carries — a new reason alone is a correction
}

const REF_KEYS = ['herd_lot_id', 'place_id', 'from_place_id', 'to_place_id'] as const
type RefKey = typeof REF_KEYS[number]
const NUM_KEYS = ['bales', 'inches', 'count', 'head'] as const
type NumKey = typeof NUM_KEYS[number]
type Draft = Record<RefKey | NumKey | 'what' | 'as_of' | 'date' | 'time' | 'reason', string>

const inputCls = 'mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink disabled:opacity-70'
const labelCls = 'block font-dm-sans text-[14px] font-medium text-secondary-ink'
const hintCls = 'mt-1 font-dm-sans text-[14px] text-secondary-ink'
const clearCls = 'mt-1 inline-flex min-h-[44px] items-center rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[14px] font-semibold text-ink'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '')

// Work time as the phone's local date + time fields (America/Denver is the
// ranch; the phone is on the ranch). Only sent when one of them changed, so an
// untouched work time keeps its seconds.
function localParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

function fromOriginal(event: Editable): Draft {
  const v = event.values, t = localParts(event.ts)
  return {
    bales: num(v.bales), inches: num(v.inches), count: num(v.count), head: num(v.head),
    what: str(v.what), as_of: str(v.as_of),
    herd_lot_id: str(v.herd_lot_id), place_id: str(v.place_id), from_place_id: str(v.from_place_id), to_place_id: str(v.to_place_id),
    date: t.date, time: t.time, reason: '',
  }
}

export default function CorrectionActions({ event }: { event: Editable }) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'correct' | 'void' | 'delete'>('idle')
  // 7D: what deleting THIS entry would do, asked before the sheet can say it.
  // Loaded when the sheet opens, never guessed on the client — the answer
  // depends on whether another member has read the ledger since it landed.
  const [plan, setPlan] = useState<{ state: 'loading' } | { state: 'failed' } | { state: 'ready'; mode: 'hard' | 'record' | 'unavailable'; reason: string | null; label: string }>({ state: 'loading' })
  const [draft, setDraft] = useState<Draft>(() => fromOriginal(event))
  const [options, setOptions] = useState<Options>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clientId] = useState(() => newEventId())
  const v = event.values
  const initial = localParts(event.ts)
  const set = (k: keyof Draft, value: string) => setDraft(d => ({ ...d, [k]: value }))

  useEffect(() => {
    if (mode !== 'delete') return
    let cancelled = false
    // No synchronous setState here: the initial state is already 'loading',
    // and on a re-open the previous answer holds for the moment the fetch
    // takes rather than flashing back to "checking". The outcome does not
    // depend on it either way — DELETE re-plans on the server.
    fetch(`/api/activity/${event.id}/delete`)
      .then(r => (r.ok ? r.json() : null))
      .then((j: { plan?: { mode: 'hard' | 'record' | 'unavailable'; reason: string | null; label: string } } | null) => {
        if (cancelled) return
        setPlan(j?.plan ? { state: 'ready', ...j.plan } : { state: 'failed' })
      })
      .catch(() => { if (!cancelled) setPlan({ state: 'failed' }) })
    return () => { cancelled = true }
  }, [mode, event.id])

  useEffect(() => {
    if (mode !== 'correct') return
    let cancelled = false
    setOptions({ state: 'loading' })
    fetch('/api/activity/options').then(r => (r.ok ? r.json() : null))
      .then((j: { places?: Option[]; lots?: Option[] } | null) => { if (!cancelled) setOptions(j ? { state: 'ready', places: j.places ?? [], lots: j.lots ?? [] } : { state: 'failed' }) })
      .catch(() => { if (!cancelled) setOptions({ state: 'failed' }) })
    return () => { cancelled = true }
  }, [mode])

  // The patch: only the keys whose draft differs from the original. A cleared
  // reference is an explicit null; an untouched one is not in the body at all.
  function patch(): Record<string, unknown> {
    const p: Record<string, unknown> = {}
    const numKey = (k: NumKey) => { if (draft[k] !== '' && Number(draft[k]) !== v[k]) p[k] = Number(draft[k]) }
    const refKey = (k: RefKey) => { if (draft[k] !== str(v[k])) p[k] = draft[k] || null }
    switch (event.type) {
      case 'hay_fed': numKey('bales'); refKey('herd_lot_id'); refKey('place_id'); break
      case 'rain': numKey('inches'); refKey('place_id'); break
      case 'bales_stacked': numKey('count'); refKey('place_id'); break
      case 'hay_inventory': numKey('bales'); if (draft.as_of && draft.as_of !== str(v.as_of)) p.as_of = draft.as_of; refKey('place_id'); break
      case 'cattle_moved': numKey('head'); refKey('herd_lot_id'); refKey('from_place_id'); refKey('to_place_id'); break
      case 'cattle_worked': numKey('head'); if (draft.what.trim() && draft.what !== str(v.what)) p.what = draft.what; refKey('herd_lot_id'); refKey('place_id'); break
    }
    if (draft.date && draft.time && (draft.date !== initial.date || draft.time !== initial.time)) p.ts = new Date(`${draft.date}T${draft.time}:00`).toISOString()
    return p
  }

  async function remove() {
    setError(null); setBusy(true)
    try {
      const res = await fetch(`/api/activity/${event.id}/delete`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({})) as { mode?: string; error?: string }
      if (!res.ok) { setError(json.error ?? 'That entry could not be deleted just now'); setBusy(false); return }
      // Gone from here either way, so there is nothing to return to.
      router.push('/ranch/activity')
      router.refresh()
    } catch {
      setError('That entry could not be deleted just now'); setBusy(false)
    }
  }

  async function submit(kind: 'correct' | 'void') {
    setError(null)
    const body: Record<string, unknown> = { id: clientId, reason: draft.reason }
    if (kind === 'correct') {
      const p = patch()
      if (Object.keys(p).length === 0 && draft.reason.trim() === (event.reason ?? '').trim()) { setError('Nothing changed — change a value, the time, or the reason; or cancel.'); return }
      Object.assign(body, p)
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/activity/${event.id}/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({})) as { event?: { id: string }; error?: string }
      if (!res.ok || !json.event) { setError(json.error ?? `Could not save (${res.status})`); setBusy(false); return }
      navigateTo(router, `/ranch/activity/${json.event.id}?saved=1`)
    } catch {
      setError('No connection — the entry is unchanged. Try again when you have signal.'); setBusy(false)
    }
  }

  // A stored reference, named by the list once it loads. The stored id is the
  // draft from the first render; the list only labels it. While the names load
  // the control is held; if they never come, the id stays as recorded.
  const refSelect = (key: RefKey, label: string, kind: 'lot' | 'place') => {
    const stored = str(v[key]), value = draft[key]
    const list = options.state === 'ready' ? (kind === 'lot' ? options.lots : options.places) : []
    const resolved = list.find(o => o.id === value)
    const unresolved = options.state === 'ready' && value !== '' && !resolved
    const held = options.state !== 'ready'
    return (
      <div key={key}>
        <label className={labelCls}>{label}
          <select name={key} value={value} disabled={held} onChange={e => set(key, e.target.value)} className={inputCls} data-audit={`correction-${key}`} data-resolved={unresolved ? 'no' : resolved ? 'yes' : 'pending'}>
            {held && value !== '' && <option value={value}>{options.state === 'loading' ? `Loading ${kind} names…` : `Stored ${kind} (names unavailable)`}</option>}
            {unresolved && <option value={value}>Unresolved {kind} · {value.slice(0, 8)}</option>}
            {(value === '' || held) && <option value="">No {kind}</option>}
            {!held && list.map(o => <option key={o.id} value={o.id}>{o.name}{o.retired ? ' · retired' : ''}</option>)}
          </select>
        </label>
        {unresolved && <p className={hintCls} data-audit={`correction-unresolved-${key}`}>This {kind} isn&apos;t on the ranch&apos;s list now (removed or renamed). It stays on the entry unless you clear it.</p>}
        {resolved?.retired && <p className={hintCls}>A retired {kind}. It stays on the entry unless you clear it.</p>}
        {value === '' && stored !== '' && <p className={hintCls} data-audit={`correction-cleared-${key}`}>Cleared — the correction will carry no {kind}.</p>}
        {value !== '' && !held && <button type="button" onClick={() => set(key, '')} className={clearCls} data-audit={`correction-clear-${key}`}>Clear {kind}</button>}
      </div>
    )
  }

  if (mode === 'idle') {
    return (
      <div className="mt-5 flex flex-wrap gap-3" data-audit="correction-actions">
        <button type="button" onClick={() => setMode('correct')} className="inline-flex min-h-[48px] items-center rounded-lg bg-brand px-4 font-dm-sans text-[16px] font-semibold text-on-brand" data-audit="correct-entry">Correct this entry</button>
        <button type="button" onClick={() => setMode('void')} className="inline-flex min-h-[48px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink" data-audit="void-entry">Void this entry</button>
        <button type="button" onClick={() => setMode('delete')} className="inline-flex min-h-[48px] items-center rounded-lg border px-4 font-dm-sans text-[16px] font-semibold" style={{ color: warning, borderColor: warning }} data-audit="delete-entry">Delete this entry</button>
      </div>
    )
  }

  // ── The delete confirm (7D.1) ───────────────────────────────────────────────
  // It names WHAT is being deleted, and on the record path says in one plain
  // sentence that the record keeps it. It never shows a database error: the
  // route answers with a plan, and a plan that cannot be fetched disables the
  // button rather than guessing which path a tap would take.
  if (mode === 'delete') {
    const ready = plan.state === 'ready' ? plan : null
    return (
      <div className="mt-5 rounded-xl border p-4" style={{ borderColor: warning }} data-audit="delete-form">
        <p className="font-dm-sans text-[17px] font-semibold text-ink" data-audit="delete-title">
          Delete {ready ? ready.label.toLowerCase() : 'this entry'}?
        </p>

        {plan.state === 'loading' && (
          <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="delete-checking">Checking what this will do…</p>
        )}
        {plan.state === 'failed' && (
          <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="delete-unknown">
            This can&rsquo;t be checked just now, so it isn&rsquo;t offered. Try again in a moment.
          </p>
        )}

        {ready?.mode === 'unavailable' && (
          <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="delete-consequence" data-mode="unavailable">
            Deleting isn&rsquo;t switched on for this ranch yet. Correct or void the entry instead —
            both are available now.
          </p>
        )}
        {ready?.mode === 'hard' && (
          <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="delete-consequence" data-mode="hard">
            It will be gone, and every total recalculated without it. Nothing is kept.
          </p>
        )}
        {ready?.mode === 'record' && (
          <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="delete-consequence" data-mode="record">
            It will be gone from your Activity. The record keeps that you deleted it, and when
            {ready.reason ? ` — ${ready.reason}` : ''}.
          </p>
        )}

        {error && <p className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} role="alert" data-audit="delete-error">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled={busy || !ready || ready.mode === 'unavailable'} onClick={() => void remove()}
            className="inline-flex min-h-[52px] items-center rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50"
            style={{ backgroundColor: warning }} data-audit="delete-confirm">
            {busy ? 'Deleting…' : 'Delete it'}
          </button>
          <button type="button" disabled={busy} onClick={() => { setMode('idle'); setError(null) }}
            className="inline-flex min-h-[52px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[17px] font-semibold text-ink"
            data-audit="delete-cancel">
            Keep it
          </button>
        </div>
      </div>
    )
  }

  const holding = mode === 'correct' && options.state === 'loading'
  const numInput = (key: NumKey, label: string, lim: { min: number; max: number }, extra: Record<string, string> = {}) => (
    <label className={labelCls}>{label}<input name={key} type="number" min={lim.min} max={lim.max} value={draft[key]} onChange={e => set(key, e.target.value)} className={inputCls} required {...extra} /></label>
  )

  return (
    <form className="mt-5 rounded-xl border border-rule bg-surface p-4" onSubmit={e => { e.preventDefault(); void submit(mode as 'correct' | 'void') }} data-audit={`${mode}-form`}>
      <p className="font-dm-sans text-[17px] font-semibold text-ink">{mode === 'correct' ? 'What was it really?' : 'Void this entry?'}</p>
      <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink">
        {mode === 'correct'
          ? 'The original stays on the record, crossed out. Your correction stands in its place and every balance follows it. What you leave alone stays exactly as recorded.'
          : 'The entry stays on the record, marked void, and stops counting. Nothing is deleted.'}
      </p>
      {mode === 'correct' && (
        <p className={hintCls} role="status" data-audit="correction-options" data-state={options.state}>
          {options.state === 'loading' ? 'Loading lot and place names…' : options.state === 'failed' ? 'Lot and place names couldn’t load — those stay as recorded. You can still correct the other values.' : ''}
        </p>
      )}
      {mode === 'correct' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {event.type === 'hay_fed' && numInput('bales', 'Bales', LIMITS.bales, { inputMode: 'numeric' })}
          {event.type === 'hay_fed' && refSelect('herd_lot_id', 'Fed to', 'lot')}
          {event.type === 'rain' && numInput('inches', 'Inches', LIMITS.inches, { inputMode: 'decimal', step: '0.01' })}
          {event.type === 'bales_stacked' && numInput('count', 'Bales stacked', LIMITS.count, { inputMode: 'numeric' })}
          {event.type === 'hay_inventory' && numInput('bales', 'Bales on hand', LIMITS.onHand, { inputMode: 'numeric' })}
          {event.type === 'hay_inventory' && <label className={labelCls}>Counted as of<input name="as_of" type="date" value={draft.as_of} onChange={e => set('as_of', e.target.value)} className={inputCls} required /></label>}
          {(event.type === 'cattle_moved' || event.type === 'cattle_worked') && numInput('head', 'Head', LIMITS.head, { inputMode: 'numeric' })}
          {(event.type === 'cattle_moved' || event.type === 'cattle_worked') && refSelect('herd_lot_id', 'Lot', 'lot')}
          {event.type === 'cattle_worked' && <label className={labelCls}>What was done<input name="what" type="text" maxLength={LIMITS.what.maxLen} value={draft.what} onChange={e => set('what', e.target.value)} className={inputCls} required /></label>}
          {event.type === 'cattle_moved' ? (<>{refSelect('from_place_id', 'From', 'place')}{refSelect('to_place_id', 'To', 'place')}</>) : refSelect('place_id', 'Place', 'place')}
          <label className={labelCls}>Work date<input name="date" type="date" value={draft.date} onChange={e => set('date', e.target.value)} className={inputCls} required /></label>
          <label className={labelCls}>Work time<input name="time" type="time" value={draft.time} onChange={e => set('time', e.target.value)} className={inputCls} required /></label>
        </div>
      )}
      <label className={`${labelCls} mt-3`}>{mode === 'correct' ? 'What changed, and why' : 'Why'}
        <input name="reason" type="text" maxLength={500} value={draft.reason} onChange={e => set('reason', e.target.value)} placeholder={mode === 'correct' ? 'e.g. was 4, typed 6' : 'e.g. logged on the wrong ranch'} className={inputCls} data-audit="correction-reason" />
      </label>
      {error && <p className="mt-3 font-dm-sans text-[16px] font-semibold text-rust" role="alert" data-audit="correction-error">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" disabled={busy || holding} className="inline-flex min-h-[48px] items-center rounded-lg bg-brand px-4 font-dm-sans text-[16px] font-semibold text-on-brand disabled:opacity-60" data-audit="correction-save">{busy ? 'Saving…' : holding ? 'Loading names…' : mode === 'correct' ? 'Save correction' : 'Void it'}</button>
        <button type="button" disabled={busy} onClick={() => { setMode('idle'); setError(null); setDraft(fromOriginal(event)) }} className="inline-flex min-h-[48px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink">Cancel</button>
      </div>
    </form>
  )
}
