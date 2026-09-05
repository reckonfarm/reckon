import { getAuctionSeries, getNationalSeries, getCornSeries, getCycleSeries, getMarketEvents } from '@/lib/markets/series'
import { scopeLabel } from '@/lib/market-scope'
import { lotToMarsKey, lotLabel, type Lot } from '@/lib/herd'
import type { ResolveResult } from '@/lib/barn-geo'
import MarketsChartsLoader from './MarketsChartsLoader'

// Server side of the Markets charts (Block 2.5, Part B): reads the series the
// tables actually hold and hands observations — never fills — to the client
// chart. The person's first feeder lot (steers/heifers) powers the lot-value
// measure; nothing else about the herd reaches the chart.
export default async function MarketsHistory({ resolved, lots }: { resolved: ResolveResult; lots: Lot[] }) {
  const slugs = [...new Set([...resolved.ranked, ...resolved.stale].map(b => b.slug_id))]
  const localBarn = resolved.local[0] ?? resolved.nearest_comp ?? null
  const [auction, n500, n700, corn, cycle, events] = await Promise.all([
    getAuctionSeries(slugs),
    getNationalSeries('feeder_steer_500'),
    getNationalSeries('feeder_steer_700'),
    getCornSeries(),
    getCycleSeries(),
    getMarketEvents(),
  ])
  const feederLot = lots.find(l => l.class === 'steers' || l.class === 'heifers' || l.class === 'yearlings') ?? null
  const lot = feederLot ? { head: feederLot.head_count, weightLb: lotToMarsKey(feederLot).avgWeightLb, label: `${lotLabel(feederLot)} · ${feederLot.head_count} head` } : null
  const dates = auction.flatMap(s => s.points.map(p => p.date)).sort()
  const town = localBarn?.town.replace(/,\s*[A-Z]{2}$/, '') ?? ''
  return (
    <MarketsChartsLoader
      auction={auction}
      localSlug={localBarn?.slug_id ?? null}
      localLabel={localBarn ? scopeLabel(resolved.pinned === localBarn.slug_id ? { kind: 'pinned', town } : { kind: 'nearby', town }) : 'No nearby barn'}
      national={{ feeder_steer_500: n500, feeder_steer_700: n700 }}
      corn={corn}
      cycle={cycle}
      events={events}
      lot={lot}
      spineStart={dates[0] ?? null}
    />
  )
}
