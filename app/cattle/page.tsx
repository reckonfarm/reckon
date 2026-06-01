import type { Metadata } from 'next'
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'
import SiteHeader from '@/app/components/SiteHeader'
import { getCattleMarket, type CattleMarket, type FeederClass } from '@/lib/cattle-market-service'
import CattleMarketPanel from '@/app/dashboard/components/CattleMarketPanel'
import CullCowPanel from '@/app/dashboard/components/CullCowPanel'
import CalfValueCalculator from '@/app/dashboard/components/CalfValueCalculator'
import CattleWeightCurve from '@/app/dashboard/components/CattleWeightCurve'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Cattle Market — Montana feeder & cull-cow prices',
  description:
    'This week’s Montana auction prices for feeder cattle and cull cows, from USDA AMS Market News — with a calf-value calculator and the drought-to-price market read.',
}

const DEFAULT_FIPS = '30069' // Petroleum County, MT — the home operation

// ─── County drought status (READ ONLY — for the market read) ─────────────────────

interface DroughtStatus {
  level: number | null // 0–4, or null if not in drought / no data
  label: string        // human label for the market-read sentence
}

const DROUGHT_LABELS: Record<number, string> = {
  4: 'D4 (exceptional drought)',
  3: 'D3 (extreme drought)',
  2: 'D2 (severe drought)',
  1: 'D1 (moderate drought)',
  0: 'D0 (abnormally dry)',
}

function deriveDrought(row: { d0: number | null; d1: number | null; d2: number | null; d3: number | null; d4: number | null } | null): DroughtStatus {
  if (!row) return { level: null, label: 'not currently rated for drought' }
  // USDM values are cumulative ("D2 or worse"); the worst category with ≥5% area is the headline.
  const vals: Array<[number, number]> = [
    [4, row.d4 ?? 0], [3, row.d3 ?? 0], [2, row.d2 ?? 0], [1, row.d1 ?? 0], [0, row.d0 ?? 0],
  ]
  const worst = vals.find(([, pct]) => pct >= 5)
  if (!worst) return { level: null, label: 'not currently in drought' }
  return { level: worst[0], label: DROUGHT_LABELS[worst[0]] }
}

// ─── Market read (LIVE data only — no hardcoded macro numbers) ────────────────────

function pickHeadlineFeeder(m: CattleMarket): { label: string; row: FeederClass } | null {
  const five = m.feeder.steers.find(c => c.weightClass === '5-6')
  if (five) return { label: '500–600 lb feeder steers', row: five }
  if (m.feeder.steers[0]) return { label: `${m.feeder.steers[0].label} feeder steers`, row: m.feeder.steers[0] }
  if (m.feeder.heifers[0]) return { label: `${m.feeder.heifers[0].label} feeder heifers`, row: m.feeder.heifers[0] }
  return null
}

function MarketRead({ countyName, drought, market }: { countyName: string; drought: DroughtStatus; market: CattleMarket }) {
  if (market.status !== 'ok') {
    return (
      <div className="rounded-xl border border-forest-green/10 bg-white px-5 py-4">
        <p className="font-dm-sans text-sm text-forest-green/60">
          Cattle market data is temporarily unavailable — check back shortly.
        </p>
      </div>
    )
  }

  const r = market.receipts
  const recTrend =
    r.current != null && r.lastReported != null
      ? r.current > r.lastReported ? 'up' : r.current < r.lastReported ? 'down' : 'about steady'
      : null

  const headline = pickHeadlineFeeder(market)

  // Build the drought → supply → price sentence entirely from live data.
  const droughtClause =
    drought.level != null
      ? `${countyName} is in ${drought.label}.`
      : `${countyName} is ${drought.label}.`

  const receiptsClause =
    recTrend && r.current != null && r.lastReported != null
      ? ` Montana auction receipts ran ${recTrend}${recTrend !== 'about steady' ? '' : ''} this week (${r.current.toLocaleString()} head vs ${r.lastReported.toLocaleString()} last reported).`
      : r.current != null
        ? ` Montana auctions ran ${r.current.toLocaleString()} head this week.`
        : ''

  const priceClause = headline
    ? ` ${headline.label} averaged $${headline.row.avgCwt.toFixed(2)}/cwt`
    : market.cullCows
      ? ` Cull cows averaged $${market.cullCows.avgCwt.toFixed(2)}/cwt`
      : ''

  const cullClause =
    headline && market.cullCows ? `, and cull cows $${market.cullCows.avgCwt.toFixed(2)}/cwt` : ''

  const windowClause = market.reportWindowLabel ? ` (week of ${market.reportWindowLabel}).` : '.'

  return (
    <div className="rounded-xl border-l-4 border-l-forest-green border border-forest-green/10 bg-white px-5 py-4 shadow-[0_2px_12px_rgba(27,67,50,0.08)]">
      <p className="font-dm-sans text-[11px] font-medium uppercase tracking-wide text-forest-green/40">Market read</p>
      <p className="mt-1.5 font-fraunces text-base font-semibold leading-snug text-forest-green sm:text-lg">
        {droughtClause}{receiptsClause}{priceClause}{cullClause}{windowClause}
      </p>
      <p className="mt-2 font-dm-sans text-xs text-forest-green/40">
        Drought from the U.S. Drought Monitor; prices from USDA AMS Market News (Report 1778). Cash auction
        data only — no futures.
      </p>
    </div>
  )
}

