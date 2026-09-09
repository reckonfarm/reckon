import { cache } from 'react'
import { getAuctionSeries, getNationalSeries, getCornSeries, getCycleSeries, getMarketEvents } from '@/lib/markets/series'
import { scopeLabel } from '@/lib/market-scope'
import { lotToMarsKey, lotLabel, type Lot } from '@/lib/herd'
import type { ResolveResult } from '@/lib/barn-geo'
import MarketsChartsLoader from './MarketsChartsLoader'

// Server side of the Markets charts (Block 2.5, Part B): reads the series the
// tables actually hold and hands observations — never fills — to the client
// chart. The person's first feeder lot (steers/heifers) powers the lot-value
// measure; nothing else about the herd reaches the chart.
// One read per request, shared by the cattle chart and the Market-context chart (Block 6B).
const loadSeries = cache(async (slugKey: string) => {
  const slugs = slugKey ? slugKey.split(',') : []
  return Promise.all([getAuctionSeries(slugs), getNationalSeries('feeder_steer_500'), getNationalSeries('feeder_steer_700'), getCornSeries(), getCycleSeries(), getMarketEvents()])
})

export default async function MarketsHistory({ resolved, lots, selectedLotId = null, mode = 'cattle' }: { resolved: ResolveResult; lots: Lot[]; selectedLotId?: string | null; mode?: 'cattle' | 'context' }) {
  const slugs = [...new Set([...resolved.ranked, ...resolved.stale].map(b => b.slug_id))]
  const localBarn = resolved.local[0] ?? resolved.nearest_comp ?? null
  // Block 2.6A — a barn beyond the discovery radius is a regional reference, never "Nearby".
  const isReference = resolved.local.length === 0 && !!resolved.nearest_comp
  const [auction, n500, n700, corn, cycle, events] = await loadSeries(slugs.sort().join(','))
  const isFeeder = (l: Lot) => l.class === 'steers' || l.class === 'heifers' || l.class === 'yearlings'
  // Block 6B: the selected lot (?lot=) drives the chart's lot measure when it is a feeder lot; else the first feeder lot.
  const feederLot = (selectedLotId ? lots.find(l => l.id === selectedLotId && isFeeder(l)) : null) ?? lots.find(isFeeder) ?? null
  // 6I: the selected lot drives the chart's class AND weight band, not only the lot measure —
  // a replacement-heifer lot charts feeder heifers of its weight (its reference), never the steers.
  const lot = feederLot ? (() => { const w = lotToMarsKey(feederLot).avgWeightLb; return { head: feederLot.head_count, weightLb: w, label: `${lotLabel(feederLot)} · ${feederLot.head_count} head`, cls: (feederLot.class === 'heifers' ? 'Heifers' : 'Steers') as 'Steers' | 'Heifers', band: String(Math.max(300, Math.min(900, Math.floor(w / 100) * 100))) } })() : null
  const dates = auction.flatMap(s => s.points.map(p => p.date)).sort()
  const town = localBarn?.town.replace(/,\s*[A-Z]{2}$/, '') ?? ''
  return (
    <MarketsChartsLoader
      auction={auction}
      localSlug={localBarn?.slug_id ?? null}
      localLabel={localBarn
        ? scopeLabel(resolved.pinned === localBarn.slug_id ? { kind: 'pinned', town }
          : isReference ? { kind: 'reference', town: localBarn.town, miles: localBarn.miles }
          : { kind: 'nearby', town })
        : 'No nearby barn'}
      national={{ feeder_steer_500: n500, feeder_steer_700: n700 }}
      corn={corn}
      cycle={cycle}
      events={events}
      lot={lot}
      spineStart={dates[0] ?? null}
      mode={mode}
    />
  )
}
