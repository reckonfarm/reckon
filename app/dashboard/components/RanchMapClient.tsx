'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import PlaceMapLoader from '@/app/ranch/places/PlaceMapLoader'
import RecordHere from '@/app/ranch/places/RecordHere'
import { useSwipeDown } from '@/lib/swipe-down'
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
  const open = map.places.find(p => p.id === openId) ?? null
  const swipe = useSwipeDown(() => setOpenId(null), !!open)

  const shapes = useMemo(() => map.places.filter(p => p.ring).map(p => ({ id: p.id, ring: p.ring!, ...(p.bunches[0] ? { fill: p.bunches[0].color } : {}) })), [map.places])
  const undrawn = map.places.filter(p => !p.ring)

  return (
    <section className="mb-6" data-audit="ranch-map" aria-label="Ranch map">
      {shapes.length > 0 && (
        <PlaceMapLoader shapes={shapes} initialCenter={map.centre} height="40vh" overview onPlaceTap={setOpenId} />
      )}
      {(map.keyed.length > 0 || undrawn.length > 0) && (
        <ul className="mt-2 flex flex-wrap gap-2" data-audit="ranch-map-key">
          {map.keyed.map(k => (
            <li key={k.lotId}>
              <button type="button" onClick={() => setOpenId(k.placeId)} className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-rule bg-surface px-3 font-dm-sans text-[16px] font-semibold text-ink" data-audit="ranch-map-bunch-chip">
                <span aria-hidden className="h-4 w-4 shrink-0 rounded-sm" style={{ background: k.color }} />{k.name}
              </button>
            </li>
          ))}
          {undrawn.filter(p => !map.keyed.some(k => k.placeId === p.id)).map(p => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpenId(p.id)} className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-dashed border-control-border bg-surface px-3 font-dm-sans text-[16px] text-ink" data-audit="ranch-map-undrawn-chip">{p.name}</button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setOpenId(null)} role="dialog" aria-modal="true" aria-label={open.name} data-audit="ranch-map-sheet">
          <div className="sheet-in w-full max-w-md rounded-t-2xl bg-cream px-5 pb-[calc(env(safe-area-inset-bottom,0px)+20px)] pt-4 sm:rounded-2xl sm:pb-5" onClick={e => e.stopPropagation()} {...swipe}>
            <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-forest-green/20 sm:hidden" />
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
          </div>
        </div>
      )}
    </section>
  )
}
