'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import PlaceMapLoader from '@/app/ranch/places/PlaceMapLoader'
import RecordHere from '@/app/ranch/places/RecordHere'
import { openLogIt } from '@/app/dashboard/components/LogIt'
import BottomSheet from '@/app/components/BottomSheet'
import { fmtAcres } from '@/lib/places/geo'
import type { RanchMap } from '@/lib/ranch-map'
import type { Change } from '@/lib/since'
import { centreOf } from '@/lib/places/geo'
import { attention, brand } from '@/lib/brand-colors'
import { fmtDay, fmtTime } from '@/lib/jobs/format'
import ReviewedButton from '@/app/components/ReviewedButton'

// ─── Block 26: the ranch map on Today — the picture, its key, and one sheet ──
// No words on the map. The key is the bunches' own names in their colours; a
// place the map cannot draw (no shape, no position — nothing is invented) is a
// chip too, and every chip and every shape opens the SAME sheet.
const days = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
const ago = (iso: string) => { const d = days(iso); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago` }

// Block 29 — "3 changes" steps the map through what changed since you checked:
// each step frames the place, says what happened, who made it and when it was
// MADE, and a move draws one straight line from where they were to where they
// went. It lives in the card's own DOM, never over the map. Reviewed clears
// "new"; a bunch with no recorded place is not a change — it is a problem
// that stays, in the colour reserved for one, until a move resolves it.
export default function RanchMapClient({ map, changes = [], total = 0, newest = null }: { map: RanchMap; changes?: Change[]; total?: number; newest?: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null)
  // Picked from the key (or the list below), the map frames that place: a name
  // cannot point at ground the way a finger on the shape already has.
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null)
  const [step, setStep] = useState<number | null>(null)
  const centre = (id: string | null) => { const r = id ? map.places.find(p => p.id === id)?.ring : null; return r ? centreOf(r) : null }
  const current = step == null ? null : changes[step] ?? null
  const lineFor = (c: Change | null) => { if (!c || c.kind !== 'move') return null; const from = centre(c.fromPlaceId), to = centre(c.toPlaceId); const colour = map.places.find(p => p.id === c.toPlaceId)?.bunches[0]?.color ?? brand; return from && to ? { from, to, color: colour } : null }
  const goTo = (i: number) => { const c = changes[i]; setStep(i); if (c?.placeId && map.places.some(p => p.id === c.placeId && p.ring)) setFocus(f => ({ id: c.placeId!, n: (f?.n ?? 0) + 1 })) }
  const pick = (id: string) => { setFocus(f => ({ id, n: (f?.n ?? 0) + 1 })); setOpenId(id) }
  const open = map.places.find(p => p.id === openId) ?? null

  // Block 26c: an occupied place carries its label (head · bunch name) and, when
  // a move landed there in the last few minutes, one settle of its outline.
  // "Moments ago" is judged once, when the map lands, so the settle plays once.
  const [landedAt] = useState(() => Date.now())
  const shapes = useMemo(() => map.places.filter(p => p.ring).map(p => {
    const b = p.bunches[0]
    const fresh = !!b?.since?.ts && landedAt - new Date(b.since.ts).getTime() < 3 * 60_000
    return { id: p.id, ring: p.ring!, ...(b ? { fill: b.color, label: `${b.head.toLocaleString('en-US')} · ${b.name}`, pulse: fresh } : {}) }
  }), [map.places, landedAt])
  const undrawn = map.places.filter(p => !p.ring)

  return (
    <section className="mb-6" data-audit="ranch-map" aria-label="Ranch map">
      {shapes.length > 0 && (
        <PlaceMapLoader shapes={shapes} initialCenter={map.centre} height="40vh" overview onPlaceTap={setOpenId} focus={focus} line={lineFor(current)} />
      )}
      {/* Block 29: the changes, stepped. Under the map, in words. */}
      {total > 0 && (
        <div className="mt-2 rounded-xl border border-rule bg-surface px-4 py-3" data-audit="changes-stepper" data-total={total} data-step={step == null ? '' : step + 1}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-dm-sans text-[17px] font-semibold text-ink" data-audit="changes-summary">{total} {total === 1 ? 'change' : 'changes'}{step != null ? ` · ${step + 1} of ${changes.length}` : ''}</p>
            <div className="flex gap-2">
              {step != null && step > 0 && <button type="button" onClick={() => goTo(step - 1)} className="min-h-[44px] rounded-lg border border-control-border px-3 font-dm-sans text-[16px] font-semibold text-forest-green" data-audit="changes-prev">Back</button>}
              {(step == null || step < changes.length - 1) && <button type="button" onClick={() => goTo(step == null ? 0 : step + 1)} className="min-h-[44px] rounded-lg bg-forest-green px-4 font-dm-sans text-[16px] font-semibold text-cream" data-audit="changes-next">{step == null ? 'Show me' : 'Next'}</button>}
            </div>
          </div>
          {current && (
            <div className="mt-2" data-audit="changes-step" data-change={current.id}>
              <p className="font-dm-sans text-[17px] text-ink"><span className="font-semibold">{current.who}</span> {current.line}</p>
              <p className="mt-0.5 font-dm-sans text-[15px] text-secondary-ink" data-audit="changes-made">
                made {fmtDay(current.madeAt)} {fmtTime(current.madeAt)}
                {!current.placeId || !map.places.some(p => p.id === current.placeId && p.ring) ? <span data-audit="changes-no-ground"> · no ground to show</span> : null}
                {' · '}<Link href={`/ranch/activity/${current.id}`} className="underline underline-offset-2">open</Link>
              </p>
            </div>
          )}
          {step != null && step === changes.length - 1 && total <= changes.length && <div className="mt-1"><ReviewedButton count={total} through={newest} /></div>}
          {total > changes.length && <Link href="/ranch/activity" className="mt-1 inline-flex min-h-[44px] items-center font-dm-sans text-[15px] font-semibold text-brand underline underline-offset-2" data-audit="changes-view-all">View all {total} →</Link>}
        </div>
      )}

      {/* Block 26c: the labels are on the map, so nothing is keyed twice. Below
          it sit only the things the map cannot draw: a place with no shape,
          and — never missing — the bunches with no recorded place, each a tap
          to record where they are. */}
      {(undrawn.length > 0 || map.unplaced.length > 0) && (
        <div className="mt-2 flex flex-col gap-2">
          {undrawn.length > 0 && (
            <ul className="flex flex-wrap gap-2" data-audit="ranch-map-key">
              {undrawn.map(p => (
                <li key={p.id}>
                  <button type="button" onClick={() => pick(p.id)} className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-dashed border-control-border bg-surface px-3 font-dm-sans text-[16px] text-ink" data-audit="ranch-map-undrawn-chip">{p.name}</button>
                </li>
              ))}
            </ul>
          )}
          {map.unplaced.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" data-audit="ranch-map-unplaced">
              <span className="font-dm-sans text-[14px] font-medium uppercase tracking-wide text-secondary-ink">Unplaced</span>
              {map.unplaced.map(b => (
                <button key={b.lotId} type="button" onClick={() => openLogIt({ type: 'cattle_moved', lot: b.lotId })} className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border px-3 font-dm-sans text-[16px] font-semibold text-ink" style={{ borderColor: attention }} data-audit="ranch-map-unplaced-bunch" data-lot={b.lotId} data-problem="unplaced">
                  {/* Block 29: a problem, in the colour reserved for one — it stays until a move resolves it. */}
                  <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: attention }} />{b.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The shapes are paint on a canvas: a screen reader and a keyboard cannot
          reach them. Every drawn place is a real button here, out of sight, into
          the same sheet — and it frames the map as the key does. */}
      {shapes.length > 0 && (
        <ul className="sr-only" data-audit="ranch-map-places">
          {map.places.filter(p => p.ring).map(p => (
            <li key={p.id}><button type="button" onClick={() => pick(p.id)} data-audit="ranch-map-place-button" data-place={p.id}>{p.name}</button></li>
          ))}
        </ul>
      )}

      {open && (
        <BottomSheet open onClose={() => setOpenId(null)} label={open.name} audit="ranch-map-sheet">
            <p className="font-fraunces text-[22px] font-semibold leading-tight text-ink">
              <Link href={`/ranch/places/${open.id}`} className="underline-offset-2 hover:underline" data-audit="sheet-place">{open.name}</Link>
              {fmtAcres(open.acres) && <span className="ml-2 font-dm-sans text-[16px] font-normal text-secondary-ink" data-audit="sheet-acres">{fmtAcres(open.acres)}</span>}
            </p>
            {open.bunches.map(b => (
              <div key={b.id} className="mt-3" data-audit="sheet-bunch">
                <p className="flex items-center gap-2 font-dm-sans text-[17px] font-semibold text-ink">
                  <span aria-hidden className="h-4 w-4 shrink-0 rounded-sm" style={{ background: b.color }} />{b.label}
                </p>
                {/* Days here exist only when a move backs the date. No move, no number. */}
                {b.since && (
                  <p className="mt-0.5 font-dm-sans text-[16px] text-ink" data-audit="sheet-days">
                    <span className="font-semibold tabular-nums">{days(b.since.ts) === 0 ? 'Here since today' : `${days(b.since.ts)} ${days(b.since.ts) === 1 ? 'day' : 'days'} here`}</span>
                    {' · '}<Link href={`/ranch/activity/${b.since.eventId}`} className="underline underline-offset-2" data-audit="sheet-move">{b.since.line}</Link>
                  </p>
                )}
              </div>
            ))}
            {open.latest && (
              <p className="mt-3 font-dm-sans text-[16px] text-ink" data-audit="sheet-latest">
                {open.latest.id ? <Link href={`/ranch/activity/${open.latest.id}`} className="underline underline-offset-2">{open.latest.line}</Link> : open.latest.line}
                <span className="text-secondary-ink"> · {ago(open.latest.ts)}</span>
              </p>
            )}
            <div className="mt-4" onClick={() => setOpenId(null)}><RecordHere placeId={open.id} placeName={open.name} /></div>
        </BottomSheet>
      )}
    </section>
  )
}
