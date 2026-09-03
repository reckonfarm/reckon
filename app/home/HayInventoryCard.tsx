import { createClient } from '@/lib/supabase-server'
import { Card } from '@/app/components/ui/Card'
import { getHayLedger } from '@/lib/hay/queries'
import { fmtDay, plural } from '@/lib/jobs/format'

// ─── Hay — what you stacked, what you fed, what's left if you counted ─────────
// Same shape as SeasonTotals: a self-contained server component on the
// user-scoped client that returns null when there is nothing behind it.
// Every number keeps its provenance on screen:
//   * On hand only with a counted baseline, labeled with that count's date —
//     never stacked − fed alone (the logs can't know what the stack held
//     before logging started). A negative on-hand is printed, not hidden.
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

const entriesWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'entry' : 'entries'}`

function fmtRate(n: number): string {
  return n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1)
}

export default async function HayInventoryCard() {
  const supabase = await createClient()
  const { entries, summary } = await getHayLedger(supabase)
  if (entries.length === 0) return null

  const { stacked, fed, burnRate, onHand, runOut, range } = summary

  const stats: { value: string; label: string; sub?: string }[] = []
  if (onHand) {
    stats.push({
      value: onHand.bales.toLocaleString(),
      label: onHand.bales === 1 ? 'bale on hand' : 'bales on hand',
      sub: onHand.bales < 0
        ? `fed past your ${ranchDay(onHand.baseline.asOf)} count`
        : `from your ${ranchDay(onHand.baseline.asOf)} count`,
    })
  }
  if (stacked) {
    stats.push({ value: stacked.bales.toLocaleString(), label: 'stacked', sub: `from ${entriesWord(stacked.entries)}` })
  }
  if (fed) {
    stats.push({ value: fed.bales.toLocaleString(), label: 'fed', sub: `${entriesWord(fed.entries)} · ${plural(fed.days, 'day')}` })
  }
  if (stats.length === 0 && !burnRate) return null

  let rateLine: string | null = null
  if (runOut.date) {
    const b = runOut.basis
    rateLine = `Runs out around ${ranchDay(runOut.date)} at ${fmtRate(b.balesPerDay)} bales/day over the last ${b.windowDays} days (fed on ${b.daysWithEntries} of ${b.windowDays}).`
  } else if (burnRate) {
    rateLine = `${fmtRate(burnRate.balesPerDay)} bales/day over the last ${burnRate.windowDays} days (fed on ${burnRate.daysWithEntries} of ${burnRate.windowDays}).`
  }

  return (
    <Card shadow="none" className="px-5 py-4">
      <p className="font-dm-sans text-xs font-medium uppercase tracking-wide text-forest-green/40">
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
  )
}
