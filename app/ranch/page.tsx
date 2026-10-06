import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeaderServer'
import LedgerStamp from '@/app/components/LedgerStamp'
import { ledgerThrough } from '@/lib/ledger-through'
import { privateTitle } from '@/lib/private-title'
import { ranchView } from '@/lib/ranch-view'
import { getRanchLots, lotPurposeSupported } from '@/lib/herd-lots'
import { readFollowed } from '@/lib/herd-follow'
import { lastWorkByLot, whereByLot } from '@/lib/ranch-summary'
import { listActivity, entriesToday } from '@/lib/activity'
import { listWork } from '@/lib/jobs/work'
import { placeRows } from '@/lib/places/rows'
import { fmtAcres } from '@/lib/places/geo'
import { kindLabel } from '@/lib/places/kinds'
import RanchView from './RanchView'
import HerdForm from './cattle/HerdForm'
import PlacesByKind from './places/PlacesByKind'
import ActivityGroups from './activity/ActivityGroups'
import Link from 'next/link'
import { resolveMapCentre } from '@/lib/places/anchor'
import PlaceMapLoader from './places/PlaceMapLoader'
import CapturePlace from './places/CapturePlace'
import DrawPlace from './places/DrawPlace'
import RecordHere from './places/RecordHere'
import DevicesList from './devices/DevicesList'
import LitOnHash from '@/app/components/LitOnHash'

// ─── /ranch — the Ranch view (Block 47; replaces the hub of Block 12) ─────────
// One page, read at a glance: head, bales on hand with days of feed left, rain
// this season against normal — each a tap that opens what is beneath it. Under
// them Cattle, Ground and The record as tabs; you never leave the page. Every
// number is traceable to records; one that cannot be honestly derived is not
// painted. Acres by kind live under Ground and feed used this season under the
// hay number: reference, not status.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Ranch')

export default async function RanchPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/ranch')
  // Block 32: what this render read — taken before the reads below start.
  const through = await ledgerThrough(supabase)
  const [view, lots, todayCount, recordPage, work, rows] = await Promise.all([
    ranchView(supabase, user.id),
    getRanchLots(supabase, user.id).catch(() => []),
    entriesToday(supabase).catch(() => 0),
    listActivity(supabase, user.id, {}, null).catch(() => null),
    listWork(supabase, { limit: 60 }).catch(() => []),
    placeRows(supabase).catch(() => ({ live: [], retired: [] })),
  ])
  const [lastWork, where, purposeSupported, followed] = await Promise.all([
    lastWorkByLot(supabase, lots.map(l => l.id)).catch(() => ({})),
    whereByLot(supabase, lots).catch(() => ({})),
    lotPurposeSupported(supabase).catch(() => false),
    readFollowed(supabase, user.id).catch(() => [] as string[]),
  ])
  // Session 3b: the Ground tab IS the places page — the map, the ways to mark
  // ground, and the devices, which are at places. The separate pages went.
  const drawn = rows.live.filter(r => r.ring)
  const centre = await resolveMapCentre(supabase, user.id, drawn.map(r => r.ring!)).catch(() => null)
  const oldestTs = recordPage?.rows[recordPage.rows.length - 1]?.ts ?? null
  const workRows = work.filter(w => !recordPage?.nextCursor || (oldestTs != null && w.startedAt >= oldestTs))

  const GROUPS: [string, string, string[]][] = [['pastures', 'Pastures', ['pasture']], ['fields', 'Fields', ['field']], ['yards', 'Yards', ['yard', 'stackyard', 'stack']], ['points', 'Points', ['gate', 'tank']]]
  const known = new Set(GROUPS.flatMap(g => g[2]))
  const row = (r: { id: string; name: string; kind: string; acres: number | null }) => ({ id: r.id, name: r.name, kind: r.kind, acres: r.acres })
  const groups = [
    ...GROUPS.map(([key, label, kinds]) => ({ key, label, rows: rows.live.filter(r => kinds.includes(r.kind)).map(row) })),
    { key: 'other', label: 'Other', rows: rows.live.filter(r => !known.has(r.kind)).map(row) },
    { key: 'off', label: 'Off the list', rows: rows.retired.map(row) },
  ]

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <LedgerStamp through={through} />
        <LitOnHash prefix="place-" />
        <h1 className="type-page-heading text-ink">Ranch</h1>
        <RanchView
          initialTab={tab === 'ground' ? 'ground' : tab === 'record' ? 'record' : 'cattle'}
          view={view}
          todayCount={todayCount}
          cattle={(
            <div data-audit="ranch-cattle">
              <HerdForm initialLots={lots} lastWork={lastWork} where={where} purposeSupported={purposeSupported} followed={followed} />
            </div>
          )}
          ground={(
            <div data-audit="ranch-ground">
              {view.acresByKind.length > 0 && (
                <ul className="divide-y divide-forest-green/10 rounded-xl border border-forest-green/10 bg-white px-4" data-audit="acres-by-kind">
                  {view.acresByKind.map(a => <li key={a.kind} className="flex justify-between py-2 font-dm-sans text-[16px] text-ink"><span>{kindLabel(a.kind)} · {a.places} {a.places === 1 ? 'place' : 'places'}</span><span className="tabular-nums font-semibold">{fmtAcres(a.acres)}</span></li>)}
                </ul>
              )}
              {drawn.length > 0 && centre && (
                <div className="mt-4" data-audit="places-map">
                  <PlaceMapLoader shapes={drawn.map(r => ({ id: r.id, ring: r.ring! }))} initialCenter={centre} height={320} />
                </div>
              )}
              <div className="mt-4"><PlacesByKind groups={groups} /></div>
              {centre && (
                <div className="mt-4 space-y-3">
                  <div id="capture" />
                  <CapturePlace initialCenter={centre} otherShapes={drawn.map(r => ({ id: r.id, ring: r.ring! }))} />
                  <DrawPlace initialCenter={centre} otherShapes={drawn.map(r => ({ id: r.id, ring: r.ring! }))} />
                  <RecordHere />
                </div>
              )}
              <DevicesList supabase={supabase} />
            </div>
          )}
          record={(
            <div data-audit="ranch-today">
              {recordPage && recordPage.rows.length > 0 ? <ActivityGroups page={recordPage} workRows={workRows} audit="ranch-record-list" /> : <p className="font-dm-sans text-[17px] text-ink" data-audit="ranch-quiet">Nothing recorded yet.</p>}
              <p className="mt-3 font-dm-sans text-[16px]"><Link href="/ranch/activity" className="inline-flex min-h-[48px] items-center font-semibold text-brand underline underline-offset-2" data-audit="ranch-activity-link">The whole record →</Link></p>
            </div>
          )}
        />
      </main>
    </>
  )
}
