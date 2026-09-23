import { Card } from '@/app/components/ui/Card'
import ActivityDays from './ActivityDays'
import ActivityRowItem, { markerFor } from '@/app/components/ActivityRowItem'
import { describeEvent, type ActivityPage } from '@/lib/activity'
import { describeWork, type WorkRow } from '@/lib/jobs/work'
import { fmtDay, fmtTime, dayKey, fmtDuration, RANCH_TZ } from '@/lib/jobs/format'

// ─── The record, grouped by day (Block 47 lifted this out of the Activity page) ──
// Rows grouped by ranch day so "Tuesday" reads as a heading, not a hunt; today
// and yesterday open, older days one tap away (8B.3). The same list on the
// Activity page and on the Ranch view's record tab.
type Entry = { at: string; event?: ActivityPage['rows'][number]; work?: WorkRow }

export default function ActivityGroups({ page, workRows = [], audit = 'activity-list' }: { page: ActivityPage; workRows?: WorkRow[]; audit?: string }) {
  const ranchToday = new Date(new Date().toLocaleString('en-US', { timeZone: RANCH_TZ }))
  const dayKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const yesterday = new Date(ranchToday); yesterday.setDate(yesterday.getDate() - 1)
  const openDays = [dayKeyOf(ranchToday), dayKeyOf(yesterday)]
  const entries: Entry[] = [...page.rows.map(r => ({ at: r.ts, event: r })), ...workRows.map(w => ({ at: w.startedAt, work: w }))].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const groups: { day: string; rows: Entry[] }[] = []
  for (const e of entries) { const d = dayKey(e.at); const g = groups[groups.length - 1]; if (g && g.day === d) g.rows.push(e); else groups.push({ day: d, rows: [e] }) }
  return (
    <ActivityDays
      openDays={openDays}
      groups={groups.map(g => ({
        day: g.day,
        label: fmtDay(`${g.day}T12:00:00-06:00`, 'long'),
        count: g.rows.length,
        body: (
          <Card className="mt-2 p-0">
            <ol className="divide-y divide-rule" data-audit={audit}>
              {g.rows.map(e => e.event
                ? <ActivityRowItem key={e.event.id} id={e.event.id} who={page.names.person(e.event.user_id)} line={describeEvent(e.event, page.names)} when={fmtTime(e.event.ts)} marker={markerFor(e.event)} />
                : <ActivityRowItem key={e.work!.id} id={e.work!.id} who={e.work!.device ? `${e.work!.device} (Scout)` : 'A Scout'} line={describeWork(e.work!, fmtDuration)} when={fmtTime(e.work!.startedAt)} marker={null} chain={[]} href={`/jobs/${e.work!.id}`} />)}
            </ol>
          </Card>
        ),
      }))}
    />
  )
}
