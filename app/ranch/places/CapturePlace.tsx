'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/app/components/ui/Card'
import { PLACE_KINDS, MAX_NAME, DEFAULT_KIND } from '@/lib/places/kinds'
import { warning } from '@/lib/brand-colors'
import {
  averagePosition, closeByHand, gapsIn, isOutlier, rideBoundary, rideOutcome,
  SETTLE_MAX_ACC_M,
} from '@/lib/places/capture'
import { useCapture } from './useCapture'

// ─── Capturing a place in the field (Block 8.1 · 8.2 · 8.3 · 8.4) ─────────────
//
// Two ways in, ONE kind of place out (8.5): a dropped point, a ridden
// perimeter and a tap-drawn shape all become an ordinary row in `places` with
// a GeoJSON polygon, and nothing downstream can tell which made it except by
// reading provenance — which is the point of recording provenance.
//
// DROP (8.1) is for the things a perimeter cannot describe: a stack, a gate, a
// tank. It averages the settled fixes and states the accuracy it is claiming.
// RIDE (8.2) is for enclosures, and reuses the swather's closure entirely.
// FINISH HERE (8.3) is the honest exit when the ground will not let you close
// — a creek, a cliff, the neighbour's fence — and it labels what it did.

type Mode = 'choose' | 'drop' | 'ride' | 'name'
type Pending =
  | { kind: 'point'; ring: { lat: number; lng: number }[]; accM: number; used: number }
  | { kind: 'ring'; ring: { lat: number; lng: number }[]; acres: number; snapped: boolean; byHand: boolean; status: string }

// A dropped point is stored as a tiny square around the fix, so a place is
// always a polygon and every reader stays the same (8.5). The half-width is
// the accuracy being claimed, so the shape is literally the uncertainty.
function squareAround(lat: number, lng: number, halfM: number): { lat: number; lng: number }[] {
  const dLat = halfM / 111_132
  const dLng = halfM / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [
    { lat: lat - dLat, lng: lng - dLng }, { lat: lat - dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng }, { lat: lat + dLat, lng: lng - dLng },
    { lat: lat - dLat, lng: lng - dLng },
  ]
}

const fmtAcres = (a: number) => (a >= 10 ? a.toFixed(1) : a.toFixed(2))

