'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import PlaceMapLoader, { type MapShape } from './PlaceMapLoader'
import { Card } from '@/app/components/ui/Card'
import { fmtAcres, ringToGeoJSON, type LatLng } from '@/lib/places/geo'
import { PLACE_KINDS, DEFAULT_KIND, MAX_NAME } from '@/lib/places/kinds'
import { navigateTo } from '@/lib/standalone-nav'
import { warning } from '@/lib/brand-colors'

// ─── Draw a place (places, slice 1) ───────────────────────────────────────────
//
// Three steps, and the order of them is the point:
//   IDLE     the ground as it stands — the shape if there is one, the offer to
//            draw if there isn't.
//   DRAW     the map in draw mode. Nothing has been written; Cancel costs
//            nothing.
//   CONFIRM  the shape sitting on the imagery with its computed acreage, and
//            the two facts a place needs: what it is called and what kind of
//            place it is. Accept or redraw. The write happens HERE and only
//            here, so nobody discovers their acreage after it is already saved.
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

type Step = 'idle' | 'draw' | 'confirm'

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
  const [draft, setDraft] = useState<{ ring: LatLng[]; acres: number } | null>(null)
  const [name, setName] = useState(place?.name ?? '')
  const [kind, setKind] = useState(place?.kind ?? DEFAULT_KIND)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmRef = useRef<HTMLDivElement>(null)

  // Draw mode takes the whole screen; the confirm step hands it back as an
  // inline panel, which on a phone can land below the fold. Put it in front of
  // the operator rather than making them hunt for the Save button.
  useEffect(() => {
    if (step === 'confirm') confirmRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [step])

  const existingShape: MapShape[] = place?.ring ? [{ id: place.id, ring: place.ring }] : []
  const contextShapes = [...otherShapes, ...existingShape]

  const openDraw = () => { setError(null); setDraft(null); setStep('draw') }

  const save = async () => {
    if (!draft) return
    const trimmed = name.trim()
    if (!trimmed) { setError('A place needs a name.'); return }
    setSaving(true)
    setError(null)
    try {
      const geometry = ringToGeoJSON(draft.ring)
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
        setDraft(null)
        router.refresh()
      } else {
        // A new place has its own page and the operator should land on it.
        navigateTo(router, `/ranch/places/${json.place.id}`)
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
          useLabel="Use this shape"
          onShape={(ring, acres) => { setDraft({ ring, acres }); setStep('confirm') }}
          onCancel={() => { setDraft(null); setStep('idle') }}
        />
      </div>
    )
  }

  // ── CONFIRM ─────────────────────────────────────────────────────────────────
  if (step === 'confirm' && draft) {
    return (
      <div ref={confirmRef} data-audit="place-confirm" className="scroll-mt-4">
        <PlaceMapLoader
          key="confirm"
          shapes={[...otherShapes, { id: 'draft', ring: draft.ring, draft: true }]}
          initialCenter={initialCenter}
        />
        <Card className="mt-3 p-4 sm:p-5">
          <p className="font-dm-sans text-[17px] text-ink">
            <span className="font-semibold" data-audit="draft-acres">{fmtAcres(draft.acres) ?? 'No ground enclosed'}</span>
            <span className="text-secondary-ink"> · {draft.ring.length - 1} corners</span>
          </p>
          <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink">
            Measured from the shape you drew. It is what you tapped, not a survey.
          </p>

          <label className="mt-4 block font-dm-sans text-[16px] font-semibold text-ink" htmlFor="place-name">Name</label>
          <input
            id="place-name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={MAX_NAME}
            placeholder="North pasture"
            className="mt-1 min-h-[48px] w-full rounded-lg border border-forest-green/25 px-3 font-dm-sans text-[17px] text-ink"
          />

          <p className="mt-4 font-dm-sans text-[16px] font-semibold text-ink" id="place-kind-label">What kind of place</p>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="place-kind-label" data-audit="place-kind">
            {PLACE_KINDS.map(k => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={kind === k.value}
                onClick={() => setKind(k.value)}
                className={`min-h-[48px] rounded-full px-4 font-dm-sans text-[16px] font-semibold ${
                  kind === k.value ? 'bg-forest-green text-white' : 'border border-forest-green/25 text-forest-green'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink">
            {PLACE_KINDS.find(k => k.value === kind)?.hint ?? ' '}
          </p>

          {error && (
            <p role="alert" className="mt-3 font-dm-sans text-[16px] font-semibold" style={{ color: warning }} data-audit="place-save-error">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="min-h-[52px] flex-1 rounded-lg bg-forest-green px-4 font-dm-sans text-[17px] font-semibold text-cream disabled:opacity-50"
              data-audit="place-save"
            >
              {saving ? 'Saving…' : place ? 'Save shape' : 'Save place'}
            </button>
            <button
              type="button"
              onClick={openDraw}
              disabled={saving}
              className="min-h-[52px] rounded-lg border border-forest-green/30 px-4 font-dm-sans text-[17px] font-semibold text-forest-green disabled:opacity-50"
              data-audit="place-redraw"
            >
              Redraw
            </button>
          </div>
        </Card>
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
