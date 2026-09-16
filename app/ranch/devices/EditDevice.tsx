'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/app/components/ui/Card'
import { warning } from '@/lib/brand-colors'
import { deleteWithUndo, callDelete, restoreFromTrash, showNotice } from '@/lib/undo'

// ─── Fix a device (Block 13) ──────────────────────────────────────────────────
// What a person can fix on a device, and only that: its NAME (set once at
// registration, never written by the device again) and WHERE IT SITS (the
// place, which has only ever been a person's to say). The form names what the
// device sets itself — hardware id, type, battery, firmware, last report — as
// facts, not boxes, so nobody types into a field that the next report would
// overwrite.
//
// Delete is one tap and goes to the trash; the strip offers Undo for ten
// seconds. No confirm.

interface PlaceOption { id: string; name: string; kind: string }

export default function EditDevice({ device }: { device: { id: string; name: string; placeId: string | null; hardwareId: string; type: string; fwVersion: string | null; batteryPct: number | null; lastSeen: string | null } }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(device.name)
  const [placeId, setPlaceId] = useState<string | null>(device.placeId)
  const [places, setPlaces] = useState<PlaceOption[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A row held for Fix lands here with the form open (#fix-<id>) — on a
  // fresh page load, and on a hash change when the row is on this same page.
  useEffect(() => {
    const want = `#fix-${device.id}`
    const check = () => { if (window.location.hash === want) { setOpen(true); document.getElementById(`device-${device.id}-fix`)?.scrollIntoView({ block: 'center' }) } }
    const t = setTimeout(check, 0)
    window.addEventListener('hashchange', check)
    return () => { clearTimeout(t); window.removeEventListener('hashchange', check) }
  }, [device.id])
  useEffect(() => {
    if (!open || places !== null) return
    let alive = true
    fetch('/api/places').then(r => (r.ok ? r.json() : { places: [] })).then(j => { if (alive) setPlaces((j.places ?? []) as PlaceOption[]) }).catch(() => { if (alive) setPlaces([]) })
    return () => { alive = false }
  }, [open, places])

  async function save() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/devices/${device.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), place_id: placeId }) })
      const j = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(j.error ?? 'That could not be saved just now.'); return }
      setOpen(false)
      router.refresh()
    } catch { setError('No signal — nothing changed.') }
    finally { setBusy(false) }
  }

  async function remove() {
    setBusy(true)
    const r = await deleteWithUndo({ label: device.name, run: () => callDelete(`/api/devices/${device.id}`, { method: 'DELETE' }), undo: restoreFromTrash('devices', device.id) })
    setBusy(false)
    if (!r.ok) { showNotice(r.error); return }
    router.refresh()
  }

  if (!open) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-[44px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="device-fix-open">
          Fix name or where it sits
        </button>
        <button type="button" disabled={busy} onClick={() => void remove()} className="inline-flex min-h-[44px] items-center font-dm-sans text-[16px] font-semibold underline underline-offset-2 disabled:opacity-50" style={{ color: warning }} data-audit="device-delete">
          {busy ? 'Deleting…' : 'Delete this device'}
        </button>
      </div>
    )
  }

  const chip = (on: boolean) => `min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${on ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`
  return (
    <Card className="mt-3 border-forest-green/20 p-4" data-audit="device-fix" id={`device-${device.id}-fix`}>
      <label className="block font-dm-sans text-[14px] font-medium text-secondary-ink" htmlFor={`device-name-${device.id}`}>Name
        <input id={`device-name-${device.id}`} value={name} onChange={e => setName(e.target.value.slice(0, 60))} maxLength={60} className="mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink" data-audit="device-fix-name" />
      </label>

      <p className="mt-4 font-dm-sans text-[14px] font-medium text-secondary-ink" id={`device-place-${device.id}`}>Where it sits</p>
      {places === null ? (
        <p className="mt-2 font-dm-sans text-[15px] text-secondary-ink">Loading your places…</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`device-place-${device.id}`} data-audit="device-fix-place">
          <button type="button" role="radio" aria-checked={placeId === null} onClick={() => setPlaceId(null)} className={chip(placeId === null)}>Nowhere yet</button>
          {places.map(p => (
            <button key={p.id} type="button" role="radio" aria-checked={placeId === p.id} onClick={() => setPlaceId(p.id)} className={chip(placeId === p.id)} data-audit="device-fix-place-option">
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* What the device sets itself — facts, not boxes. */}
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="device-fix-fixed">
        <dt>Hardware ID</dt><dd className="text-ink">{device.hardwareId}</dd>
        <dt>Type</dt><dd className="text-ink">{device.type.replace(/_/g, ' ')}</dd>
        <dt>Battery</dt><dd className="text-ink">{device.batteryPct != null ? `${device.batteryPct}%` : 'Not reported'}</dd>
        <dt>Firmware</dt><dd className="text-ink">{device.fwVersion ?? 'Not reported'}</dd>
      </dl>
      <p className="mt-1 font-dm-sans text-[14px] text-secondary-ink">The device sets these on every report. They cannot be changed here.</p>

      {error && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="device-fix-error">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50" data-audit="device-fix-save">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" disabled={busy} onClick={() => { setName(device.name); setPlaceId(device.placeId); setError(null); setOpen(false) }} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2 disabled:opacity-50" data-audit="device-fix-cancel">
          Cancel
        </button>
      </div>
    </Card>
  )
}