export default function CapturePlace() {
  const router = useRouter()
  const cap = useCapture()
  const [mode, setMode] = useState<Mode>('choose')
  const [pending, setPending] = useState<Pending | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<string>(DEFAULT_KIND)
  const [busy, setBusy] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [outcomeMsg, setOutcomeMsg] = useState<string | null>(null)
  const [offerDrop, setOfferDrop] = useState(false)

  const usable = useMemo(() => cap.fixes.filter(f => !isOutlier(f)), [cap.fixes])
  const gaps = useMemo(() => gapsIn(usable), [usable])
  const latest = cap.fixes[cap.fixes.length - 1] ?? null

  async function beginDrop() { setMode('drop'); setOutcomeMsg(null); await cap.start() }
  async function beginRide() { setMode('ride'); setOutcomeMsg(null); await cap.start() }

  async function takePoint() {
    const avg = averagePosition(usable.slice(-8))
    await cap.stop()
    if (!avg) { setOutcomeMsg('No usable fix yet — wait for the accuracy to settle.'); return }
    setPending({ kind: 'point', ring: squareAround(avg.lat, avg.lng, Math.max(2, avg.accM)), accM: avg.accM, used: avg.used })
    setMode('name')
  }

  async function finishRide(byHand: boolean) {
    const fixes = cap.fixes
    await cap.stop()
    if (byHand) {
      const hand = closeByHand(fixes)
      if (!hand) { setOutcomeMsg('Not enough of a ride to close by hand yet.'); return }
      setPending({ kind: 'ring', ring: hand.ring, acres: hand.acres, snapped: false, byHand: true, status: 'closed_by_hand' })
      setMode('name'); return
    }
    const r = rideBoundary(fixes)
    const o = rideOutcome(r, fixes)
    if (!r.boundary.polygon) { setOutcomeMsg(o.message); setOfferDrop(o.offerDrop); return }
    const ring = [...r.boundary.polygon, r.boundary.polygon[0]]
    setPending({ kind: 'ring', ring, acres: r.boundary.acres ?? 0, snapped: r.boundary.snapped, byHand: false, status: r.boundary.status })
    setMode('name')
  }

  async function save() {
    if (!pending || !name.trim()) return
    setBusy(true); setSaveErr(null)
    try {
      const res = await fetch('/api/places', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), kind,
          geometry: { type: 'Polygon', coordinates: [pending.ring.map(p => [p.lng, p.lat])] },
          capture: {
            source: pending.kind === 'point' ? 'dropped' : 'ridden',
            status: pending.kind === 'ring' ? pending.status : 'dropped',
            ...(pending.kind === 'ring' ? { snapped: pending.snapped, closedByHand: pending.byHand } : { accuracyM: pending.accM }),
            rejected: cap.rejected,
            gaps: gaps.map(g => ({ seconds: Math.round(g.seconds) })),
            track: usable.map(f => ({ t: Math.round(f.t / 1000), lat: +f.lat.toFixed(6), lng: +f.lng.toFixed(6), a: Math.round(f.acc * 10) / 10 })),
          },
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setSaveErr(String(j.error ?? 'That place could not be saved just now.')); setBusy(false); return }
      router.push('/ranch/places'); router.refresh()
    } catch {
      setSaveErr('That place could not be saved just now.'); setBusy(false)
    }
  }

  // ── the live banner every active mode shares ────────────────────────────────
  const live = (
    <>
      {/* 8.4 — the moment it happens, not discovered later. */}
      {cap.hiddenNow && (
        <p className="mt-3 rounded-lg px-3 py-2 font-dm-sans text-[16px] font-semibold text-cream" style={{ backgroundColor: warning }} role="alert" data-audit="capture-hidden">
          The screen went dark — nothing is being recorded. Wake it and keep going.
        </p>
      )}
      {cap.lastHiddenS != null && !cap.hiddenNow && (
        <p className="mt-2 font-dm-sans text-[15px] font-semibold" style={{ color: warning }} data-audit="capture-gap-notice">
          Recording paused {Math.round(cap.lastHiddenS)} s while the screen was dark. That stretch is missing and will not be guessed.
        </p>
      )}
      {(cap.wake === 'unsupported' || cap.wake === 'refused' || cap.wake === 'released') && (
        <p className="mt-2 font-dm-sans text-[15px] text-secondary-ink" data-audit="capture-wake">
          {cap.wake === 'released'
            ? 'The screen lock came back. Keep the phone awake and mounted.'
            : 'This phone will not let the app hold the screen awake — set the auto-lock long, and keep it mounted.'}
        </p>
      )}
      {!cap.settled ? (
        <p className="mt-3 font-dm-sans text-[17px] text-ink" data-audit="capture-settling">
          Getting a fix… {cap.settleProgress} of {cap.SETTLE_RUNS} steady readings
          {latest ? ` · ±${latest.acc.toFixed(0)} m` : ''}
        </p>
      ) : (
        <p className="mt-3 font-dm-sans text-[17px] text-ink" data-audit="capture-live">
          ±{latest ? latest.acc.toFixed(0) : '—'} m · {usable.length} {usable.length === 1 ? 'fix' : 'fixes'}
          {cap.rejected > 0 && <span className="text-secondary-ink"> · {cap.rejected} thrown out as wild</span>}
          {gaps.length > 0 && <span style={{ color: warning }}> · {gaps.length} gap{gaps.length === 1 ? '' : 's'}</span>}
        </p>
      )}
      {cap.error && <p role="alert" className="mt-2 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="capture-error">{cap.error}</p>}
    </>
  )

  if (mode === 'choose') {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="capture-choose">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">Record a place where you are standing</p>
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" onClick={() => void beginDrop()} className="min-h-[52px] rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream" data-audit="capture-drop-open">
            Drop a place here
          </button>
          <button type="button" onClick={() => void beginRide()} className="min-h-[52px] rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[17px] font-semibold text-ink" data-audit="capture-ride-open">
            Ride the perimeter
          </button>
        </div>
        <p className="mt-2 font-dm-sans text-[15px] text-secondary-ink">
          A stack, a gate or a tank is a point. A field, a pasture or a corral is a ride. You can also draw one by tapping corners on the map.
        </p>
      </Card>
    )
  }

  if (mode === 'drop') {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="capture-drop">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">Stand where the place is</p>
        {live}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={!cap.settled} onClick={() => void takePoint()} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50" data-audit="capture-take-point">
            {cap.settled ? 'Drop it here' : `Waiting for ±${SETTLE_MAX_ACC_M} m…`}
          </button>
          <button type="button" onClick={() => { void cap.stop(); setMode('choose') }} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="capture-cancel">Cancel</button>
        </div>
        {outcomeMsg && <p className="mt-2 font-dm-sans text-[16px] text-ink" data-audit="capture-outcome">{outcomeMsg}</p>}
      </Card>
    )
  }

  if (mode === 'ride') {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="capture-ride">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">Ride the fence line</p>
        {live}
        {outcomeMsg && (
          <div className="mt-3 rounded-lg border p-3" style={{ borderColor: warning }} data-audit="capture-outcome">
            <p className="font-dm-sans text-[16px] leading-snug text-ink">{outcomeMsg}</p>
            {offerDrop && (
              <button type="button" onClick={() => { setOutcomeMsg(null); setOfferDrop(false); void beginDrop() }} className="mt-2 min-h-[48px] font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="capture-switch-to-drop">
                Drop a single point instead
              </button>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={!cap.settled} onClick={() => void finishRide(false)} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50" data-audit="capture-close-loop">
            Save the loop
          </button>
          <button type="button" disabled={!cap.settled} onClick={() => void finishRide(true)} className="min-h-[52px] rounded-lg border px-4 font-dm-sans text-[17px] font-semibold disabled:opacity-50" style={{ color: warning, borderColor: warning }} data-audit="capture-finish-here">
            Finish here
          </button>
          <button type="button" onClick={() => { void cap.stop(); setMode('choose') }} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="capture-cancel">Cancel</button>
        </div>
        <p className="mt-2 font-dm-sans text-[15px] text-secondary-ink">
          Finish here draws a straight line back to your start when the ground will not let you close — a creek, a cliff, the neighbour&rsquo;s fence. The place is labelled for it.
        </p>
      </Card>
    )
  }

  // ── name it ─────────────────────────────────────────────────────────────────
  return (
    <Card className="mt-4 p-4 sm:p-5" data-audit="capture-name">
      {pending?.kind === 'point' && (
        <p className="font-dm-sans text-[17px] text-ink" data-audit="capture-summary">
          A point, ±{pending.accM.toFixed(0)} m, averaged from {pending.used} {pending.used === 1 ? 'reading' : 'readings'}.
        </p>
      )}
      {pending?.kind === 'ring' && (
        <>
          <p className="font-dm-sans text-[20px] font-semibold text-ink" data-audit="capture-summary">{fmtAcres(pending.acres)} acres</p>
          {pending.byHand && (
            <p className="mt-1 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="capture-hand-label">
              Closed by hand — a straight line back to your start, not ground you rode.
            </p>
          )}
          {pending.snapped && (
            <p className="mt-1 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="capture-snapped-label">
              Closed at the nearest return, not a true tie. The acreage is an estimate.
            </p>
          )}
          {gaps.length > 0 && (
            <p className="mt-1 font-dm-sans text-[15px]" style={{ color: warning }} data-audit="capture-gap-label">
              {gaps.length} gap{gaps.length === 1 ? '' : 's'} in the ride — {gaps.map(g => `${Math.round(g.seconds)} s`).join(', ')} unrecorded. Nothing was drawn across {gaps.length === 1 ? 'it' : 'them'}.
            </p>
          )}
        </>
      )}

      <label className="mt-4 block font-dm-sans text-[16px] font-semibold text-ink">
        Name
        <input value={name} onChange={e => setName(e.target.value.slice(0, MAX_NAME))} maxLength={MAX_NAME} autoFocus
          className="mt-1 min-h-[52px] w-full rounded-lg border border-control-border px-3 font-dm-sans text-[17px] text-ink" data-audit="capture-name-input" />
      </label>
      <label className="mt-3 block font-dm-sans text-[16px] font-semibold text-ink">
        What is it
        <select value={kind} onChange={e => setKind(e.target.value)} className="mt-1 min-h-[52px] w-full rounded-lg border border-control-border px-3 font-dm-sans text-[17px] text-ink" data-audit="capture-kind">
          {PLACE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label} — {k.hint}</option>)}
        </select>
      </label>

      {saveErr && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="capture-save-error">{saveErr}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50" data-audit="capture-save">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" disabled={busy} onClick={() => { setPending(null); setMode('choose') }} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="capture-discard">Discard</button>
      </div>
    </Card>
  )
}
