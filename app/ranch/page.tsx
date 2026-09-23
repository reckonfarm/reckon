import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
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

// ─── /ranch — the Ranch view (Block 47; replaces the hub of Block 12) ─────────
// One page, read at a glance: head, bales on hand with days of feed left, rain
// this season against normal — each a tap that opens what is beneath it. Under
// them Cattle, Ground and The record as tabs; you never leave the page. Every
// number is traceable to records; one that cannot be honestly derived is not
// painted. Acres by kind live under Ground and feed used this season under the
// hay number: reference, not status.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Ranch')

export default async function RanchPage() {
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
        <h1 className="type-page-heading text-ink">Ranch</h1>
        <RanchView
          view={view}
          todayCount={todayCount}
          cattle={(
            <div data-audit="ranch-cattle">
              {lots.length > 0 && (
                <Link href="/ranch/preg-check" data-audit="cattle-preg-check" className="mb-3 inline-flex min-h-[56px] w-full items-center justify-between rounded-xl border border-control-border bg-surface px-5 font-dm-sans text-[18px] font-semibold text-ink hover:bg-forest-green/[0.03]">
                  <span>Preg check</span>
                </Link>
              )}
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
              <PlacesByKind groups={groups} />
              <p className="mt-3 font-dm-sans text-[16px]"><Link href="/ranch/places" className="inline-flex min-h-[48px] items-center font-semibold text-brand underline underline-offset-2" data-audit="ranch-places-link">Places →</Link> · <Link href="/ranch/devices" className="inline-flex min-h-[48px] items-center font-semibold text-brand underline underline-offset-2">Devices →</Link></p>
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
