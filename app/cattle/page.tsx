import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase'
import SiteHeader from '@/app/components/SiteHeader'
import DroughtCattleToggle from '@/app/components/DroughtCattleToggle'
import { getCattleMarket, slugForState, MONTANA_SLUG, type CattleMarket, type FeederClass } from '@/lib/cattle-market-service'
import CattleMarketPanel from '@/app/dashboard/components/CattleMarketPanel'
import CountySelector from '@/app/dashboard/components/CountySelector'
import CullCowPanel from '@/app/dashboard/components/CullCowPanel'
import CalfValueCalculator from '@/app/dashboard/components/CalfValueCalculator'
import CattleWeightCurve from '@/app/dashboard/components/CattleWeightCurve'
import ShareButton from '@/app/components/ShareButton'
import { droughtSeverity, type DroughtSeverity, type UsdmReading } from '@/lib/drought-severity'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Cattle Market — Montana feeder & cull-cow prices',
  description:
    'This week’s Montana auction prices for feeder cattle and cull cows, from USDA AMS Market News — with a calf-value calculator and the drought-to-price market read.',
}

// No hardcoded default county — a cold/no-county visit shows NATIONAL data, never
// a Montana/Petroleum default. Drought (per-county) comes from the shared
// droughtSeverity helper so the cattle read and the dashboard agree.

// ─── Market read (LIVE data only — no hardcoded macro numbers) ────────────────────

function pickHeadlineFeeder(m: CattleMarket): { label: string; row: FeederClass } | null {
  const five = m.feeder.steers.find(c => c.weightClass === '5-6')
  if (five) return { label: '500–600 lb feeder steers', row: five }
  if (m.feeder.steers[0]) return { label: `${m.feeder.steers[0].label} feeder steers`, row: m.feeder.steers[0] }
  if (m.feeder.heifers[0]) return { label: `${m.feeder.heifers[0].label} feeder heifers`, row: m.feeder.heifers[0] }
  return null
}

