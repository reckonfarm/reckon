'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PlaceMapLoader, { type MapShape } from './PlaceMapLoader'
import { fmtAcres, ringToGeoJSON, type LatLng } from '@/lib/places/geo'
import { DEFAULT_KIND } from '@/lib/places/kinds'

// ─── Draw a place (places, slice 1) ───────────────────────────────────────────
//
// Two steps (Block 34 took the third away):
//   IDLE     the ground as it stands — the shape if there is one, the offer to
//            draw if there isn't.
//   DRAW     the map in draw mode. From three corners on, the name and the kind
//            are asked ON the shape, the acreage runs beside them, and Save
//            writes from there. No "Use this shape", no second screen: a
//            rectangular pasture is four corners and Save. Nothing has been
//            written until Save; Cancel costs nothing.
//
// Two callers, one component:
//   • the places list — no `place`, so Save POSTs a new one and goes to it.
//   • a place's own page — `place` given, so Save PATCHes that row in place.
//
// Every submit can fail loudly. A failed save leaves the drawn shape on screen
// with the reason under it; it never closes and quietly loses the work.

export interface ExistingPlace {
  id: string
  name: string
  kind: string
  ring: LatLng[] | null
  acres: number | null
}

type Step = 'idle' | 'draw'

export default function DrawPlace({
  place,
  otherShapes = [],
  initialCenter,
}: {
  place?: ExistingPlace
  /** Already-saved shapes to keep on the map for context while drawing. */
  otherShapes?: MapShape[]
  initialCenter: LatLng
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('idle')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const existingShape: MapShape[] = place?.ring ? [{ id: place.id, ring: place.ring }] : []
  const contextShapes = [...otherShapes, ...existingShape]

  const openDraw = () => { setError(null); setStep('draw') }

  // Block 34: the shape, the name and the kind arrive together from the map.
  const save = async (ring: LatLng[], name: string, kind: string) => {
    const trimmed = name.trim()
    if (!trimmed) { setError('A place needs a name.'); return }
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const geometry = ringToGeoJSON(ring)
      const res = place
        ? await fetch(`/api/places/${place.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmed, kind, geometry }),
          })
        : await fetch('/api/places', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: trimmed, kind, geometry }),
          })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not save the shape.')
      if (place) {
        setStep('idle')
        router.refresh()
      } else {
        // Block 15 (ruling 7): never lose your place — a new place lands back
        // on the list, scrolled to its row and lit for a moment.
        setStep('idle')
        window.location.hash = `place-${json.place.id}`
        router.refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the shape.')
    } finally {
      setSaving(false)
    }
  }

  // ── DRAW ────────────────────────────────────────────────────────────────────
  if (step === 'draw') {
    return (
      <div data-audit="place-draw">
        <PlaceMapLoader
          key="draw"
          shapes={contextShapes}
          initialCenter={initialCenter}
          drawing
          useLabel={saving ? 'Saving…' : place ? 'Save the boundary' : 'Save the place'}
          nameDefault={place?.name ?? ''}
          kindDefault={place?.kind ?? DEFAULT_KIND}
          saveError={error}
          onShape={(ring, _acres, name, kind) => { void save(ring, name, kind) }}
          onCancel={() => { setError(null); setStep('idle') }}
        />
      </div>
    )
  }

  // ── IDLE ────────────────────────────────────────────────────────────────────
  // A place that has a shape shows it. One that doesn't says so plainly and
  // offers the draw — never an empty map pretending to be information.
  //
  // A drawn place offers NO redraw, because the route refuses one: geometry is
  // set-once in this slice. Offering a button that can only fail would be the
  // same lie as naming a surface that isn't built — so the page says what is
  // true instead, and does not promise when that changes.
  if (place?.ring) {
    return (
      <div data-audit="place-shape">
        <PlaceMapLoader key="idle" shapes={[{ id: place.id, ring: place.ring }]} initialCenter={initialCenter} />
        <p className="mt-2 font-dm-sans text-[16px] text-ink" data-audit="place-acres">
          {fmtAcres(place.acres) ?? 'Shape drawn'}
        </p>
        <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="place-shape-set">
          The shape is saved. Redrawing a place isn&rsquo;t in yet.
        </p>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={openDraw}
      className="inline-flex min-h-[56px] w-full items-center justify-center rounded-lg border border-forest-green/30 px-4 font-dm-sans text-[17px] font-semibold text-forest-green sm:w-auto"
      data-audit="place-draw-open"
    >
      {place ? 'Draw its shape' : 'Draw a place'}
    </button>
  )
}
