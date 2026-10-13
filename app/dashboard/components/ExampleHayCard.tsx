import { Card } from '@/app/components/ui/Card'
import Disclosure from '@/app/components/ui/Disclosure'
import { planToTurnout } from '@/lib/hay/plan'
import { suggestedTurnout } from '@/lib/hay/turnout'
import HayToTurnout from './HayToTurnout'
import { explainOnHand } from '@/lib/hay/explain'
import { fmtDay, plural, todayKey, fmtTime } from '@/lib/jobs/format'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { LedgerPanel } from './LedgerTabs'
import ActivityRowItem from '@/app/components/ActivityRowItem'
import { exampleRanch } from '@/lib/example-ranch'

// ─── Hay on the example ranch (Block 49) ─────────────────────────────────────
// HayInventoryCard, rendered from the Dry Creek fixture instead of the ranch's
// ledger: the same card, the same words, the same pure summariser. The number
// is not a control here — a tap on it would be a save, and the example ranch
// takes none; Record (the sheet) is where a signed-out tap meets the ask.

function ranchDay(key: string): string { return fmtDay(`${key}T12:00:00-06:00`) }
const STALE_BASELINE_DAYS = 90
function daysBetween(fromKey: string, toKey: string): number { return Math.round((Date.parse(`${toKey}T12:00:00Z`) - Date.parse(`${fromKey}T12:00:00Z`)) / 86_400_000) }
const entriesWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'entry' : 'entries'}`
const fmtRate = (n: number) => (n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1))

export default function ExampleHayCard({ heading = true }: { heading?: boolean } = {}) {
  const { hay, turnout } = exampleRanch()
  const { entries, summary } = hay
  if (entries.length === 0) return <LedgerPanel tab="hay" empty />
  const { stacked, fed, burnRate, onHand, runOut, range } = summary
  const stats: { value: string; label: string; sub?: string }[] = []
  let equation: { line: string; note: string | null } | null = null
  if (onHand) {
    const b = onHand.baseline
    const age = daysBetween(b.asOf, todayKey())
    const x = explainOnHand(onHand)
    const stale = age > STALE_BASELINE_DAYS ? `counted ${age} days ago` : null
    equation = { line: `${x.equation}, ${x.scope}.`, note: x.shortfall ? `${x.shortfall[0].toUpperCase()}${x.shortfall.slice(1)}.` : stale }
    stats.push({ value: onHand.bales.toLocaleString(), label: onHand.bales === 1 ? 'bale on hand' : 'bales on hand', sub: `across the ranch · since your ${ranchDay(b.asOf)} count` })
  }
  const season: string[] = []
  if (stacked) season.push(`${stacked.bales.toLocaleString()} stacked from ${entriesWord(stacked.entries)}`)
  if (fed) season.push(`${fed.bales.toLocaleString()} fed · ${entriesWord(fed.entries)} · ${plural(fed.days, 'day')}`)
  if (stats.length === 0 && season.length === 0 && !burnRate) return <LedgerPanel tab="hay" empty />
  let rateLine: string | null = null
  if (runOut.date) {
    const b = runOut.basis
    rateLine = `Runs out around ${ranchDay(runOut.date)} at ${fmtRate(b.balesPerDay)} bales/day over the last ${b.windowDays} days (fed on ${b.daysWithEntries} of ${b.windowDays}).`
  } else if (burnRate) {
    rateLine = `${fmtRate(burnRate.balesPerDay)} bales/day over the last ${burnRate.windowDays} days (fed on ${burnRate.daysWithEntries} of ${burnRate.windowDays}).`
  }
  return (
    <LedgerPanel tab="hay" empty={false}>
    <Card shadow="none" className="px-5 py-4" data-audit="example-hay">
      {heading && <p className={EYEBROW}>Hay on hand</p>}
      {stats.length > 0 && (
        <div className={`${heading ? 'mt-3 ' : ''}grid gap-4 grid-cols-1`}>
          {stats.map(s => (
            <div key={s.label}>
              <p className="type-main-number text-ink" data-audit="hay-on-hand">{s.value}</p>
              <p className="mt-1.5 font-dm-sans text-[16px] text-ink">{s.label}</p>
              {s.sub && <p className="font-dm-sans text-[14px] text-ink">{s.sub}</p>}
            </div>
          ))}
        </div>
      )}
      <HayToTurnout plan={planToTurnout({ turnout: turnout.upcoming?.date ?? null, onHand, entries })} turnout={{ ...turnout, suggested: suggestedTurnout(turnout.last) }} />
      {(equation || rateLine || range || season.length > 0) && (
        <Disclosure title="Details" audit="hay-details" className="mt-3" summary={undefined}>
          {equation && <p className="font-dm-sans text-[16px] text-ink" data-audit="hay-equation">{equation.line}{equation.note ? ` ${equation.note}` : ''}</p>}
          {season.length > 0 && <p className="mt-3 font-dm-sans text-[16px] text-ink" data-audit="hay-season">{season.join(' · ')}</p>}
          {rateLine && <p className="mt-3 font-dm-sans text-[16px] text-ink">{rateLine}</p>}
          {entries.length > 0 && (
            <ul className="mt-3 divide-y divide-forest-green/10" data-audit="hay-lines">
              {[...entries].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 5).map(e => (
                <ActivityRowItem key={e.id} id={e.id} line={e.type === 'hay_fed' ? `Fed ${plural(e.bales, 'bale')}` : e.type === 'bales_stacked' ? `Stacked ${plural(e.bales, 'bale')}` : `Counted ${e.bales.toLocaleString()} bales on hand`} when={`${fmtDay(e.ts)} ${fmtTime(e.ts)}`} marker={null} chain={[]} audit="hay-line" rowClass="py-2" />
              ))}
            </ul>
          )}
          {range && <p className="mt-3 font-dm-sans text-[14px] text-ink">{onHand ? `Since your ${ranchDay(onHand.baseline.asOf)} count` : `Since ${fmtDay(range.from)}`}</p>}
        </Disclosure>
      )}
    </Card>
    </LedgerPanel>
  )
}
