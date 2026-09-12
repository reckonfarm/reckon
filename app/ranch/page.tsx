import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { getRanch } from '@/lib/ranch-membership'
import { privateTitle } from '@/lib/private-title'
import { ranchNumbers } from '@/lib/ranch-summary'
import { listActivity, describeEvent, standingRows, chainWithin } from '@/lib/activity'
import ActivityRowItem, { markerFor } from '@/app/components/ActivityRowItem'
import RecentActivityList from './RecentActivityList'
import { fmtDay, fmtTime, plural } from '@/lib/jobs/format'

// ─── /ranch — the ranch hub (Block 6A) ────────────────────────────────────────
// Two recent activity rows (up to 20 more one tap away, in place — 7B.2), then
// the five sections, each with ONE live number
// where one exists: hay on hand (only with a counted baseline), head in lots
// (only with a live lot), places, devices. No number → nothing rendered. On a
// narrow screen this is a list, never a tab strip.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Ranch')

const fmtN = (n: number) => n.toLocaleString('en-US')

// How deep the in-place expander goes. Past this, the Activity record.
const HUB_ROWS = 20

export default async function RanchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/ranch')
  const [ranch, numbers, recent] = await Promise.all([
    getRanch(supabase, user.id).catch(() => null),
    ranchNumbers(supabase, user.id),
    listActivity(supabase, user.id, {}, null).catch(() => null),
  ])
  // The hub shows two rows and the expander reveals the rest without a second
  // request (Block 7B.2). Capped at HUB_ROWS: shipping every standing row the
  // page had read took this document from 44 KB to 85 KB to render two of them,
  // which is the wrong trade on one bar of 3G — the point of the expander was
  // to make the hub cheaper to read, not the page dearer to load. Twenty is
  // deep enough that opening it is worth the tap; the Activity link below
  // carries anything older.
  const standing = recent ? standingRows(recent.rows) : []
  const rows = standing.slice(0, HUB_ROWS)
  const sections: { href: string; label: string; blurb: string; number: string | null }[] = [
    { href: '/ranch/activity', label: 'Activity', blurb: 'Everything recorded, by the day the work happened.', number: null },
    { href: '/ranch/cattle',   label: 'Cattle',   blurb: 'Your lots — head, purpose, last recorded work.', number: numbers.headInLots != null ? `${fmtN(numbers.headInLots)} head` : null },
    { href: '/ranch/hay',      label: 'Hay',      blurb: 'Bales on hand, fed, and stacked.', number: numbers.hayOnHand != null ? `${plural(numbers.hayOnHand, 'bale')} on hand` : null },
    { href: '/ranch/work',     label: 'Work',     blurb: 'Cutting and baling recorded by connected machines.', number: numbers.workSessions != null ? plural(numbers.workSessions, 'session') : null },
    { href: '/ranch/places',   label: 'Places',   blurb: 'Where things happen — pastures, stacks, tanks.', number: numbers.places != null ? plural(numbers.places, 'place') : null },
    { href: '/ranch/devices',  label: 'Devices',  blurb: 'Connected machines and loggers.', number: numbers.devices != null ? plural(numbers.devices, 'device') : null },
  ]
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>Ranch</p>
        <h1 className="mt-1 type-page-heading text-ink">{ranch?.name ?? 'Your ranch'}</h1>

        <section className="mt-4" aria-labelledby="ranch-recent">
          <h2 id="ranch-recent" className={`${EYEBROW} !text-ink`}>Recent activity</h2>
          {rows.length === 0 ? (
            <Card className="mt-2 p-5"><p className="font-dm-sans text-[17px] text-ink">Nothing recorded on the ranch yet.</p></Card>
          ) : (
            <Card className="mt-2 p-0">
              {/* Operational (6B): what stands, a correction marked, what it replaced one tap away. */}
              <RecentActivityList
                hasMore={standing.length > rows.length || !!recent?.nextCursor}
                rows={rows.map(r => <ActivityRowItem key={r.id} id={r.id} who={recent!.names.person(r.user_id)} line={describeEvent(r, recent!.names)} when={`${fmtDay(r.ts)} ${fmtTime(r.ts)}`} marker={markerFor(r)} chain={chainWithin(recent!.rows, r, recent!.names)} />)}
              />
            </Card>
          )}
        </section>

        <section className="mt-6" aria-labelledby="ranch-sections">
          <h2 id="ranch-sections" className={`${EYEBROW} !text-ink`}>Sections</h2>
          <Card className="mt-2 p-0">
            <ul className="divide-y divide-rule" data-audit="ranch-sections">
              {sections.map(s => (
                <li key={s.href}>
                  <Link href={s.href} className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-forest-green/[0.03]" data-audit="ranch-section">
                    <span className="min-w-0">
                      <span className="block font-dm-sans text-[17px] font-semibold text-ink">{s.label}</span>
                      <span className="block font-dm-sans text-[15px] text-secondary-ink">{s.blurb}</span>
                    </span>
                    <span className="shrink-0 text-right font-dm-sans text-[16px] tabular-nums text-ink">
                      {s.number && <span data-audit="section-number">{s.number}</span>}
                      <span aria-hidden className="ml-2 text-secondary-ink">→</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </main>
    </>
  )
}
