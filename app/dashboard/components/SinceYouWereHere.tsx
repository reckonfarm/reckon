import Link from 'next/link'
import { getChangesSince } from '@/lib/since'
import { createClient } from '@/lib/supabase-server'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { dayKey, fmtDay, fmtTime, todayKey } from '@/lib/jobs/format'
import ReviewedButton from '@/app/components/ReviewedButton'
import ActivityRowItem from '@/app/components/ActivityRowItem'

// ─── Since you last checked (Block 2E) ────────────────────────────────────────
// What the OTHER people (and the alert service) put in the ranch ledger since
// this person's last visit: who, when, what changed — each line a link to the
// underlying record (the place page when the entry names a place, else the
// ledger tabs). Sourced from events whose INGESTED time is after
// ranch_members.last_seen_at (044) — an entry synced late from a phone still
// counts as news — shown with the time it HAPPENED. The person's own entries
// are not news to them. Nothing new → the block does not render at all.
// Seen is not done, and seen is not "the page loaded" (6H): the boundary moves only
// when the person presses Reviewed with every entry in front of them.

// Block 6A: 3–5 rows on Today, the rest behind "View all N updates" (the record, filtered to the same window).



// The work day on every line (5F): "today 6:01 PM", "yesterday 6:01 PM", "Sep 1 6:01 PM".
function when(iso: string): string {
  const d = dayKey(iso)
  if (d === todayKey()) return `today ${fmtTime(iso)}`
  if (d === dayKey(Date.now() - 86_400_000)) return `yesterday ${fmtTime(iso)}`
  return `${fmtDay(iso)} ${fmtTime(iso)}`
}

export default async function SinceYouWereHere() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // Block 29: the same read the map's stepper makes — one list, two readers.
  const since = await getChangesSince(supabase, user.id)
  if (!since) return null
  const { changes: rows, total, lastSeen } = since
  // Block 6A copy: nothing new is said in words, never "All work complete".
  if (rows.length === 0) {
    return (
      <Card shadow="soft" className="p-4 sm:p-5" data-audit="since-empty">
        <p className={EYEBROW}>Recorded since you checked</p>
        <p className="mt-2 font-dm-sans text-[16px] text-secondary-ink">No new crew entries since your last review{lastSeen ? ` (${when(lastSeen)})` : ''}.</p>
        <Link href="/ranch/activity" className="mt-1 inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="since-recent-link">Recent crew entries →</Link>
      </Card>
    )
  }
  return (
    <Card shadow="soft" className="p-4 sm:p-5">
      <p className={EYEBROW}>Recorded since you checked</p>
      <ul className="mt-3 divide-y divide-forest-green/10">
        {rows.map(r => (
          // 6B: the same row component as every timeline — a correction or a void is marked, not prefixed.
          <ActivityRowItem key={r.id} id={r.id} who={r.who} line={r.line} when={when(r.workedAt)} marker={r.marker} chain={[]} audit="since-row" rowClass="py-2" sep=" " />
        ))}
      </ul>
      {/* 6H: Reviewed only when every entry is on this card; otherwise the whole list carries it. */}
      {total <= rows.length && <ReviewedButton count={total} through={since.newest} />}
      {total > rows.length && (
        <Link href={`/ranch/activity?since=${encodeURIComponent(since.since)}`} className="mt-1 inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="since-view-all">View all {total} updates →</Link>
      )}
    </Card>
  )
}
