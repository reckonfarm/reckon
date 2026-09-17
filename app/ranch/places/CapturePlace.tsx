'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import SaveStatus from '@/app/dashboard/components/SaveStatus'
import { useOwnSaveStrip } from '@/app/dashboard/components/LogIt'
import PlaceMapLoader, { type MapShape } from './PlaceMapLoader'
import { clearRideDraft, loadRideDraft, saveRideDraft, type RideDraft } from '@/lib/places/ride-draft'
import { PLACE_KINDS, MAX_NAME, DEFAULT_KIND, allowedParentKinds, kindLabel, parentRule } from '@/lib/places/kinds'
import type { LatLng } from '@/lib/places/geo'
import { warning } from '@/lib/brand-colors'
import { enqueue, newEventId } from '@/lib/outbox'
import {
  averagePosition, closeByHand, gapsIn, isOutlier, rideBoundary, rideOutcome,
  SETTLE_MAX_ACC_M, type CaptureFix,
} from '@/lib/places/capture'
import { useCapture } from './useCapture'

// ─── Capturing a place in the field (Block 8.1 · 8.2 · 8.3 · 8.4 · 7A) ────────
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
//
// BLOCK 21 — the ride never discards the track. Recording stops when the
// operator says stop, never when a guard fails: "Close the loop" on an open
// loop says so and keeps recording; every fix is written to the phone as it
// arrives (lib/places/ride-draft.ts) and a reload picks the ride back up;
// starting again never wipes what is already there. Finish here ALWAYS
// closes — it does not have to be accurate, it has to close, and it has to
// work every time — and the map is on for the whole ride so the outline
// traces itself. A guard may refuse to grade the work. It may not throw the
// work away.
//
// BLOCK 7A — three things changed, and each is a rule, not a feature:
//
//   THE MAP IS ON DURING THE DROP. The blue dot is the phone's fix, the circle
//   is its accuracy in real metres, the pin is where the place will go. After
//   "Drop it here" the pin can be dragged — a phone under a stack of bales is
//   often ten metres out — and the drag is RECORDED, not hidden: provenance
//   keeps the original fix, the final position, the distance, adjusted: true.
//
//   THE SAVE GOES THROUGH THE OUTBOX. A place is recorded the way a feeding
//   is: written on the phone first with a client-minted id, then uploaded,
//   with the same four words on the strip (Saved on this phone → Waiting to
//   sync → Synced to ranch, or Couldn't save). No bare fetch, no router.push:
//   a place recorded at the far end of the ranch with no bars is still
//   recorded, and syncs when the truck reaches the yard.
//
//   THE RECEIPT IS AN ANSWER. Synced, the strip says what changed — "Stack 3
//   added · stack · in North Pasture" and "4 places in North Pasture now",
//   with the place one tap away — rather than a bare "saved".
//
// KIND and PARENT are chips. The parent chips offer ONLY what the kind table
// allows (lib/places/kinds.ts): pick "Field" and every non-pasture disappears
// from the parent row; pick "Pasture" and the row goes entirely, because a
// pasture is never inside anything. The route enforces the same table, so a
// chip the screen would not offer is a request the server would refuse.

type Mode = 'choose' | 'drop' | 'ride' | 'name' | 'saved'
type Pending =
  | { kind: 'point'; fix: LatLng; accM: number; used: number }
  | { kind: 'ring'; ring: LatLng[]; acres: number; snapped: boolean; byHand: boolean; outerEdge: boolean; status: string }

interface PlaceOption { id: string; name: string; kind: string }

// A dropped point is stored as a tiny square around the pin, so a place is
// always a polygon and every reader stays the same (8.5). The half-width is
// the accuracy being claimed, so the shape is literally the uncertainty.
function squareAround(lat: number, lng: number, halfM: number): LatLng[] {
  const dLat = halfM / 111_132
  const dLng = halfM / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [
    { lat: lat - dLat, lng: lng - dLng }, { lat: lat - dLat, lng: lng + dLng },
    { lat: lat + dLat, lng: lng + dLng }, { lat: lat + dLat, lng: lng - dLng },
    { lat: lat - dLat, lng: lng - dLng },
  ]
}

// Metres between two fixes — the same flat-earth arithmetic capture.ts uses
// for the ride; at a pin's scale the error is nothing.
function metresBetween(a: LatLng, b: LatLng): number {
  const mPerLng = 111_320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot((b.lng - a.lng) * mPerLng, (b.lat - a.lat) * 111_132)
}