function MarketRead({ countyName, drought, market, scope }: {
  countyName: string | null     // null → no county selected (neutral national prompt)
  drought: DroughtSeverity
  market: CattleMarket
  scope: 'Montana' | 'National'
}) {
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

  // No county → neutral prompt (no drought we don't have); else the county's drought line.
  const leadClause = countyName
    ? (drought.level != null ? `${countyName} is in ${drought.label}.` : `${countyName} is ${drought.label}.`)
    : `Pick your county to see local drought conditions.`

  const receiptsClause =
    recTrend && r.current != null && r.lastReported != null
      ? ` ${scope} auction receipts ran ${recTrend} this week (${r.current.toLocaleString()} head vs ${r.lastReported.toLocaleString()} last reported).`
      : r.current != null
        ? ` ${scope} auctions ran ${r.current.toLocaleString()} head this week.`
        : ''

  const priceClause = headline
    ? ` ${headline.label} averaged $${headline.row.avgCwt.toFixed(2)}/cwt`
    : market.cullCows
      ? ` Cull cows averaged $${market.cullCows.avgCwt.toFixed(2)}/cwt`
      : ''

  const cullClause =
    headline && market.cullCows ? `, and cull cows $${market.cullCows.avgCwt.toFixed(2)}/cwt` : ''

  const windowClause = market.reportWindowLabel ? ` (week of ${market.reportWindowLabel}).` : '.'

  const sourceLine = scope === 'Montana'
    ? 'Drought from the U.S. Drought Monitor; prices from USDA AMS Market News (Montana, Report 1778). Cash auction data only — no futures.'
    : 'Prices from the USDA AMS National Feeder & Stocker Cattle Summary; drought from the U.S. Drought Monitor. Cash auction data only — no futures.'

  return (
    <div className="rounded-xl border-l-4 border-l-forest-green border border-forest-green/10 bg-white px-5 py-4 shadow-[0_2px_12px_rgba(27,67,50,0.08)]">
      <p className="font-dm-sans text-[11px] font-medium uppercase tracking-wide text-forest-green/40">Market read</p>
      <p className="mt-1.5 font-fraunces text-base font-semibold leading-snug text-forest-green sm:text-lg">
        {leadClause}{receiptsClause}{priceClause}{cullClause}{windowClause}
      </p>
      <p className="mt-2 font-dm-sans text-xs text-forest-green/40">{sourceLine}</p>
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
  const fips = fipsParam || null // NO default — no county → national
  const db = createServiceClient()

  // Resolve the selected county (if any) → state → which report slug to read.
  const county = fips
    ? ((await db.from('counties').select('id, fips, name, state').eq('fips', fips).single()).data as
        { id: number; fips: string; name: string; state: string } | null)
    : null
  const state = county?.state ?? null
  const slug = slugForState(state)
  const isMontana = slug === MONTANA_SLUG
  const scope: 'Montana' | 'National' = isMontana ? 'Montana' : 'National'

  const market = await getCattleMarket(slug)

  let drought: DroughtSeverity = { level: null, label: 'not currently rated for drought', severityWord: '' }
  let countyName: string | null = null
  if (county) {
    countyName = `${county.name}, ${county.state}`
    const { data: latest } = await db
      .from('drought_data')
      .select('d0, d1, d2, d3, d4')
      .eq('county_id', county.id)
      .order('week_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    drought = droughtSeverity((latest as UsdmReading | null) ?? null)
  }

  const ok = market.status === 'ok'
  const heading = isMontana ? 'Cattle Market' : 'U.S. Cattle Market'
  const subhead = isMontana
    ? 'Montana auction prices · USDA AMS Market News'
    : 'National Feeder & Stocker Summary · USDA AMS'

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader subtitle="Cattle Market" center={county ? `${county.name}, ${county.state}` : undefined} />

      <main className="mx-auto max-w-2xl px-4 py-6 pb-16 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-fraunces text-2xl font-semibold text-forest-green">{heading}</h1>
            <p className="mt-0.5 font-dm-sans text-sm text-forest-green/50">{subhead}</p>
          </div>
          {/* Share: county+drought when a real county is selected; neutral national payload otherwise. */}
          <ShareButton
            fips={county ? fips : null}
            countyLabel={countyName}
            droughtLabel={drought.level != null ? drought.label : null}
            surface="cattle"
          />
        </div>

        <div className="space-y-4">
          {/* County picker works signed-out; routes fips into /cattle (MT swaps to MT prices). */}
          <CountySelector selectedCounty={county} basePath="/cattle" />

          {fips && county && <DroughtCattleToggle fips={fips} active="cattle" />}

          <MarketRead countyName={countyName} drought={drought} market={market} scope={scope} />

          {county && !isMontana && (
            <div className="rounded-md bg-forest-green/4 px-4 py-2.5">
              <p className="font-dm-sans text-sm text-forest-green/70">
                Showing national cattle prices — state-level prices for {county.state} coming soon.
              </p>
            </div>
          )}

          {ok && market.stale && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="font-dm-sans text-sm font-semibold text-amber-900">
                {scope === 'National'
                  ? `National prices below are from ${market.asOfLabel ?? 'an earlier report'} — the latest available. Live national data is coming soon.`
                  : `Prices below are from ${market.asOfLabel ?? 'an earlier report'} — the latest available, not current.`}
              </p>
            </div>
          )}

          {ok ? (
            <>
              <CattleMarketPanel data={market} />

              <CalfValueCalculator
                steers={market.feeder.steers}
                heifers={market.feeder.heifers}
                asOfLabel={market.asOfLabel}
                stale={market.stale}
                scopeLabel={scope === 'National' ? 'national' : ''}
              />

              <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-[0_2px_12px_rgba(27,67,50,0.08)]">
                <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-fraunces text-base font-semibold text-forest-green">Price by weight</h2>
                    {market.stale && market.asOfLabel && (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 font-dm-sans text-[11px] font-semibold text-amber-900">
                        as of {market.asOfLabel}
                      </span>
                    )}
                  </div>
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
