'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { navigateTo } from '@/lib/standalone-nav'
import { newEventId } from '@/lib/outbox'
import { LIMITS } from '@/lib/manual-log'

// ─── Correct this entry · Void this entry (Block 5B) ─────────────────────────
// From an event that currently stands. The correction form pre-fills the
// original's values and asks what changed and why; a void asks only why.
// Saving posts ONE superseding row (client-minted id, so a retry never lands
// twice) and lands on the new entry, which shows both values, who changed it,
// when, and the reason. The original stays where it was, marked.

interface Option { id: string; name: string }
export interface Editable {
  id: string
  type: string
  ts: string                 // ISO work time
  values: Record<string, unknown>
}

const inputCls = 'mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink'
const labelCls = 'block font-dm-sans text-[14px] font-medium text-secondary-ink'

// Work time as the phone's local date + time fields (America/Denver is the
// ranch; the phone is on the ranch).
function localParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

export default function CorrectionActions({ event }: { event: Editable }) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'correct' | 'void'>('idle')
  const [places, setPlaces] = useState<Option[]>([])
  const [lots, setLots] = useState<Option[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clientId] = useState(() => newEventId())
  const initial = localParts(event.ts)
  const v = event.values

  useEffect(() => {
    if (mode !== 'correct') return
    fetch('/api/activity/options').then(r => (r.ok ? r.json() : null)).then(j => { if (j) { setPlaces(j.places ?? []); setLots(j.lots ?? []) } }).catch(() => {})
  }, [mode])

  async function submit(kind: 'correct' | 'void', form: FormData) {
    setBusy(true); setError(null)
    const body: Record<string, unknown> = { id: clientId, reason: String(form.get('reason') ?? '') }
    if (kind === 'correct') {
      const date = String(form.get('date') ?? ''), time = String(form.get('time') ?? '')
      if (date && time) body.ts = new Date(`${date}T${time}:00`).toISOString()
      const numField = (k: string) => { const raw = form.get(k); if (raw != null && raw !== '') body[k] = Number(raw) }
      const strField = (k: string) => { if (form.has(k)) body[k] = String(form.get(k) ?? '') || null }
      switch (event.type) {
        case 'hay_fed': numField('bales'); strField('herd_lot_id'); strField('place_id'); break
        case 'rain': numField('inches'); strField('place_id'); break
        case 'bales_stacked': numField('count'); strField('place_id'); break
        case 'hay_inventory': numField('bales'); if (form.get('as_of')) body.as_of = String(form.get('as_of')); strField('place_id'); break
        case 'cattle_moved': numField('head'); strField('from_place_id'); strField('to_place_id'); break
        case 'cattle_worked': numField('head'); if (form.has('what')) body.what = String(form.get('what') ?? ''); strField('place_id'); break
      }
    }
    try {
      const res = await fetch(`/api/activity/${event.id}/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({})) as { event?: { id: string }; error?: string }
      if (!res.ok || !json.event) { setError(json.error ?? `Could not save (${res.status})`); setBusy(false); return }
      navigateTo(router, `/ranch/activity/${json.event.id}?saved=1`)
    } catch {
      setError('No connection — the entry is unchanged. Try again when you have signal.'); setBusy(false)
    }
  }

  const placeSelect = (name: string, current: unknown, label = 'Place') => (
    <label className={labelCls}>{label}
      <select name={name} defaultValue={typeof current === 'string' ? current : ''} className={inputCls}>
        <option value="">No place</option>
        {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  )

  if (mode === 'idle') {
    return (
      <div className="mt-5 flex flex-wrap gap-3" data-audit="correction-actions">
        <button type="button" onClick={() => setMode('correct')} className="inline-flex min-h-[48px] items-center rounded-lg bg-brand px-4 font-dm-sans text-[16px] font-semibold text-on-brand" data-audit="correct-entry">Correct this entry</button>
        <button type="button" onClick={() => setMode('void')} className="inline-flex min-h-[48px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink" data-audit="void-entry">Void this entry</button>
      </div>
    )
  }

  return (
    <form className="mt-5 rounded-xl border border-rule bg-surface p-4" onSubmit={e => { e.preventDefault(); void submit(mode, new FormData(e.currentTarget)) }} data-audit={`${mode}-form`}>
      <p className="font-dm-sans text-[17px] font-semibold text-ink">{mode === 'correct' ? 'What was it really?' : 'Void this entry?'}</p>
      <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink">
        {mode === 'correct'
          ? 'The original stays on the record, crossed out. Your correction stands in its place and every balance follows it.'
          : 'The entry stays on the record, marked void, and stops counting. Nothing is deleted.'}
      </p>
      {mode === 'correct' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {event.type === 'hay_fed' && <label className={labelCls}>Bales<input name="bales" type="number" inputMode="numeric" min={LIMITS.bales.min} max={LIMITS.bales.max} defaultValue={typeof v.bales === 'number' ? v.bales : ''} className={inputCls} required /></label>}
          {event.type === 'hay_fed' && (
            <label className={labelCls}>Fed to
              <select name="herd_lot_id" defaultValue={typeof v.herd_lot_id === 'string' ? v.herd_lot_id : ''} className={inputCls}>
                <option value="">No lot</option>
                {lots.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
          {event.type === 'rain' && <label className={labelCls}>Inches<input name="inches" type="number" inputMode="decimal" step="0.01" min={LIMITS.inches.min} max={LIMITS.inches.max} defaultValue={typeof v.inches === 'number' ? v.inches : ''} className={inputCls} required /></label>}
          {event.type === 'bales_stacked' && <label className={labelCls}>Bales stacked<input name="count" type="number" inputMode="numeric" min={LIMITS.count.min} max={LIMITS.count.max} defaultValue={typeof v.count === 'number' ? v.count : ''} className={inputCls} required /></label>}
          {event.type === 'hay_inventory' && <label className={labelCls}>Bales on hand<input name="bales" type="number" inputMode="numeric" min={LIMITS.onHand.min} max={LIMITS.onHand.max} defaultValue={typeof v.bales === 'number' ? v.bales : ''} className={inputCls} required /></label>}
          {event.type === 'hay_inventory' && <label className={labelCls}>Counted as of<input name="as_of" type="date" defaultValue={typeof v.as_of === 'string' ? v.as_of : ''} className={inputCls} required /></label>}
          {(event.type === 'cattle_moved' || event.type === 'cattle_worked') && <label className={labelCls}>Head<input name="head" type="number" inputMode="numeric" min={LIMITS.head.min} max={LIMITS.head.max} defaultValue={typeof v.head === 'number' ? v.head : ''} className={inputCls} required /></label>}
          {event.type === 'cattle_worked' && <label className={labelCls}>What was done<input name="what" type="text" maxLength={LIMITS.what.maxLen} defaultValue={typeof v.what === 'string' ? v.what : ''} className={inputCls} required /></label>}
          {event.type === 'cattle_moved' ? (<>{placeSelect('from_place_id', v.from_place_id, 'From')}{placeSelect('to_place_id', v.to_place_id, 'To')}</>) : placeSelect('place_id', v.place_id)}
          <label className={labelCls}>Work date<input name="date" type="date" defaultValue={initial.date} className={inputCls} required /></label>
          <label className={labelCls}>Work time<input name="time" type="time" defaultValue={initial.time} className={inputCls} required /></label>
        </div>
      )}
      <label className={`${labelCls} mt-3`}>{mode === 'correct' ? 'What changed, and why' : 'Why'}
        <input name="reason" type="text" maxLength={500} placeholder={mode === 'correct' ? 'e.g. was 4, typed 6' : 'e.g. logged on the wrong ranch'} className={inputCls} data-audit="correction-reason" />
      </label>
      {error && <p className="mt-3 font-dm-sans text-[16px] font-semibold text-rust" role="alert" data-audit="correction-error">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="inline-flex min-h-[48px] items-center rounded-lg bg-brand px-4 font-dm-sans text-[16px] font-semibold text-on-brand disabled:opacity-60" data-audit="correction-save">{busy ? 'Saving…' : mode === 'correct' ? 'Save correction' : 'Void it'}</button>
        <button type="button" disabled={busy} onClick={() => { setMode('idle'); setError(null) }} className="inline-flex min-h-[48px] items-center rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[16px] font-semibold text-ink">Cancel</button>
      </div>
    </form>
  )
}
