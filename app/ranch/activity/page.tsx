import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { listActivity, filterOptions, describeEvent, PAGE_SIZE, type ActivityFilters } from '@/lib/activity'
import { fmtDay, fmtTime, dayKey, fmtDuration, RANCH_TZ } from '@/lib/jobs/format'
import { listWork, describeWork } from '@/lib/jobs/work'
import JobsView from '@/app/dashboard/components/JobsView'
import { privateTitle } from '@/lib/private-title'
import ActivityRowItem, { markerFor } from '@/app/components/ActivityRowItem'
import ReviewedButton from '@/app/components/ReviewedButton'
import FilterShell from './ActivityFilters'
import ActivityDays from './ActivityDays'

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
  const filters: ActivityFilters = { actor: pick(sp.actor), place: pick(sp.place), lot: pick(sp.lot), from: pick(sp.from), to: pick(sp.to), since: pick(sp.since) }
  // Block 6A: /jobs → /ranch/activity?source=machine — the machines' sessions (jobs) under the record.
  if (pick(sp.source) === 'machine') return <MachineActivity user={user} />
  // Five states, five copies (Block 6B): no records · no filter matches · request failed · no permission (not on a ranch) · (no coverage belongs to markets).
  const [pageRes, options] = await Promise.all([
    listActivity(supabase, user.id, filters, pick(sp.cursor)).then(p => ({ ok: true as const, page: p })).catch(() => ({ ok: false as const, page: null })),
    filterOptions(supabase, user.id).catch(() => ({ people: [], places: [], lots: [] })),
  ])
  const failed = !pageRes.ok
  const page = pageRes.page

  const filtering = Object.values(filters).some(Boolean)
  // 6J: cutting and baling (the machines' sessions) appear in the record too, by their stable
  // job ids, on the unfiltered listing — a job carries no actor, place or lot to filter by.
  // Within this page's window only: on a later page, sessions newer than its newest row are
  // on the page before; sessions older than its oldest row are on the page after.
  const work = !filtering && page ? await listWork(supabase, { limit: 60 }).catch(() => []) : []
  const newestTs = page?.rows[0]?.ts ?? null, oldestTs = page?.rows[page.rows.length - 1]?.ts ?? null
  const workRows = work.filter(w => (!pick(sp.cursor) || (newestTs != null && w.startedAt <= newestTs)) && (!page?.nextCursor || (oldestTs != null && w.startedAt >= oldestTs)))
  const heading = filters.place && options.places.find(p => p.id === filters.place)
    ? `Activity at ${options.places.find(p => p.id === filters.place)!.name}`
    : filters.actor && options.people.find(p => p.id === filters.actor) ? `${options.people.find(p => p.id === filters.actor)!.name}'s activity`
    : filters.since ? 'Recorded since you checked'
    : 'Activity'

  // Rows grouped by ranch day so "Tuesday" reads as a heading, not a hunt.
  type Entry = { at: string; event?: NonNullable<typeof page>['rows'][number]; work?: (typeof workRows)[number] }
  // 8B.3 — which days open. Today and yesterday, BY DATE, on the ranch clock
  // (America/Denver, the same day boundary every balance uses). Not "the last
  // N groups": the measured record had 17 entries on one day and one each on
  // the nineteen behind it, so a count of days predicts nothing about volume.
  const ranchToday = new Date(new Date().toLocaleString('en-US', { timeZone: RANCH_TZ }))
  const dayKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const yesterday = new Date(ranchToday); yesterday.setDate(yesterday.getDate() - 1)
  const openDays = [dayKeyOf(ranchToday), dayKeyOf(yesterday)]

  // The active-filter sentence. Hiding a filter is only safe if a filtered
  // view can never look unfiltered, so this is what the collapsed row says.
  const activeFilterLabel = (() => {
    const bits: string[] = []
    if (filters.actor) bits.push(options.people.find(p => p.id === filters.actor)?.name ?? 'one person')
    if (filters.place) bits.push(options.places.find(p => p.id === filters.place)?.name ?? 'one place')
    if (filters.lot) bits.push(options.lots.find(l => l.id === filters.lot)?.name ?? 'one lot')
    if (filters.from || filters.to) bits.push([filters.from, filters.to].filter(Boolean).join(' to '))
    return bits.length > 0 ? bits.join(' · ') : null
  })()

  const entries: Entry[] = [...(page?.rows ?? []).map(r => ({ at: r.ts, event: r })), ...workRows.map(w => ({ at: w.startedAt, work: w }))].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const groups: { day: string; rows: Entry[] }[] = []
  for (const e of entries) { const d = dayKey(e.at); const g = groups[groups.length - 1]; if (g && g.day === d) g.rows.push(e); else groups.push({ day: d, rows: [e] }) }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-5" data-audit="column">
        <p className={EYEBROW}>The record</p>
        <h1 className="mt-1 type-page-heading text-ink">{heading}</h1>
        <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">Everything recorded on the ranch, newest first, by the day the work happened. Tap a line for the exact entry.</p>

        {failed ? (
          <Card className="mt-4 p-5" data-audit="activity-failed"><p className="font-dm-sans text-[17px] text-ink">The record couldn&rsquo;t be read just now. Nothing is lost; try again in a moment.</p></Card>
        ) : !page ? (
          <Card className="mt-4 p-5" data-audit="activity-no-permission"><p className="font-dm-sans text-[17px] text-ink">You are not on a ranch yet, so there is no record to show.</p></Card>
        ) : (
          <>
            <FilterShell active={activeFilterLabel} filtering={filtering}>
            <form method="get" action="/ranch/activity" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
              </div>
            </form>
            </FilterShell>

            {entries.length === 0 ? (
              <Card className="mt-4 p-5" data-audit="activity-empty"><p className="font-dm-sans text-[17px] text-ink">{filtering ? 'Nothing recorded matches those filters.' : 'Nothing recorded on the ranch yet.'}</p></Card>
            ) : (
              <ActivityDays
                openDays={openDays}
                groups={groups.map(g => ({
                  day: g.day,
                  label: fmtDay(`${g.day}T12:00:00-06:00`, 'long'),
                  count: g.rows.length,
                  body: (
                    <Card className="mt-2 p-0">
                      <ol className="divide-y divide-rule" data-audit="activity-list">
                        {/* Audit history (6B): every revision, each marked — replaced originals struck through. */}
                        {g.rows.map(e => e.event
                          ? <ActivityRowItem key={e.event.id} id={e.event.id} who={page.names.person(e.event.user_id)} line={describeEvent(e.event, page.names)} when={fmtTime(e.event.ts)} marker={markerFor(e.event)} />
                          : <ActivityRowItem key={e.work!.id} id={e.work!.id} who={e.work!.device ? `${e.work!.device} (Scout)` : 'A Scout'} line={describeWork(e.work!, fmtDuration)} when={fmtTime(e.work!.startedAt)} marker={null} href={`/jobs/${e.work!.id}`} audit="activity-row" />)}
                      </ol>
                    </Card>
                  ),
                }))}
              />
            )}

            {/* 6H: the review boundary moves only from a page that has every entry since the last review on it. */}
            {filters.since && !page.nextCursor && page.rows.length > 0 && <ReviewedButton count={page.rows.length} />}
            {filters.since && page.nextCursor && <p className="mt-3 font-dm-sans text-[15px] text-secondary-ink" data-audit="review-on-last-page">Reviewed is offered on the last page, once every entry is in front of you.</p>}
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