// ─── Seasonal feeder note (Pillar 4) ─────────────────────────────────────────────

function SeasonalFeederNote() {
  return (
    <div className="rounded-md bg-forest-green/4 px-4 py-3">
      <p className="font-dm-sans text-[11px] font-medium uppercase tracking-wide text-forest-green/40">
        Seasonal context — feeders
      </p>
      <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/70">
        As a general tendency, lighter calves (5-weights) have often been seasonally firmer in spring and
        softer in fall as calves come off grass — but recent years, with tight cattle supplies, have repeatedly
        defied that pattern. Treat it as background, not a prediction of where prices go next.
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CattleMarketPage({
  searchParams,
}: {
  searchParams: Promise<{ fips?: string }>
}) {
  const { fips: fipsParam } = await searchParams
  const fips = fipsParam || DEFAULT_FIPS
  const db = createServiceClient()

  const [{ data: county }, market] = await Promise.all([
    db.from('counties').select('id, name, state').eq('fips', fips).single(),
    getCattleMarket(),
  ])

  let drought: DroughtStatus = { level: null, label: 'not currently rated for drought' }
  let countyName = 'Your county'
  if (county) {
    countyName = `${county.name}, ${county.state}`
    const { data: latest } = await db
      .from('drought_data')
      .select('d0, d1, d2, d3, d4')
      .eq('county_id', county.id)
      .order('week_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    drought = deriveDrought(
      (latest as { d0: number | null; d1: number | null; d2: number | null; d3: number | null; d4: number | null } | null) ?? null,
    )
  }

  const ok = market.status === 'ok'

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader subtitle="Cattle Market" center={county ? `${county.name}, ${county.state}` : undefined} />

      <main className="mx-auto max-w-2xl px-4 py-6 pb-16 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="font-fraunces text-2xl font-semibold text-forest-green">Cattle Market</h1>
            <p className="mt-0.5 font-dm-sans text-sm text-forest-green/50">
              Montana auction prices · USDA AMS Market News
            </p>
          </div>
          <Link
            href={`/dashboard?fips=${fips}`}
            className="shrink-0 font-dm-sans text-sm text-forest-green/60 underline hover:text-forest-green"
          >
            Drought dashboard →
          </Link>
        </div>

        <div className="space-y-4">
          <MarketRead countyName={countyName} drought={drought} market={market} />

          {ok ? (
            <>
              <CattleMarketPanel data={market} />

              <CalfValueCalculator
                steers={market.feeder.steers}
                heifers={market.feeder.heifers}
                asOfLabel={market.asOfLabel}
              />

              <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-[0_2px_12px_rgba(27,67,50,0.08)]">
                <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
                  <h2 className="font-fraunces text-base font-semibold text-forest-green">Price by weight</h2>
                  <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">
                    Avg $/cwt across weight classes — steers vs heifers
                  </p>
                </div>
                <div className="p-4 sm:p-6">
                  <CattleWeightCurve steers={market.feeder.steers} heifers={market.feeder.heifers} />
                  <div className="mt-4">
                    <SeasonalFeederNote />
                  </div>
                </div>
              </div>

              <CullCowPanel data={market} />
            </>
          ) : (
            <div className="rounded-xl border border-forest-green/10 bg-white px-6 py-8 text-center">
              <p className="font-dm-sans text-sm text-forest-green/60">
                Cattle market data is temporarily unavailable — check back shortly.
              </p>
            </div>
          )}

          <p className="pt-2 text-center font-dm-sans text-[11px] leading-snug text-forest-green/40">
            Informational only — not financial or trading advice.
          </p>
        </div>
      </main>
    </div>
  )
}
