'use client'

import { useEffect, useState } from 'react'
import { LOT_CLASSES, LOT_CLASS_LABELS, LOT_NAME_MAX, type Lot, type LotClass } from '@/lib/herd'
import { warning } from '@/lib/brand-colors'

// ─── A bunch, made on the spot (Block 14) ─────────────────────────────────────
//
// Inside any cattle flow — the feeding sheet's "Fed to", a move, cattle work,
// a count, the chute — "New bunch" opens this and nothing else: name, head
// count, class, and where it is. No weight (nobody knows one in a corral —
// the market cards say "no weight set" until someone does), no frame, no sale
// windows. Save posts the bunch and hands it back to the flow it was opened
// from, already picked. The person never leaves what they were doing.
//
// Needs the network: a bunch is a row other entries name, so it cannot wait in
// the outbox the way an entry can. A failed save says so and keeps every field.

interface PlaceOption { id: string; name: string; kind: string }

const chip = (on: boolean) => `min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${on ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`

export default function NewBunchInline({ onMade, onCancel, defaultClass = null, defaultName = '', defaultHead = '', title = 'New bunch' }: {
  onMade: (lot: Lot) => void
  onCancel: () => void
  defaultClass?: LotClass | null
  defaultName?: string
  defaultHead?: string
  title?: string
}) {
  const [name, setName] = useState(defaultName)
  const [head, setHead] = useState(defaultHead)
  const [klass, setKlass] = useState<LotClass | null>(defaultClass)
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [places, setPlaces] = useState<PlaceOption[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/places').then(r => (r.ok ? r.json() : { places: [] })).then(j => { if (alive) setPlaces((j.places ?? []) as PlaceOption[]) }).catch(() => { if (alive) setPlaces([]) })
    return () => { alive = false }
  }, [])

  const headNum = Number(head)
  const valid = klass !== null && /^\d+$/.test(head.trim()) && headNum > 0 && headNum <= 20000

  async function save() {
    if (!valid || !klass) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/herd/lots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), class: klass, head_count: headNum, weight_unit: 'lb', ...(placeId ? { place_id: placeId } : {}) }),
      })
      const j = await res.json().catch(() => ({})) as { lot?: Lot; error?: string }
      if (!res.ok || !j.lot) { setError(j.error ?? 'That bunch could not be saved just now.'); return }
      onMade(j.lot)
    } catch {
      setError('No signal. A new bunch needs one — pick an existing bunch.')
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-forest-green/20 bg-forest-green/[0.03] p-4" data-audit="new-bunch">
      <p className="font-dm-sans text-[17px] font-semibold text-ink">{title}</p>

      <label className="mt-3 block font-dm-sans text-[14px] font-medium text-secondary-ink" htmlFor="new-bunch-name">Name
        <input id="new-bunch-name" value={name} onChange={e => setName(e.target.value.slice(0, LOT_NAME_MAX))} maxLength={LOT_NAME_MAX} placeholder="Optional — what you call them" className="mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink" data-audit="new-bunch-name" />
      </label>

      <label className="mt-3 block font-dm-sans text-[14px] font-medium text-secondary-ink" htmlFor="new-bunch-head">Head count
        <input id="new-bunch-head" type="number" inputMode="numeric" min={1} max={20000} step={1} value={head} onChange={e => setHead(e.target.value)} placeholder="e.g. 120" className="mt-1 block w-full min-h-[52px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[20px] tabular-nums text-ink" data-audit="new-bunch-head" />
      </label>

      <p className="mt-3 font-dm-sans text-[14px] font-medium text-secondary-ink" id="new-bunch-class">Class</p>
      <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="new-bunch-class" data-audit="new-bunch-class">
        {LOT_CLASSES.map(c => (
          <button key={c} type="button" role="radio" aria-checked={klass === c} onClick={() => setKlass(c)} className={chip(klass === c)} data-audit={`new-bunch-class-${c}`}>{LOT_CLASS_LABELS[c]}</button>
        ))}
      </div>

      {places !== null && places.length > 0 && (
        <>
          <p className="mt-3 font-dm-sans text-[14px] font-medium text-secondary-ink" id="new-bunch-place">Where they are <span className="font-normal">· optional</span></p>
          <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="new-bunch-place" data-audit="new-bunch-place">
            <button type="button" role="radio" aria-checked={placeId === null} onClick={() => setPlaceId(null)} className={chip(placeId === null)}>Not said</button>
            {places.map(p => (
              <button key={p.id} type="button" role="radio" aria-checked={placeId === p.id} onClick={() => setPlaceId(p.id)} className={chip(placeId === p.id)} data-audit="new-bunch-place-option">{p.name}</button>
            ))}
          </div>
        </>
      )}

      {error && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="new-bunch-error">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !valid} onClick={() => void save()} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50" data-audit="new-bunch-save">
          {busy ? 'Saving…' : 'Add this bunch'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2 disabled:opacity-50" data-audit="new-bunch-cancel">Cancel</button>
      </div>
    </div>
  )
}
