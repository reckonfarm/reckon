import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { privateTitle } from '@/lib/private-title'
import { placeRows } from '@/lib/places/rows'
import PlacesByKind from './PlacesByKind'
import { resolveMapCentre } from '@/lib/places/anchor'
import RecordHere from './RecordHere'
import DrawPlace from './DrawPlace'
import CapturePlace from './CapturePlace'
import PlaceMapLoader from './PlaceMapLoader'
import LitOnHash from '@/app/components/LitOnHash'

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
  const GROUPS: [string, string, string[]][] = [['pastures', 'Pastures', ['pasture']], ['fields', 'Fields', ['field']], ['yards', 'Yards', ['yard', 'stackyard', 'stack']], ['points', 'Points', ['gate', 'tank']]]
  const known = new Set(GROUPS.flatMap(g => g[2]))
  const row = (r: { id: string; name: string; kind: string; acres: number | null }) => ({ id: r.id, name: r.name, kind: r.kind, acres: r.acres })
  const groups = [
    ...GROUPS.map(([key, label, kinds]) => ({ key, label, rows: live.filter(r => kinds.includes(r.kind)).map(row) })),
    { key: 'other', label: 'Other', rows: live.filter(r => !known.has(r.kind)).map(row) },
    { key: 'off', label: 'Off the list', rows: retired.map(row) },
  ]
  const drawn = live.filter(r => r.ring)
  const centre = await resolveMapCentre(supabase, user.id, drawn.map(r => r.ring!))
  const undrawn = live.length - drawn.length

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <LitOnHash prefix="place-" />
        <p className={EYEBROW}>Ranch · Places</p>
        <h1 className="mt-1 type-page-heading text-ink">Places</h1>
        {/* Block 12 (12.7): Devices fold under Ground — a device is AT a place and
            has no life of its own — so the way to them is from here, not from
            the hub. The 6J rule: every surface reachable from where a person
            would look, not just reachable by URL. */}
        {/* Block 12 (12.7) kept as a name you tap: devices are reached from here. */}
        <p className="mt-1 font-dm-sans text-[16px]"><Link href="/ranch/devices" className="inline-flex min-h-[48px] items-center font-semibold text-brand underline underline-offset-2" data-audit="places-devices-link">Devices →</Link></p>

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

        {/* Block 43: places sorted by what they are — pastures, fields, yards, points —
            each a count you tap open; inside, a name and its acres, nothing else. A
            place taken off the list (the old "retire") is a group of its own. */}
        <PlacesByKind groups={groups} />

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