const fmtAcres = (a: number) => (a >= 10 ? a.toFixed(1) : a.toFixed(2))
const chip = (on: boolean) => `min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${on ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'}`

export default function CapturePlace({ initialCenter, otherShapes = [] }: { initialCenter: LatLng; otherShapes?: MapShape[] }) {
  const cap = useCapture()
  const [mode, setMode] = useState<Mode>('choose')
  const [pending, setPending] = useState<Pending | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<string>(DEFAULT_KIND)
  const [parentId, setParentId] = useState<string | null>(null)
  const [places, setPlaces] = useState<PlaceOption[]>([])
  // The pin. Starts on the fix; moves only by a drag.
  const [pinAt, setPinAt] = useState<LatLng | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [savedLabel, setSavedLabel] = useState<string>('')
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [outcomeMsg, setOutcomeMsg] = useState<string | null>(null)
  const [offerDrop, setOfferDrop] = useState(false)
  // 8: a ride is unsaved work, and Cancel sat one thumb-width from Save with
  // nothing between them. PK lost a finished 3.68-acre ride to exactly that.
  const [confirmCancel, setConfirmCancel] = useState(false)
  // Block 21: the ride the phone is holding, if any — offered on the chooser
  // and written to on every fix while riding.
  const [draft, setDraft] = useState<RideDraft | null>(null)
  const rideStartedAt = useRef<number>(0)
  useEffect(() => {
    const t = setTimeout(() => setDraft(loadRideDraft()), 0)
    return () => clearTimeout(t)
  }, [])

  // The answer card below carries the receipt with a tappable link, so the
  // global strip (no taps) stands down while it is up.
  useOwnSaveStrip(mode === 'saved')
  const usable = useMemo(() => cap.fixes.filter(f => !isOutlier(f)), [cap.fixes])
  const gaps = useMemo(() => gapsIn(usable), [usable])
  const latest = cap.fixes[cap.fixes.length - 1] ?? null
  // The live fix for the map during the drop: the running average of the last
  // eight usable readings, with the best accuracy among them — the same number
  // "Drop it here" will freeze.
  const liveFix = useMemo(() => averagePosition(usable.slice(-8)), [usable])
  // Block 21 (ruling 1): every fix reaches the phone's shelf as it arrives —
  // throttled inside saveRideDraft — and always when the page hides.
  useEffect(() => {
    if (mode !== 'ride' || cap.fixes.length === 0) return
    saveRideDraft(cap.fixes, rideStartedAt.current)
  }, [mode, cap.fixes])
  useEffect(() => {
    if (mode !== 'ride') return
    const onHide = () => { if (document.visibilityState === 'hidden') saveRideDraft(cap.fixes, rideStartedAt.current, true) }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide) }
  }, [mode, cap.fixes])

  // The parents this kind may sit inside, from the ranch's live list. The
  // list is what /api/places offers every picker: live, unretired, this
  // ranch. Loaded once, on mount; a place made on this screen is not a
  // candidate parent for the next one until the page refreshes, which the
  // sync does.
  useEffect(() => {
    let alive = true
    fetch('/api/places').then(r => (r.ok ? r.json() : { places: [] })).then(j => { if (alive) setPlaces((j.places ?? []) as PlaceOption[]) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const parentOptions = useMemo(() => {
    const allowed = allowedParentKinds(kind)
    return places.filter(p => allowed.includes(p.kind))
  }, [places, kind])
  // A kind change that makes the chosen parent impossible drops the parent:
  // DERIVED, not synced — the chip is gone from the row, so the value is
  // simply not read. Nothing below looks at parentId except through this.
  const parent = parentOptions.find(p => p.id === parentId) ?? null

  const rideSoFar = useMemo(() => {
    if (!confirmCancel || mode !== 'ride' || usable.length < 8) return null
    const tied = rideBoundary(usable).boundary.acres
    if (tied != null) return tied
    const hand = closeByHand(usable)
    return hand.ok ? hand.acres : null
  }, [confirmCancel, mode, usable])

  function leave() {
    if (usable.length > 0) { setConfirmCancel(true); return }
    void cap.stop(); setMode('choose')
  }
  function discard() { void cap.stop(); clearRideDraft(); setDraft(null); setConfirmCancel(false); setOutcomeMsg(null); setMode('choose') }
  function reset() {
    setPending(null); setPinAt(null); setName(''); setKind(DEFAULT_KIND); setParentId(null)
    setSaveErr(null); setOutcomeMsg(null); setOfferDrop(false); setSavedId(null); setMode('choose')
  }

  const beginDrop = useCallback(async () => { setMode('drop'); setOutcomeMsg(null); await cap.start() }, [cap])
  const beginRide = useCallback(async (seed: CaptureFix[] = [], startedAt?: number) => {
    // A ride started fresh while the phone is holding one REPLACES it, and the
    // chooser says so before the tap — the draft is not quietly overwritten by
    // the first fix of the new ride. Only the operator ends a ride this way.
    if (seed.length === 0) { clearRideDraft(); setDraft(null) }
    rideStartedAt.current = startedAt ?? Date.now()
    setMode('ride'); setOutcomeMsg(null); setOfferDrop(false)
    await cap.start(seed)
  }, [cap])
  // Block 12 (12.2): the Record pill's Ground group links straight to a way of
  // marking a place — #capture-drop or #capture-ride start it; #capture (draw,
  // or no preference) lands on the chooser. Read once, on mount; the hash is a
  // request, not state.
  // Started on a task, not in the effect body (the same shape as
  // RecordSheetHost's DiscardedOnSwitch): the hash is an external request.
  useEffect(() => {
    const h = typeof window !== 'undefined' ? window.location.hash : ''
    if (h !== '#capture-drop' && h !== '#capture-ride') return
    const t = setTimeout(() => { void (h === '#capture-drop' ? beginDrop() : beginRide()) }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function takePoint() {
    const avg = averagePosition(usable.slice(-8))
    await cap.stop()
    if (!avg) { setOutcomeMsg('No usable fix yet — wait for the accuracy to settle.'); return }
    const fix = { lat: avg.lat, lng: avg.lng }
    setPending({ kind: 'point', fix, accM: avg.accM, used: avg.used })
    setPinAt(fix)
    setMode('name')
  }

  // Block 21: neither exit stops the receiver until there is a shape to name.
  // A loop that will not tie keeps recording and says so; Finish here closes
  // whatever is there. The draft is written in full at the moment of leaving.
  async function finishRide(byHand: boolean) {
    const fixes = cap.fixes
    saveRideDraft(fixes, rideStartedAt.current, true)
    if (byHand) {
      const hand = closeByHand(fixes)
      if (!hand.ok) { setOutcomeMsg(`${hand.error} Still recording.`); setOfferDrop(false); return }
      await cap.stop()
      setPending({ kind: 'ring', ring: hand.ring, acres: hand.acres, snapped: false, byHand: true, outerEdge: hand.outerEdge, status: 'closed_by_hand' })
      setMode('name'); return
    }
    const r = rideBoundary(fixes)
    const o = rideOutcome(r, fixes)
    if (!r.boundary.polygon) { setOutcomeMsg(o.message); setOfferDrop(o.offerDrop); return }
    await cap.stop()
    const ring = [...r.boundary.polygon, r.boundary.polygon[0]]
    setPending({ kind: 'ring', ring, acres: r.boundary.acres ?? 0, snapped: r.boundary.snapped, byHand: false, outerEdge: false, status: r.boundary.status })
    setMode('name')
  }

  // Finish here from the chooser: the phone's draft, closed without waking the
  // receiver — the ride is already over; only the naming is left.
  function finishDraftHere() {
    if (!draft) return
    const hand = closeByHand(draft.fixes)
    if (!hand.ok) { void beginRide(draft.fixes, draft.startedAt); setOutcomeMsg(`${hand.error} Still recording.`); return }
    cap.seed(draft.fixes)
    setPending({ kind: 'ring', ring: hand.ring, acres: hand.acres, snapped: false, byHand: true, outerEdge: hand.outerEdge, status: 'closed_by_hand' })
    setMode('name')
  }

  // ── Save: on the phone first, then the ranch ────────────────────────────────
  function save() {
    if (!pending || !name.trim()) return
    setSaveErr(null)
    const id = newEventId()
    const trimmed = name.trim()
    let ring: LatLng[]
    let capture: Record<string, unknown>
    if (pending.kind === 'point') {
      const at = pinAt ?? pending.fix
      const moved = metresBetween(pending.fix, at)
      const adjusted = moved > 0.05
      ring = squareAround(at.lat, at.lng, Math.max(2, pending.accM))
      capture = {
        source: 'dropped', status: 'dropped', accuracyM: pending.accM,
        fix: { lat: pending.fix.lat, lng: pending.fix.lng, accuracy_m: pending.accM },
        position: { lat: at.lat, lng: at.lng },
        moved_m: adjusted ? moved : 0,
        adjusted,
      }
    } else {
      ring = pending.ring
      capture = { source: 'ridden', status: pending.status, snapped: pending.snapped, closedByHand: pending.byHand, outline: pending.outerEdge ? 'outer_edge' : 'ridden' }
    }
    const body = {
      id, name: trimmed, kind,
      ...(parent ? { parent_id: parent.id } : {}),
      geometry: { type: 'Polygon', coordinates: [ring.map(p => [p.lng, p.lat])] },
      capture: {
        ...capture,
        rejected: cap.rejected,
        gaps: gaps.map(g => ({ seconds: Math.round(g.seconds) })),
        track: usable.map(f => ({ t: Math.round(f.t / 1000), lat: +f.lat.toFixed(6), lng: +f.lng.toFixed(6), a: Math.round(f.acc * 10) / 10 })),
      },
    }
    const label = `${trimmed} added · ${kindLabel(kind).toLowerCase()}${parent ? ` · in ${parent.name}` : ''}`
    try {
      enqueue(body, label, 0, { endpoint: '/api/places', link: { href: `/ranch/places/${id}`, label: 'Open this place' } })
    } catch {
      setSaveErr('This phone would not keep the place. Nothing was saved — free some space and try again.')
      return
    }
    if (pending.kind === 'ring') { clearRideDraft(); setDraft(null) }
    setSavedId(id); setSavedLabel(label); setMode('saved')
  }

  const cancelGuard = confirmCancel ? (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: warning }} role="alert" data-audit="capture-discard-guard">
      <p className="font-dm-sans text-[16px] font-semibold text-ink">
        Throw away {usable.length} {usable.length === 1 ? 'fix' : 'fixes'}
        {mode === 'ride' && rideSoFar != null ? ` and about ${fmtAcres(rideSoFar)} acres` : ''}?
      </p>
      <p className="mt-1 font-dm-sans text-[15px] leading-snug text-secondary-ink">
        Nothing has been saved yet, and the ride cannot be got back.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setConfirmCancel(false)} className="min-h-[48px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[16px] font-semibold text-cream" data-audit="capture-keep-going">
          Keep recording
        </button>
        <button type="button" onClick={discard} className="min-h-[48px] rounded-lg border px-4 font-dm-sans text-[16px] font-semibold" style={{ color: warning, borderColor: warning }} data-audit="capture-discard-confirm">
          Throw it away
        </button>
      </div>
    </div>
  ) : null

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
      <>
      {draft && (
        <Card className="mt-4 p-4 sm:p-5" data-audit="capture-draft">
          <p className="font-dm-sans text-[17px] font-semibold text-ink">A ride in progress</p>
          <p className="mt-0.5 font-dm-sans text-[16px] text-ink" data-audit="capture-draft-summary">
            {draft.fixes.length} {draft.fixes.length === 1 ? 'fix' : 'fixes'} kept on this phone, started {new Date(draft.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Nothing is lost.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void beginRide(draft.fixes, draft.startedAt)} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream" data-audit="capture-draft-resume">
              Keep riding
            </button>
            <button type="button" onClick={finishDraftHere} className="min-h-[52px] rounded-lg border px-4 font-dm-sans text-[17px] font-semibold" style={{ color: warning, borderColor: warning }} data-audit="capture-draft-finish">
              Finish here
            </button>
            <button type="button" onClick={discard} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="capture-draft-discard">
              Throw it away
            </button>
          </div>
        </Card>
      )}
      <Card className="mt-4 p-4 sm:p-5" data-audit="capture-choose">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">Add a place</p>
        {/* Block 12 (12.12): what this makes, and what happens next, before the
            two ways of making it. */}
        <p className="mt-0.5 font-dm-sans text-[15px] text-secondary-ink">A named spot on your map. Pick how to mark it; you name it on the next screen.</p>
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" onClick={() => void beginDrop()} className="min-h-[52px] rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream" data-audit="capture-drop-open">
            Drop a place here
            <span className="block text-[14px] font-normal opacity-90">Marks the spot you are standing on</span>
          </button>
          <button type="button" onClick={() => void beginRide()} className="min-h-[52px] rounded-lg border border-control-border bg-surface px-4 font-dm-sans text-[17px] font-semibold text-ink" data-audit="capture-ride-open">
            Ride the perimeter
            <span className="block text-[14px] font-normal text-secondary-ink">{draft ? 'Starts over — the ride above is thrown away' : 'Draws the shape from your track as you go round'}</span>
          </button>
        </div>
        <p className="mt-2 font-dm-sans text-[15px] text-secondary-ink">
          A stack, a gate or a tank is a point. A field, a pasture or a corral is a ride. You can also draw one by tapping corners on the map.
        </p>
      </Card>
      </>
    )
  }

  if (mode === 'drop') {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="capture-drop">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">Stand where the place is</p>
        {/* Block 7A: the ground, live. Remounted once when the first fix
            arrives so the map opens ON it; after that only the pin and the
            circle move. Not draggable yet — the fix is still moving. */}
        <div className="mt-3" data-audit="capture-drop-map">
          <PlaceMapLoader
            key={liveFix ? 'drop-fixed' : 'drop-waiting'}
            shapes={otherShapes}
            initialCenter={liveFix ? { lat: liveFix.lat, lng: liveFix.lng } : initialCenter}
            height={300}
            pin={liveFix ? { fix: { lat: liveFix.lat, lng: liveFix.lng }, accuracyM: liveFix.accM, position: { lat: liveFix.lat, lng: liveFix.lng } } : undefined}
          />
        </div>
        {live}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={!cap.settled} onClick={() => void takePoint()} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50" data-audit="capture-take-point">
            {cap.settled ? 'Drop it here' : `Waiting for ±${SETTLE_MAX_ACC_M} m…`}
          </button>
          <button type="button" onClick={leave} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="capture-cancel">Cancel</button>
        </div>
        {cancelGuard}
        {outcomeMsg && <p className="mt-2 font-dm-sans text-[16px] text-ink" data-audit="capture-outcome">{outcomeMsg}</p>}
      </Card>
    )
  }

  if (mode === 'ride') {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="capture-ride">
        <p className="font-dm-sans text-[17px] font-semibold text-ink">Ride the fence line</p>
        {/* Block 21 (ruling 3): the map, with the track being laid. Remounted
            once when the first fix arrives so it opens ON the rider; after
            that the line grows and the view follows. Never blank: with no fix
            yet it opens where the ranch is. */}
        <div className="mt-3" data-audit="capture-ride-map">
          <PlaceMapLoader
            key={liveFix ? 'ride-fixed' : 'ride-waiting'}
            shapes={otherShapes}
            initialCenter={liveFix ? { lat: liveFix.lat, lng: liveFix.lng } : initialCenter}
            height={320}
            track={{ points: usable.map(f => ({ lat: f.lat, lng: f.lng })), here: latest && !isOutlier(latest) ? { lat: latest.lat, lng: latest.lng } : null, accuracyM: latest ? latest.acc : null }}
          />
        </div>
        {outcomeMsg && (
          <div className="mt-3 rounded-lg border p-3" style={{ borderColor: warning }} data-audit="capture-outcome">
            <p className="font-dm-sans text-[16px] leading-snug text-ink">{outcomeMsg}</p>
            {offerDrop && (
              <button type="button" onClick={() => { setOutcomeMsg(null); setOfferDrop(false); void cap.stop(); void beginDrop() }} className="mt-2 min-h-[48px] font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="capture-switch-to-drop">
                Drop a single point instead
              </button>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={!cap.settled} onClick={() => void finishRide(false)} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50" data-audit="capture-close-loop">
            Close the loop
          </button>
          <button type="button" disabled={!cap.settled} onClick={() => void finishRide(true)} className="min-h-[52px] rounded-lg border px-4 font-dm-sans text-[17px] font-semibold disabled:opacity-50" style={{ color: warning, borderColor: warning }} data-audit="capture-finish-here">
            Finish here
          </button>
          <button type="button" onClick={leave} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="capture-cancel">Cancel</button>
        </div>
        {cancelGuard}
        <p className="mt-2 font-dm-sans text-[15px] text-secondary-ink">
          Finish here closes the shape from where you are, however far from your start. It always works; the place is labelled for it.
        </p>
        {/* Diagnostics sit under the map (ruling 3): they explain, they do not lead. */}
        <div data-audit="capture-ride-diagnostics">{live}</div>
      </Card>
    )
  }

  // ── saved: the answer, in the outbox's own words ────────────────────────────
  if (mode === 'saved' && savedId) {
    return (
      <Card className="mt-4 p-4 sm:p-5" data-audit="capture-saved">
        <p className="sr-only">{savedLabel}</p>
        <SaveStatus itemId={savedId} />
        <button type="button" onClick={reset} className="mt-3 inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="capture-another">
          Add another place
        </button>
      </Card>
    )
  }

  // ── name it ─────────────────────────────────────────────────────────────────
  const pinMoved = pending?.kind === 'point' && pinAt ? metresBetween(pending.fix, pinAt) : 0
  return (
    <Card className="mt-4 p-4 sm:p-5" data-audit="capture-name">
      {pending?.kind === 'point' && (
        <>
          {/* Block 7A: the pin is draggable now that the fix is frozen. The
              dot and circle stay where the phone put them — moving the pin
              never rewrites what the phone said. */}
          <div data-audit="capture-pin-map">
            <PlaceMapLoader
              key="name-pin"
              shapes={otherShapes}
              initialCenter={pending.fix}
              height={300}
              pin={{ fix: pending.fix, accuracyM: pending.accM, position: pinAt ?? pending.fix, onMove: p => setPinAt(p) }}
            />
          </div>
          <p className="mt-3 font-dm-sans text-[17px] text-ink" data-audit="capture-summary">
            A point, ±{pending.accM.toFixed(0)} m, averaged from {pending.used} {pending.used === 1 ? 'reading' : 'readings'}.
          </p>
          <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="capture-pin-note">
            {pinMoved > 0.5
              ? <>Pin moved {pinMoved < 10 ? pinMoved.toFixed(1) : Math.round(pinMoved)} m from the fix. Both are kept with the place.</>
              : <>The blue dot is where the phone put you. Drag the pin if the place is somewhere else.</>}
          </p>
        </>
      )}
      {pending?.kind === 'ring' && (
        <>
          {/* Block 21: the shape being named, drawn over the ground it came from. */}
          <div data-audit="capture-ring-map">
            <PlaceMapLoader
              key="name-ring"
              shapes={[...otherShapes, { id: 'draft', ring: pending.ring, draft: true }]}
              initialCenter={pending.ring[0]}
              height={300}
            />
          </div>
          <p className="mt-3 font-dm-sans text-[20px] font-semibold text-ink" data-audit="capture-summary">{fmtAcres(pending.acres)} acres</p>
          {pending.outerEdge && (
            <p className="mt-1 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="capture-outer-edge-label">
              The ride crossed its own line, so this is the outer edge of everywhere you rode — an estimate, not a fence.
            </p>
          )}
          {pending.byHand && (
            <p className="mt-1 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="capture-hand-label">
              Closed by hand — you closed it, not the geometry. The acreage is an estimate.
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

      <p className="mt-4 font-dm-sans text-[16px] font-semibold text-ink" id="capture-kind-label">What is it</p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="capture-kind-label" data-audit="capture-kind">
        {PLACE_KINDS.map(k => (
          <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} onClick={() => setKind(k.value)} className={chip(kind === k.value)} data-audit={`capture-kind-${k.value}`}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink">{PLACE_KINDS.find(k => k.value === kind)?.hint ?? ' '}</p>

      {/* Block 7A: the parent, offered only where the kind table allows one.
          A pasture gets no row at all — not a disabled row, no row — because a
          control that can only say "no" is a lie. */}
      {allowedParentKinds(kind).length > 0 && parentOptions.length > 0 && (
        <>
          <p className="mt-4 font-dm-sans text-[16px] font-semibold text-ink" id="capture-parent-label">Inside</p>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="capture-parent-label" data-audit="capture-parent">
            <button type="button" role="radio" aria-checked={parent === null} onClick={() => setParentId(null)} className={chip(parent === null)} data-audit="capture-parent-none">
              None
            </button>
            {parentOptions.map(p => (
              <button key={p.id} type="button" role="radio" aria-checked={parent?.id === p.id} onClick={() => setParentId(p.id)} className={chip(parent?.id === p.id)} data-audit="capture-parent-option" data-kind={p.kind}>
                {p.name} <span className="font-normal opacity-80">· {kindLabel(p.kind).toLowerCase()}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="capture-parent-rule">{parentRule(kind)}</p>
        </>
      )}

      {saveErr && <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="capture-save-error">{saveErr}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={!name.trim()} onClick={save} className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50" data-audit="capture-save">
          Save
        </button>
        <button type="button" onClick={() => { setPending(null); setPinAt(null); setMode('choose') }} className="min-h-[52px] rounded-lg px-4 font-dm-sans text-[17px] font-semibold text-secondary-ink underline underline-offset-2" data-audit="capture-discard">Discard</button>
      </div>
    </Card>
  )
}
