import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { privateTitle } from '@/lib/private-title'
import { placeRows, placeTree, childrenSummary, type PlaceNode } from '@/lib/places/rows'
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
import RowActions from '@/app/components/RowActions'

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
  const tree = placeTree(live)
  const drawn = live.filter(r => r.ring)
  const centre = await resolveMapCentre(supabase, user.id, drawn.map(r => r.ring!))
  const undrawn = live.length - drawn.length

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Ranch · Places</p>
        <h1 className="mt-1 type-page-heading text-ink">Places</h1>
        {/* Block 12 (12.7): Devices fold under Ground — a device is AT a place and
            has no life of its own — so the way to them is from here, not from
            the hub. The 6J rule: every surface reachable from where a person
            would look, not just reachable by URL. */}
        <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">
          Where things happen. Connected machines and loggers are under <Link href="/ranch/devices" className="font-semibold text-brand underline underline-offset-2" data-audit="places-devices-link">Devices</Link>.
        </p>

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
          <>
            {/* Block 7A — THE HIERARCHY. Pastures (and anything else that holds
                places) at the top, each with what sits inside it nested under
                it; everything that stands on its own in Unplaced, at the
                bottom. Never hidden: a place whose parent is not on this list
                renders at the top level (lib/places/rows.ts placeTree). */}
            {tree.top.length > 0 && (
              <Card className="mt-4 p-0" data-audit="places-grouped">
                <ul className="divide-y divide-rule" data-audit="place-rows">
                  {tree.top.map(n => <PlaceBranch key={n.id} node={n} />)}
                </ul>
              </Card>
            )}
            {tree.unplaced.length > 0 && (
              <section className="mt-4" aria-labelledby="places-unplaced">
                <h2 id="places-unplaced" className={`${EYEBROW} !text-ink`}>Unplaced</h2>
                <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink">Not inside any pasture or field. Open one to put it somewhere.</p>
                <Card className="mt-2 p-0">
                  <ul className="divide-y divide-rule" data-audit={tree.top.length === 0 ? 'place-rows' : 'place-rows-unplaced'}>
                    {tree.unplaced.map(n => <PlaceBranch key={n.id} node={n} />)}
                  </ul>
                </Card>
              </section>
            )}
          </>
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
          <div id="capture" />
          <CapturePlace initialCenter={centre} otherShapes={drawn.map(r => ({ id: r.id, ring: r.ring! }))} />
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

// One row, and the rows inside it. Depth is shown by indent and a "·" lead,
// not by hiding anything: every place is one tap away at every depth.
function PlaceBranch({ node }: { node: PlaceNode }) {
  const p = node
  const inside = childrenSummary(p.children, kindLabel)
  return (
    <li data-audit="place-branch" data-depth={p.depth} data-kind={p.kind}>
      {/* Block 12 (12.3): hold the row for Open · Edit · Delete; the place page opens on the mode asked for. */}
      <RowActions links={{ openHref: `/ranch/places/${p.id}`, editHref: `/ranch/places/${p.id}#edit`, deleteHref: `/ranch/places/${p.id}#delete`, label: p.name }}>
      <Link href={`/ranch/places/${p.id}`} className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-forest-green/[0.03]" style={{ paddingLeft: `${1 + Math.min(p.depth, 4) * 1.25}rem` }} data-audit="place-row" data-id={p.id}>
        <span className="min-w-0">
          <span className="block font-dm-sans text-[17px] font-semibold text-ink">{p.depth > 0 && <span aria-hidden className="mr-1 text-secondary-ink">·</span>}{p.name} <span className="font-normal text-secondary-ink">· {kindLabel(p.kind)}</span>{p.acres != null && <span className="font-normal text-secondary-ink"> · {fmtAcres(p.acres)}</span>}</span>
          <span className="block font-dm-sans text-[15px] text-secondary-ink">
            {inside && <span data-audit="place-children">{inside[0].toUpperCase() + inside.slice(1)} · </span>}
            {p.lastWork ? <span data-audit="place-last-work">Last recorded work: {isManualEventType(p.lastWork.type) ? MANUAL_EVENT_LABELS[p.lastWork.type].toLowerCase() : p.lastWork.type}, {fmtDay(p.lastWork.ts)}</span> : <span>Nothing recorded here yet</span>}
            {p.lastRain && <span data-audit="place-last-rain"> · Last recorded rain: {p.lastRain.inches.toFixed(2)}&quot;, {fmtDay(p.lastRain.ts)}</span>}
          </span>
        </span>
        <span aria-hidden className="shrink-0 font-dm-sans text-[17px] text-secondary-ink">→</span>
      </Link>
      </RowActions>
      {p.children.length > 0 && (
        <ul className="divide-y divide-rule border-t border-rule" data-audit="place-children-rows">
          {p.children.map(c => <PlaceBranch key={c.id} node={c} />)}
        </ul>
      )}
    </li>
  )
}
