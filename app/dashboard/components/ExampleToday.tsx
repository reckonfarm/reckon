import Link from 'next/link'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import ActivityRowItem from '@/app/components/ActivityRowItem'
import ExampleBanner from '@/app/components/ExampleBanner'
import LogIt from './LogIt'
import LedgerTabs, { LedgerPanel } from './LedgerTabs'
import RepeatLastCard from './RepeatLastCard'
import ExampleHayCard from './ExampleHayCard'
import { exampleFeedings, exampleSince } from '@/lib/example-ranch'
import { dayKey, fmtDay, fmtTime, todayKey } from '@/lib/jobs/format'

// ─── Today on the example ranch (Block 49, ruling R2) ────────────────────────
// What a signed-out person sees at /today: the Dry Creek ranch's Today — what
// the hand recorded since the owner checked, the feedings the ranch repeats,
// Record, and the two ledgers — rendered from the committed fixture. No ranch
// table is read. Every save control on it is real and opens the sign-in sheet
// (R1); nothing here is a button that does nothing.

function when(iso: string): string {
  const d = dayKey(iso)
  if (d === todayKey()) return `today ${fmtTime(iso)}`
  if (d === dayKey(Date.now() - 86_400_000)) return `yesterday ${fmtTime(iso)}`
  return `${fmtDay(iso)} ${fmtTime(iso)}`
}

export default function ExampleToday() {
  const since = exampleSince()
  const feedings = exampleFeedings()
  return (
    <div className="mb-8 space-y-4" data-audit="example-today">
      <ExampleBanner />
      {since.rows.length > 0 && (
        <Card shadow="soft" className="p-4 sm:p-5" data-audit="example-since">
          <p className={EYEBROW}>Recorded since you checked</p>
          <ul className="mt-3 divide-y divide-forest-green/10">
            {since.rows.map(r => (
              <ActivityRowItem key={r.id} id={r.id} who={r.who} line={r.line} when={when(r.workedAt)} marker={r.marker} chain={[]} audit="since-row" rowClass="py-2" sep=" " />
            ))}
          </ul>
          {since.total > since.rows.length && (
            <Link href={`/ranch/activity?since=${encodeURIComponent(since.lastSeen)}`} className="mt-1 inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2" data-audit="since-view-all">View all {since.total} updates →</Link>
          )}
        </Card>
      )}
      {feedings.length > 0 && <RepeatLastCard feedings={feedings} />}
      <LogIt sheet={false} />
      <div id="ledgers" />
      <LedgerTabs season={<LedgerPanel tab="season" empty />} hay={<ExampleHayCard heading={false} />} />
    </div>
  )
}
