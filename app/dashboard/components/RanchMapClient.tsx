'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import PlaceMapLoader from '@/app/ranch/places/PlaceMapLoader'
import RecordHere from '@/app/ranch/places/RecordHere'
import { openLogIt } from '@/app/dashboard/components/LogIt'
import BottomSheet from '@/app/components/BottomSheet'
import { fmtAcres } from '@/lib/places/geo'
import type { RanchMap } from '@/lib/ranch-map'

// ─── Block 26: the ranch map on Today — the picture, its key, and one sheet ──
// No words on the map. The key is the bunches' own names in their colours; a
// place the map cannot draw (no shape, no position — nothing is invented) is a
// chip too, and every chip and every shape opens the SAME sheet.
const days = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
const ago = (iso: string) => { const d = days(iso); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago` }

export default function RanchMapClient({ map }: { map: RanchMap }) {
  const [openId, setOpenId] = useState<string | null>(null)
  // Picked from the key (or the list below), the map frames that place: a name
  // cannot point at ground the way a finger on the shape already has.
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null)
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
        <PlaceMapLoader shapes={shapes} initialCenter={map.centre} height="40vh" overview onPlaceTap={setOpenId} focus={focus} />
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
                <button key={b.lotId} type="button" onClick={() => openLogIt({ type: 'cattle_moved', lot: b.lotId })} className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-rule bg-surface px-3 font-dm-sans text-[16px] font-semibold text-ink" data-audit="ranch-map-unplaced-bunch" data-lot={b.lotId}>
                  <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ background: b.color }} />{b.label}
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
