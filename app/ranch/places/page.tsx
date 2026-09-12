import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { privateTitle } from '@/lib/private-title'
import { placeRows } from '@/lib/places/rows'
import { resolveMapCentre } from '@/lib/places/anchor'
import { fmtAcres } from '@/lib/places/geo'
import { kindLabel } from '@/lib/places/kinds'
import { MANUAL_EVENT_LABELS, isManualEventType } from '@/lib/manual-log'
import { fmtDay } from '@/lib/jobs/format'
import RecordHere from './RecordHere'
import Disclosure from '@/app/components/ui/Disclosure'
import DrawPlace from './DrawPlace'
import CapturePlace from './CapturePlace'
import PlaceMapLoader from './PlaceMapLoader'

// ─── /ranch/places (Block 6A · shapes in slice 1) ─────────────────────────────
// The list first. Each row: name, type, acreage if the ground is drawn, last
// recorded work, last recorded rain — every one of them only when a line
// exists (never an inferred zero, never a guessed acre).
//
// Above the list, once anything has a shape, the ground itself: every drawn
// place on satellite imagery. Before that there is no map, because an empty
// map is not information.
//
// A place is still created by the record sheet's "new place" field, and now
// also by drawing one — the two paths write the same row.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Places')

export default async function PlacesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/ranch/places')
  const { live, retired } = await placeRows(supabase)
  const drawn = live.filter(r => r.ring)
  const centre = await resolveMapCentre(supabase, user.id, drawn.map(r => r.ring!))
  const undrawn = live.length - drawn.length

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Ranch · Places</p>
        <h1 className="mt-1 type-page-heading text-ink">Places</h1>

        {drawn.length > 0 && (
          <div className="mt-4" data-audit="places-map">
            <PlaceMapLoader
              shapes={drawn.map(r => ({ id: r.id, ring: r.ring! }))}
              initialCenter={centre}
              height={320}
            />
            <p className="mt-2 font-dm-sans text-[15px] text-secondary-ink">
              {drawn.length} {drawn.length === 1 ? 'place is' : 'places are'} drawn
              {undrawn > 0 && <> · {undrawn} named but not drawn yet</>}
            </p>
          </div>
        )}

        {live.length === 0 ? (
          <Card className="mt-4 p-5">
            <p className="font-dm-sans text-[17px] text-ink">No places named yet. Draw one on the map, or record work and name the place in the same entry — it is created with it.</p>
          </Card>
        ) : (
          <Card className="mt-4 p-0">
            <ul className="divide-y divide-rule" data-audit="place-rows">
              {live.map(p => (
                <li key={p.id}>
                  <Link href={`/ranch/places/${p.id}`} className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-forest-green/[0.03]" data-audit="place-row">
                    <span className="min-w-0">
                      <span className="block font-dm-sans text-[17px] font-semibold text-ink">{p.name} <span className="font-normal text-secondary-ink">· {kindLabel(p.kind)}</span>{p.acres != null && <span className="font-normal text-secondary-ink"> · {fmtAcres(p.acres)}</span>}</span>
                      <span className="block font-dm-sans text-[15px] text-secondary-ink">
                        {p.lastWork ? <span data-audit="place-last-work">Last recorded work: {isManualEventType(p.lastWork.type) ? MANUAL_EVENT_LABELS[p.lastWork.type].toLowerCase() : p.lastWork.type}, {fmtDay(p.lastWork.ts)}</span> : <span>Nothing recorded here yet</span>}
                        {p.lastRain && <span data-audit="place-last-rain"> · Last recorded rain: {p.lastRain.inches.toFixed(2)}&quot;, {fmtDay(p.lastRain.ts)}</span>}
                      </span>
                    </span>
                    <span aria-hidden className="shrink-0 font-dm-sans text-[17px] text-secondary-ink">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Retired places are OFF the live list but never out of reach — the
            standing rule is that every surface stays findable from where a
            person would look, and "put it back" is unreachable if the place
            itself is. Closed by default; the count is the answer on the row. */}
        {retired.length > 0 && (
          <Disclosure
            className="mt-4"
            title="Retired places"
            summary={`${retired.length} retired · still named in the entries that happened there`}
            audit="retired-places"
          >
            <ul className="divide-y divide-rule" data-audit="retired-place-rows">
              {retired.map(p => (
                <li key={p.id}>
                  <Link href={`/ranch/places/${p.id}`} className="flex min-h-[56px] items-center justify-between gap-3 py-3 hover:bg-forest-green/[0.03]" data-audit="retired-place-row">
                    <span className="min-w-0">
                      <span className="block font-dm-sans text-[17px] font-semibold text-ink">{p.name} <span className="font-normal text-secondary-ink">· {kindLabel(p.kind)}</span></span>
                      <span className="block font-dm-sans text-[15px] text-secondary-ink">Retired {fmtDay(p.retiredAt!)}</span>
                    </span>
                    <span aria-hidden className="shrink-0 font-dm-sans text-[17px] text-secondary-ink">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        <div className="mt-4 space-y-3">
          {/* Block 8 — capture comes FIRST. Standing in the place is the way
              most places get recorded; drawing on a map is the fallback for
              the ones you cannot get to (8.5). Both produce the same kind of
              row, so nothing downstream can tell them apart except by reading
              provenance, which is why provenance is recorded. */}
          <CapturePlace />
          <DrawPlace
            initialCenter={centre}
            otherShapes={drawn.map(r => ({ id: r.id, ring: r.ring! }))}
          />
          <RecordHere />
        </div>
      </main>
    </>
  )
}
