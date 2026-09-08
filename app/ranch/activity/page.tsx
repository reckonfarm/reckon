import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { listActivity, filterOptions, describeEvent, PAGE_SIZE, type ActivityFilters } from '@/lib/activity'
import { fmtDay, fmtTime, dayKey } from '@/lib/jobs/format'
import JobsView from '@/app/dashboard/components/JobsView'
import { privateTitle } from '@/lib/private-title'

// ─── /activity — everything recorded on the ranch, in order, findable (Block 5A) ──
// Chronological by WORK time, newest first, paginated by keyset; filterable by
// person, place, lot, and a ranch-day range. Every row opens its exact event.
// Independent of the read cursor: what has been "seen" is never hidden here.
export const dynamic = 'force-dynamic'
export const generateMetadata = () => privateTitle('Activity')

const pick = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : null)
const qs = (f: ActivityFilters, extra: Record<string, string | null | undefined> = {}) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, v)
  const s = p.toString(); return s ? `?${s}` : ''
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/signin?next=${encodeURIComponent('/ranch/activity' + qs({ actor: pick(sp.actor), place: pick(sp.place), lot: pick(sp.lot), from: pick(sp.from), to: pick(sp.to) }))}`)
  const filters: ActivityFilters = { actor: pick(sp.actor), place: pick(sp.place), lot: pick(sp.lot), from: pick(sp.from), to: pick(sp.to) }
  // Block 6A: /jobs → /ranch/activity?source=machine — the machines' sessions (jobs) under the record.
  if (pick(sp.source) === 'machine') return <MachineActivity user={user} />
  const [page, options] = await Promise.all([listActivity(supabase, user.id, filters, pick(sp.cursor)), filterOptions(supabase, user.id)])

  const filtering = Object.values(filters).some(Boolean)
  const heading = filters.place && options.places.find(p => p.id === filters.place)
    ? `Activity at ${options.places.find(p => p.id === filters.place)!.name}`
    : filters.actor && options.people.find(p => p.id === filters.actor) ? `${options.people.find(p => p.id === filters.actor)!.name}'s activity`
    : 'Activity'

  // Rows grouped by ranch day so "Tuesday" reads as a heading, not a hunt.
  const groups: { day: string; rows: NonNullable<typeof page>['rows'] }[] = []
  for (const r of page?.rows ?? []) { const d = dayKey(r.ts); const g = groups[groups.length - 1]; if (g && g.day === d) g.rows.push(r); else groups.push({ day: d, rows: [r] }) }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>The record</p>
        <h1 className="mt-1 type-page-heading text-ink">{heading}</h1>
        <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">Everything recorded on the ranch, newest first, by the day the work happened. Tap a line for the exact entry.</p>

        {!page ? (
          <Card className="mt-4 p-5"><p className="font-dm-sans text-[17px] text-ink">You are not on a ranch yet, so there is no record to show.</p></Card>
        ) : (
          <>
            <form method="get" action="/ranch/activity" className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" data-audit="activity-filters">
              <label className="font-dm-sans text-[14px] font-medium text-secondary-ink">Person
                <select name="actor" defaultValue={filters.actor ?? ''} className="mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink">
                  <option value="">Everyone</option>{options.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
              <label className="font-dm-sans text-[14px] font-medium text-secondary-ink">Place
                <select name="place" defaultValue={filters.place ?? ''} className="mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink">
                  <option value="">Anywhere</option>{options.places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
              <label className="font-dm-sans text-[14px] font-medium text-secondary-ink">Lot
                <select name="lot" defaultValue={filters.lot ?? ''} className="mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink">
                  <option value="">Any lot</option>{options.lots.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select></label>
              <label className="font-dm-sans text-[14px] font-medium text-secondary-ink">From
                <input type="date" name="from" defaultValue={filters.from ?? ''} className="mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink" /></label>
              <label className="font-dm-sans text-[14px] font-medium text-secondary-ink">To
                <input type="date" name="to" defaultValue={filters.to ?? ''} className="mt-1 block w-full min-h-[48px] rounded-lg border border-control-border bg-surface px-3 font-dm-sans text-[17px] text-ink" /></label>
              <div className="flex items-end gap-2">
                <button type="submit" className="min-h-[48px] flex-1 rounded-lg bg-brand px-4 font-dm-sans text-[17px] font-semibold text-on-brand">Show</button>
                {filtering && <Link href="/ranch/activity" className="inline-flex min-h-[48px] items-center px-2 font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">Clear</Link>}
              </div>
            </form>

            {page.rows.length === 0 ? (
              <Card className="mt-4 p-5" data-audit="activity-empty"><p className="font-dm-sans text-[17px] text-ink">{filtering ? 'Nothing recorded matches those filters.' : 'Nothing recorded on the ranch yet.'}</p></Card>
            ) : groups.map(g => (
              <section key={g.day} className="mt-5" aria-label={fmtDay(`${g.day}T12:00:00-06:00`, 'long')}>
                <h2 className="font-dm-sans text-[16px] font-semibold uppercase tracking-wide text-secondary-ink">{fmtDay(`${g.day}T12:00:00-06:00`, 'long')}</h2>
                <Card className="mt-2 p-0">
                  <ol className="divide-y divide-rule" data-audit="activity-list">
                    {g.rows.map(r => (
                      <li key={r.id}>
                        <Link href={`/ranch/activity/${r.id}`} className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 hover:bg-forest-green/[0.03]" data-audit="activity-row">
                          <span className="min-w-0 font-dm-sans text-[17px] leading-snug text-ink">
                            <span className="font-semibold">{page.names.person(r.user_id)}</span> · {r.superseded_by ? <s className="decoration-2" data-audit="row-superseded">{describeEvent(r, page.names)}</s> : describeEvent(r, page.names)}
                            {r.superseded_by && <span className="ml-2 font-dm-sans text-[14px] font-semibold text-secondary-ink">corrected</span>}
                            {r.supersedes_event_id && !r.voided_at && <span className="ml-2 font-dm-sans text-[14px] font-semibold text-secondary-ink" data-audit="row-correction">correction</span>}
                          </span>
                          <span className="shrink-0 font-dm-sans text-[15px] tabular-nums text-secondary-ink">{fmtTime(r.ts)}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </Card>
              </section>
            ))}

            {page.nextCursor && (
              <Link href={`/activity${qs(filters, { cursor: page.nextCursor })}`} className="mt-4 inline-flex min-h-[52px] w-full items-center justify-center rounded-lg border border-control-border bg-surface font-dm-sans text-[17px] font-semibold text-ink" data-audit="activity-older">
                Older entries →
              </Link>
            )}
            <p className="mt-3 font-dm-sans text-[14px] text-secondary-ink">{PAGE_SIZE} per page · newest first by work time.</p>
          </>
        )}
      </main>
    </>
  )
}

// The machines' side of the record: jobs derived from connected machines, the
// same list the Jobs view carries, under the record's own heading.
function MachineActivity({ user }: { user: { id: string } }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>The record · machines</p>
        <h1 className="mt-1 type-page-heading text-ink">Jobs recorded by connected machines</h1>
        <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">Sessions a Scout observed, newest first. Work recorded by hand is under <Link href="/ranch/activity" className="font-semibold text-brand underline underline-offset-2">Activity</Link>.</p>
        <div className="mt-4" data-audit="machine-activity"><JobsView user={user} /></div>
      </main>
    </>
  )
}
