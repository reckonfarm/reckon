import { createClient } from '@/lib/supabase-server'
import { Card } from '@/app/components/ui/Card'
import { getHayLedger } from '@/lib/hay/queries'
import { fmtDay, plural, todayKey, ranchYearStart } from '@/lib/jobs/format'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { LedgerPanel } from './LedgerTabs'

// ─── Hay — what you stacked, what you fed, what's left if you counted ─────────
// Same shape as SeasonTotals: a self-contained server component on the
// user-scoped client that returns null when there is nothing behind it.
// Every number keeps its provenance on screen:
//   * On hand only with a counted baseline, labeled with that count's date —
//     never stacked − fed alone (the logs can't know what the stack held
//     before logging started). A negative on-hand is printed, not hidden, and
//     the note points at the baseline's AGE, not at the count being wrong:
//     "more fed than your Sep 1 count of 200 bales; log a new count." A
//     baseline older than STALE_BASELINE_DAYS gets the same quiet nudge.
//   * Stacked / fed say how many entries (and days) stand behind them.
//   * Burn rate is a rate over the whole trailing window and says how many
//     of those days actually had a line.
//   * A run-out date appears only when the ledger's gates pass, and only as
//     "around … at N bales/day over the last 14 days" — a projection with
//     its basis, never a fact. Otherwise the burn rate stands alone.
// A stat with nothing behind it doesn't render as a zero — it doesn't render.

function ranchDay(key: string): string {
  // 'YYYY-MM-DD' ranch day → "Tue, Sep 1, 2026" (noon local avoids any DST edge)
  return fmtDay(`${key}T12:00:00-06:00`)
}

// Past this, the arithmetic is still right but a fresh count is worth more
// than the sum — feeding losses, weather, and a bale here and there add up.
const STALE_BASELINE_DAYS = 90

// Whole ranch days between two 'YYYY-MM-DD' keys.
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T12:00:00Z`) - Date.parse(`${fromKey}T12:00:00Z`)) / 86_400_000)
}

const entriesWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'entry' : 'entries'}`

function fmtRate(n: number): string {
  return n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1)
}

export default async function HayInventoryCard() {
  const supabase = await createClient()
  // Season-scoped read (this ranch year, capped); the latest count still
  // anchors on-hand even when it predates the floor — see getHayLedger.
  const { entries, summary } = await getHayLedger(supabase, { since: ranchYearStart() })
  if (entries.length === 0) return <LedgerPanel tab="hay" empty />

  const { stacked, fed, burnRate, onHand, runOut, range } = summary

  const stats: { value: string; label: string; sub?: string }[] = []
  if (onHand) {
    const b = onHand.baseline
    const count = `${ranchDay(b.asOf)} count`
    const age = daysBetween(b.asOf, todayKey())
    let sub: string
    if (onHand.bales < 0) {
      sub = `more fed than your ${count} of ${plural(b.bales, 'bale')}; log a new count.`
    } else if (age > STALE_BASELINE_DAYS) {
      sub = `from your ${count}, ${age} days ago · a fresh count would help.`
    } else {
      sub = `from your ${count}`
    }
    stats.push({
      value: onHand.bales.toLocaleString(),
      label: onHand.bales === 1 ? 'bale on hand' : 'bales on hand',
      sub,
    })
  }
  if (stacked) {
    stats.push({ value: stacked.bales.toLocaleString(), label: 'stacked', sub: `from ${entriesWord(stacked.entries)}` })
  }
  if (fed) {
    stats.push({ value: fed.bales.toLocaleString(), label: 'fed', sub: `${entriesWord(fed.entries)} · ${plural(fed.days, 'day')}` })
  }
  if (stats.length === 0 && !burnRate) return <LedgerPanel tab="hay" empty />

  let rateLine: string | null = null
  if (runOut.date) {
    const b = runOut.basis
    rateLine = `Runs out around ${ranchDay(runOut.date)} at ${fmtRate(b.balesPerDay)} bales/day over the last ${b.windowDays} days (fed on ${b.daysWithEntries} of ${b.windowDays}).`
  } else if (burnRate) {
    rateLine = `${fmtRate(burnRate.balesPerDay)} bales/day over the last ${burnRate.windowDays} days (fed on ${burnRate.daysWithEntries} of ${burnRate.windowDays}).`
  }

  return (
    <LedgerPanel tab="hay" empty={false}>
    <Card shadow="none" className="px-5 py-4">
      <p className={EYEBROW}>
        Hay
      </p>
      {stats.length > 0 && (
        <div className={`mt-3 grid gap-4 ${stats.length === 3 ? 'grid-cols-3' : stats.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {stats.map(s => (
            <div key={s.label}>
              <p className="font-fraunces text-2xl font-semibold tabular-nums text-forest-green">{s.value}</p>
              <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">{s.label}</p>
              {s.sub && <p className="font-dm-sans text-[11px] text-forest-green/40">{s.sub}</p>}
            </div>
          ))}
        </div>
      )}
      {rateLine && (
        <p className="mt-3 font-dm-sans text-sm text-forest-green/70">{rateLine}</p>
      )}
      {range && (
        <p className="mt-3 font-dm-sans text-xs text-forest-green/40">
          Since {fmtDay(range.from)} · from what you logged.
        </p>
      )}
    </Card>
    </LedgerPanel>
  )
}
