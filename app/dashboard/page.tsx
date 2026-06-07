import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase'
import SiteHeader from '@/app/components/SiteHeader'
import { computeLfpEligibility } from '@/lib/lfp-eligibility'
import { resolveDefaultGrazingWindow } from '@/lib/grazing-window'
import Link from 'next/link'
import CountySelector from './components/CountySelector'
import DroughtCattleToggle from '@/app/components/DroughtCattleToggle'
import ShareButton from '@/app/components/ShareButton'
import LfpEstimateNote from '@/app/components/LfpEstimateNote'
import { droughtSeverity } from '@/lib/drought-severity'
import WatchlistButton from './components/WatchlistButton'
import RegionalMapLoader from './components/RegionalMapLoader'
import DroughtTrendChart from './components/DroughtTrendChart'
import { PrecipVsNormalPanel } from './components/PrecipForecastSection'
import ProgramStatus from './components/ProgramStatus'
import LfpHero from './components/LfpHero'
import TriggeredBanner from './components/TriggeredBanner'
import type { County } from './components/CountySelector'
import OfficialMap, { type OfficialMapRecord } from './components/OfficialMap'
import type { LfpEligibilityResult } from '@/lib/lfp-eligibility'
import { getPrecipNormal, type PrecipNormalResult } from '@/lib/precip-normal'
import { timeoutSignal } from '@/lib/external-fetch'
import DroughtHistoryChart, { type DroughtHistoryWeek } from './components/DroughtHistoryChart'
import { estimatePayment } from '@/lib/lfp-payment'
import { deliveredCost, type DeliveredCost } from '@/lib/freight'
import DashboardAccordion from './components/DashboardAccordion'
import ScrollToTop from './components/ScrollToTop'
import HomeCountyButton from './components/HomeCountyButton'
import MarketsNews from '@/app/components/MarketsNews'

export const dynamic = 'force-dynamic'

// Opening the dashboard to a logged-in user's Home (or most-recent saved) county
// when the URL has no ?fips is handled in middleware.ts — the middleware holds the
// authoritative, refreshed session, so it can redirect the document request
// reliably (a Server Component can't refresh the rotating auth cookie, so a
// redirect() here would miss the document render). Brand-new users with neither
// fall through to the EmptyState below.

// ─── USDM region lookup ───────────────────────────────────────────────────────

function getUsdmRegion(state: string): string {
  const lookup: Record<string, string> = {
    PR: 'caribbean', VI: 'caribbean',
    HI: 'pacific',
    AR: 'south', LA: 'south', TX: 'south', OK: 'south', MS: 'south',
    VA: 'southeast', WV: 'southeast', KY: 'southeast', TN: 'southeast',
    NC: 'southeast', SC: 'southeast', GA: 'southeast', AL: 'southeast', FL: 'southeast',
    ME: 'northeast', NH: 'northeast', VT: 'northeast', MA: 'northeast',
    RI: 'northeast', CT: 'northeast', NY: 'northeast', NJ: 'northeast',
    PA: 'northeast', DE: 'northeast', MD: 'northeast', DC: 'northeast',
    MO: 'midwest', IA: 'midwest', IL: 'midwest', IN: 'midwest',
    OH: 'midwest', MI: 'midwest', WI: 'midwest', MN: 'midwest',
    ND: 'high_plains', SD: 'high_plains', NE: 'high_plains', KS: 'high_plains',
    MT: 'west', WY: 'west', CO: 'west', UT: 'west', NV: 'west',
    CA: 'west', OR: 'west', WA: 'west', ID: 'west', AK: 'west',
    AZ: 'west', NM: 'west',
  }
  return lookup[state] ?? 'national'
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DroughtReading {
  week_date: string
  d0: number | null
  d1: number | null
  d2: number | null
  d3: number | null
  d4: number | null
}

interface CountyRow extends County {
  lat: number | null
  lon: number | null
}

// ─── Sub-components (server-safe) ─────────────────────────────────────────────

function DroughtBar({ reading }: { reading: DroughtReading }) {
  const d0 = reading.d0 ?? 0
  const d1 = reading.d1 ?? 0
  const d2 = reading.d2 ?? 0
  const d3 = reading.d3 ?? 0
  const d4 = reading.d4 ?? 0
  // USDM values are cumulative (d2 = "D2 or worse"), so subtract to get actual per-category
  const segments = [
    { pct: d0 - d1, bg: '#FFFF00' },
    { pct: d1 - d2, bg: '#FCD37F' },
    { pct: d2 - d3, bg: '#FFAA00' },
    { pct: d3 - d4, bg: '#E60000' },
    { pct: d4,      bg: '#730000' },
  ]
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-forest-green/10">
      {segments.map((s, i) =>
        s.pct > 0 ? (
          <div key={i} style={{ width: `${s.pct}%`, backgroundColor: s.bg }} className="h-full" />
        ) : null,
      )}
    </div>
  )
}


function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ─── Rainfall unit (streamed behind Suspense) ────────────────────────────────────
// The ACIS rainfall fetch can be slow on a cold cache, so it resolves INSIDE a Suspense
// boundary — the page shell, the news feed, and the Latest Reading card paint
// immediately while this streams in. RainfallPanelAsync awaits the precip promise
// server-side and hands the resolved value to the client PrecipVsNormalPanel, which
// renders every state honestly (data / no-station / 'data_unavailable' / null) — so a
// slow or failed ACIS shows skeleton → "temporarily unavailable", never a false zero.
async function RainfallPanelAsync({
  dataPromise,
  countyName,
}: {
  dataPromise: Promise<PrecipNormalResult>
  countyName: string
}) {
  const data = await dataPromise
  return <PrecipVsNormalPanel data={data} countyName={countyName} />
}

// Quiet on-brand placeholder while the panel streams (animate-pulse is disabled in
// this project's @theme, so it uses a scoped keyframe).
function RainfallPanelSkeleton() {
  return (
    <div className="rounded-xl border border-forest-green/10 bg-white p-4 shadow-sm sm:p-6" aria-hidden="true">
      <style>{`@keyframes dlRainShimmer{0%,100%{opacity:.55}50%{opacity:.85}}.dl-rain-skel{animation:dlRainShimmer 1.4s ease-in-out infinite}`}</style>
      <div className="dl-rain-skel h-40 w-full rounded-lg bg-forest-green/5" />
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="dl-rain-skel h-12 rounded bg-forest-green/5" />
        <div className="dl-rain-skel h-12 rounded bg-forest-green/5" />
        <div className="dl-rain-skel h-12 rounded bg-forest-green/5" />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ fips?: string }>
}): Promise<Metadata> {
  const { fips } = await searchParams
  if (!fips) return { title: 'County Dashboard' }

  const db = createServiceClient()
  const { data } = await db
    .from('counties')
    .select('name, state')
    .eq('fips', fips)
    .single()

  if (!data) return { title: 'County Dashboard' }

  const place = `${data.name}, ${data.state}`
  const title = `${place} — Drought & LFP Eligibility`
  const description = `Current drought conditions, LFP tier status, and estimated FSA payments for ${place}. Updated weekly from the U.S. Drought Monitor.`
  const ogImageUrl = `/dashboard/opengraph-image?fips=${fips}`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: `${place} drought and LFP status` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fips?: string; gs?: string; ge?: string; pt?: string; view?: string }>
}) {
  const { fips, gs, ge, pt, view: viewParam } = await searchParams
  // My Operation defaults to the Market News view; Drought is opt-in via &view=drought.
  const view: 'news' | 'drought' = viewParam === 'drought' ? 'drought' : 'news'
  const db = createServiceClient()

  // ── National view data (always fetched) ─────────────────────────────────────
  const { data: nationalMapRow } = await db
    .from('official_maps')
    .select('id, map_type, scope, release_date, image_url, source_url')
    .eq('map_type', 'usdm_national')
    .is('scope', null)
    .order('release_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nationalMap = nationalMapRow as OfficialMapRecord | null

  // ── County lookup ────────────────────────────────────────────────────────────
  let selectedCounty: CountyRow | null = null

  if (fips) {
    const { data: countyRow } = await db
      .from('counties')
      .select('id, fips, name, state, lat, lon')
      .eq('fips', fips)
      .single()

    selectedCounty = countyRow as CountyRow | null
  }

  // ── Ranch view data (only when a county is selected) ─────────────────────────
  let latest: DroughtReading | null                 = null
  let history: DroughtReading[]                     = []
  let threeYearHistory: DroughtHistoryWeek[]        = []
  let stateMap: OfficialMapRecord | null            = null
  let cpcMonthlyMap: OfficialMapRecord | null       = null
  let cpcSeasonalMap: OfficialMapRecord | null      = null
  let lfpResult: LfpEligibilityResult | null          = null
  let priorYearLfpResult: LfpEligibilityResult | null = null
  let lfpUnavailable = false   // true only when the live USDM eligibility call failed/timed out
  let regionalMapUrl: string | null                 = null
  let hayNearbyCount: number                        = 0
  let hayPrimaryVariety: string | null              = null
  let hayAvgPrice: number | null                    = null   // average DELIVERED $/ton, sell-only

  // Rainfall (ACIS) is held as a PROMISE and resolved behind a <Suspense> boundary in
  // the chrome (RainfallPanelAsync below) so it NEVER blocks the page's server render —
  // the feed and Latest Reading paint immediately; the rainfall panel streams in. The
  // call still starts here (concurrent with the cheap `latest` query). A rejection
  // degrades to the honest 'data_unavailable' state — never a crash, never a false
  // deficit. getPrecipNormal owns its own 9s deadline / 24h cache / honest-failure.
  const precipPromise: Promise<PrecipNormalResult> = selectedCounty
    ? getPrecipNormal(selectedCounty.fips, selectedCounty.lat, selectedCounty.lon)
        .catch(() => 'data_unavailable' as const)
    : Promise.resolve(null)

  // Cheap latest reading — always awaited (drives the shared Share label + heading and
  // the Latest Reading chrome card), independent of which view is open.
  if (selectedCounty) {
    const { data: latestRow } = await db
      .from('drought_data')
      .select('week_date, d0, d1, d2, d3, d4')
      .eq('county_id', selectedCounty.id)
      .order('week_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    latest = latestRow as DroughtReading | null
  }

  // Heavy ranch-view data only when the Drought view is open — keeps News fast and
  // off the external USDM/ACIS calls.
  if (selectedCounty && view === 'drought') {
    const state = selectedCounty.state

    // Run all ranch-view queries in parallel
    const [
      historyRes,
      stateMapRes,
      cpcMonthlyMapRes,
      cpcSeasonalMapRes,
      lfpRes,
      priorYearLfpRes,
      threeYearRaw,
      hayListingsRes,
    ] = await Promise.all([
      // 52 weeks of drought data for this county
      db
        .from('drought_data')
        .select('week_date, d0, d1, d2, d3, d4')
        .eq('county_id', selectedCounty.id)
        .order('week_date', { ascending: false })
        .limit(52),

      // State-level USDM map
      db
        .from('official_maps')
        .select('id, map_type, scope, release_date, image_url, source_url')
        .eq('map_type', 'usdm_state')
        .eq('scope', state)
        .order('release_date', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // CPC monthly outlook map
      db
        .from('official_maps')
        .select('id, map_type, scope, release_date, image_url, source_url')
        .eq('map_type', 'cpc_monthly')
        .order('release_date', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // CPC seasonal outlook map
      db
        .from('official_maps')
        .select('id, map_type, scope, release_date, image_url, source_url')
        .eq('map_type', 'cpc_seasonal')
        .order('release_date', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // LFP eligibility
      computeLfpEligibility(selectedCounty.fips, (() => {
        if (gs && ge) return { grazingPeriod: { startDate: gs, endDate: ge } }
        return { grazingPeriod: resolveDefaultGrazingWindow(selectedCounty.fips, pt) }
      })())
        // Isolate: a USDM outage/timeout must NOT reject this Promise.all and 500
        // the whole dashboard. Resolve to a tagged outcome instead.
        .then(result => ({ ok: true as const, result }))
        .catch(() => ({ ok: false as const })),

      // Prior year LFP eligibility — same forage period but year - 1
      computeLfpEligibility(
        selectedCounty.fips,
        { grazingPeriod: resolveDefaultGrazingWindow(selectedCounty.fips, pt, new Date().getFullYear() - 1) },
      )
        // Prior-year comparison is non-critical context; absence is already handled.
        .catch(() => null),

      // 3-year weekly drought history from USDM API (statisticsType=2 = actual per-category %)
      (() => {
        const today        = new Date().toISOString().slice(0, 10)
        const threeYearsAgo = new Date(Date.now() - 3 * 365.25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        return fetch(
          `https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent` +
          `?aoi=${selectedCounty.fips}&startdate=${threeYearsAgo}&enddate=${today}&statisticsType=2`,
          { headers: { Accept: 'application/json' }, next: { revalidate: 86400 }, signal: timeoutSignal() },
        )
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      })(),

      // Active hay listings — fetched for the nearby + cash-to-hay cards
      db
        .from('hay_listings')
        .select('id, listing_type, hay_type, price_per_ton, counties(lat, lon, state)')
        .eq('active', true)
        .gt('expires_at', new Date().toISOString()),
    ])

    history            = historyRes.data ?? []
    threeYearHistory   = (Array.isArray(threeYearRaw) ? threeYearRaw : []).map(
      (row: { mapDate: string; none: number; d0: number; d1: number; d2: number; d3: number; d4: number }) => ({
        // mapDate is an ISO datetime string: "2026-05-19T00:00:00"
        date: row.mapDate.slice(0, 10),
        none: row.none,
        d0:   row.d0,
        d1:   row.d1,
        d2:   row.d2,
        d3:   row.d3,
        d4:   row.d4,
      }),
    ).reverse()
    stateMap           = stateMapRes.data as OfficialMapRecord | null
    cpcMonthlyMap      = cpcMonthlyMapRes.data as OfficialMapRecord | null
    cpcSeasonalMap     = cpcSeasonalMapRes.data as OfficialMapRecord | null
    lfpResult          = lfpRes.ok ? lfpRes.result : null
    lfpUnavailable     = !lfpRes.ok
    priorYearLfpResult = priorYearLfpRes

    if (selectedCounty.lat != null && selectedCounty.lon != null) {
      const buyer = { lat: selectedCounty.lat, lon: selectedCounty.lon }

      // One consistent set: ACTIVE SELL listings, priced, with seller coords,
      // within 200 ROAD miles (haversine × circuity factor). deliveredCost enforces sell +
      // price + coords and returns the road-mile distance we gate and average on.
      const nearbySell = (hayListingsRes.data ?? [])
        .map(l => {
          const row = l as unknown as {
            hay_type: string | null
            listing_type: string
            price_per_ton: number | null
            counties: { lat: number | null; lon: number | null } | null
          }
          return { hayType: row.hay_type, dc: deliveredCost(buyer, row) }
        })
        .filter((x): x is { hayType: string | null; dc: DeliveredCost } =>
          x.dc !== null && x.dc.miles <= 200,
        )

      hayNearbyCount = nearbySell.length

      if (nearbySell.length > 0) {
        // Most common hay variety among the nearby sell listings
        const varietyCounts: Record<string, number> = {}
        for (const { hayType } of nearbySell) {
          if (hayType) varietyCounts[hayType] = (varietyCounts[hayType] ?? 0) + 1
        }
        hayPrimaryVariety = Object.entries(varietyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

        // Average DELIVERED price/ton (not raw price) — matches the delivered framing
        const sum = nearbySell.reduce((acc, { dc }) => acc + dc.delivered, 0)
        hayAvgPrice = Math.round(sum / nearbySell.length)
      }
    }

    if (nationalMap?.release_date) {
      const region = getUsdmRegion(selectedCounty.state)
      if (region !== 'national') {
        const releaseDate = new Date(nationalMap.release_date + 'T00:00:00Z')
        const mapDate = new Date(releaseDate.getTime() - 2 * 24 * 60 * 60 * 1000)
        const compact = mapDate.toISOString().slice(0, 10).replace(/-/g, '')
        regionalMapUrl = `https://droughtmonitor.unl.edu/data/png/${compact}/${compact}_${region}_text.png`
      }
    }
  }

  // Public, neighborly drought descriptor for the Share affordance (no money/PII).
  const shareDrought = droughtSeverity(latest)

  // Default estimate for the triggered banner (100 head beef_adult)
  const bannerDefaultEstimate = (lfpResult && lfpResult.maxTier >= 1 && lfpResult.payments > 0)
    ? estimatePayment('beef_adult', 100, lfpResult.payments).cappedEstimate
    : 0

  // D2+ drought flag for hay card context
  const latestInDrought = (latest?.d2 ?? 0) > 0

  // Cash-to-hay: how many tons the estimated LFP check buys at the average
  // delivered price nearby. Honest only when both the estimate and a real
  // delivered average exist; otherwise null → soft browse fallback.
  const cashToHayTons = (bannerDefaultEstimate > 0 && hayAvgPrice != null && hayAvgPrice > 0)
    ? Math.round(bannerDefaultEstimate / hayAvgPrice)
    : null

  return (
    <div className="min-h-screen bg-cream">

      <SiteHeader
        center={selectedCounty ? `${selectedCounty.name}, ${selectedCounty.state}` : undefined}
      />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <ScrollToTop />

        {/* ── County selector ───────────────────────────────────────────────── */}
        <section className="mb-8">
          <label className="mb-2 block text-sm font-medium text-forest-green font-dm-sans">
            Select County
          </label>
          <CountySelector selectedCounty={selectedCounty} />
        </section>

        {/* ── National view (no county selected) ───────────────────────────── */}
        {!fips && <EmptyState />}

        {fips && !selectedCounty && (
          <p className="text-sm text-forest-green/60 font-dm-sans">
            County not found for FIPS {fips}.
          </p>
        )}

        {/* ── Ranch view (county selected) ───────────────────────── */}
        {selectedCounty && (
          <div className="max-w-2xl mx-auto px-4 pb-16 space-y-4">

            {/* County heading + actions — shared across both views, above the toggle */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-2">
              <div>
                <h1 className="font-fraunces text-2xl font-semibold text-forest-green">
                  {selectedCounty.name}, {selectedCounty.state}
                </h1>
                <p className="text-sm text-forest-green/50 font-dm-sans mt-0.5">
                  FIPS {selectedCounty.fips}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ShareButton
                  fips={selectedCounty.fips}
                  countyLabel={`${selectedCounty.name}, ${selectedCounty.state}`}
                  droughtLabel={shareDrought.level != null ? shareDrought.label : null}
                  surface="dashboard"
                />
                <HomeCountyButton
                  countyFips={selectedCounty.fips}
                  countyName={selectedCounty.name}
                />
                <WatchlistButton
                  countyId={selectedCounty.id}
                  countyName={selectedCounty.name}
                />
              </div>
            </div>

            {/* Peer-view toggle — Market News ↔ Drought (same county) */}
            <DroughtCattleToggle fips={selectedCounty.fips} active={view} />

            {view === 'news' && (
              <MarketsNews fips={selectedCounty.fips} />
            )}

            {view === 'drought' && (
              <>

            {/* Latest Reading — drought chrome, Weather view only (above the map). */}
            {latest && (
              <div className="rounded-xl border border-forest-green/10 bg-white p-4 shadow-[0_2px_12px_rgba(27,67,50,0.08)] sm:p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-fraunces text-base font-semibold text-forest-green sm:text-lg">
                    Latest Reading
                  </h2>
                  <span className="rounded-full bg-forest-green/10 px-3 py-1 text-xs font-medium text-forest-green font-dm-sans">
                    Week of {formatDate(latest.week_date)}
                  </span>
                </div>

                <DroughtBar reading={latest} />

                {/* Compact legend — actual per-category, only categories > 0.5% */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs font-dm-sans text-forest-green/70">
                  {(() => {
                    const d0 = latest.d0 ?? 0
                    const d1 = latest.d1 ?? 0
                    const d2 = latest.d2 ?? 0
                    const d3 = latest.d3 ?? 0
                    const d4 = latest.d4 ?? 0
                    const items = [
                      { pct: d0 - d1, label: 'D0 Abnormally Dry', dot: '#FFFF00' },
                      { pct: d1 - d2, label: 'D1 Moderate',       dot: '#FCD37F' },
                      { pct: d2 - d3, label: 'D2 Severe',         dot: '#FFAA00' },
                      { pct: d3 - d4, label: 'D3 Extreme',        dot: '#E60000' },
                      { pct: d4,      label: 'D4 Exceptional',    dot: '#730000' },
                    ].filter(c => c.pct > 0.5)
                    if (items.length === 0) {
                      return <span className="text-forest-green/40">No drought this week.</span>
                    }
                    return items.map((c, i) => (
                      <span key={i} className="inline-flex items-center gap-1">
                        {i > 0 && <span className="mr-0.5 text-forest-green/30">·</span>}
                        <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: c.dot }} />
                        {c.label} {c.pct.toFixed(1)}%
                      </span>
                    ))
                  })()}
                </div>

                <p className="mt-3 text-xs text-forest-green/40 font-dm-sans">
                  Source:{' '}
                  <a href="https://droughtmonitor.unl.edu" target="_blank" rel="noopener noreferrer" className="underline">
                    U.S. Drought Monitor
                  </a>
                </p>
              </div>
            )}

            {/* Rainfall vs normal — Weather view only. Streamed behind a Suspense
                boundary so the slow ACIS call never blocks the Weather view paint. */}
            <div>
              <p className="text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide mb-3">Rainfall vs normal</p>
              <Suspense fallback={<RainfallPanelSkeleton />}>
                <RainfallPanelAsync dataPromise={precipPromise} countyName={selectedCounty.name} />
              </Suspense>
            </div>

            {/* Weather verdict band — fills in Slice 4 (renders nothing yet) */}

            {/* Regional conditions map — the lead canvas of the Weather view. Client-only
                (ssr:false) with its own "Loading map…" skeleton, so it never blocks the
                view's server paint; same drought-view props, already computed above. */}
            <RegionalMapLoader
              fips={selectedCounty.fips}
              center={selectedCounty.lat != null && selectedCounty.lon != null ? [selectedCounty.lat, selectedCounty.lon] : null}
              countyLabel={`${selectedCounty.name}, ${selectedCounty.state}`}
              runtime={{
                usdm: {
                  fallbackImage: {
                    url: regionalMapUrl ?? stateMap?.image_url ?? nationalMap?.image_url ?? null,
                    sourceUrl: 'https://droughtmonitor.unl.edu/CurrentMap.aspx',
                  },
                },
                // County-dynamic NWS alerts endpoint (client-fetched like the other layers).
                alerts: { endpoint: `/api/layers/alerts?area=${selectedCounty.state}` },
              }}
            />

            {/* LAYER 1 — The answer */}
            {lfpResult && lfpResult.maxTier >= 1 && (
              <TriggeredBanner
                countyName={selectedCounty.name}
                maxTier={lfpResult.maxTier}
                payments={lfpResult.payments}
                defaultEstimate={bannerDefaultEstimate}
                grazingEndDate={lfpResult.grazingPeriod.endDate}
              />
            )}

            {/* ── LFP hero — permanent top, always open (slice 1, additive). The detailed
                   "Eligibility math" accordion (calculator, tier ladder, CCC-853) is untouched below. ── */}
            {lfpResult && !lfpUnavailable && (
              <LfpHero eligibility={lfpResult} countyName={selectedCounty.name} />
            )}

            {!history.length && (
              <div className="rounded-xl border border-forest-green/10 bg-white px-6 py-8 text-center">
                <p className="text-sm text-forest-green/60 font-dm-sans">
                  No drought data yet for this county.
                </p>
              </div>
            )}

            {history.length > 0 && (
              <>
                {/* LAYER 2 — The why (compact cards, always visible) */}
                <div className="space-y-3">

                  {/* Hay (consolidated) — supply nearby + cash-to-hay context + one CTA */}
                  <div className="rounded-xl border border-forest-green/10 bg-white px-5 py-4">
                    <p className="text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide mb-3">
                      Hay nearby
                    </p>

                    {hayNearbyCount > 0 ? (
                      <p className="font-fraunces text-base font-semibold text-forest-green leading-snug sm:text-lg">
                        {hayNearbyCount} hay listing{hayNearbyCount !== 1 ? 's' : ''} within 200 miles
                        {hayPrimaryVariety && ` · ${hayPrimaryVariety.toLowerCase()}`}
                        {hayAvgPrice && ` · avg $${hayAvgPrice}/ton`}
                      </p>
                    ) : (
                      <p className="font-fraunces text-base font-semibold text-forest-green/50 leading-snug sm:text-lg">
                        No hay listed within 200 miles yet.
                      </p>
                    )}

                    {lfpResult && lfpResult.maxTier >= 1 && bannerDefaultEstimate > 0 && (
                      <p className="mt-2 font-dm-sans text-sm text-forest-green/60">
                        {cashToHayTons != null && hayAvgPrice != null
                          ? `Your estimated LFP payment (~$${Math.round(bannerDefaultEstimate).toLocaleString()}) could buy roughly ${cashToHayTons.toLocaleString()} ton${cashToHayTons !== 1 ? 's' : ''} of hay delivered to ${selectedCounty.name} County.`
                          : `Your estimated LFP payment is ~$${Math.round(bannerDefaultEstimate).toLocaleString()}.`}
                      </p>
                    )}

                    <Link
                      href={`/hay?deliverTo=${selectedCounty.fips}&type=sell`}
                      className="mt-3 block w-full rounded-lg bg-forest-green px-4 py-2.5 font-dm-sans text-sm font-semibold text-white text-center hover:bg-forest-green/90 transition-colors"
                    >
                      Browse hay delivered to {selectedCounty.name} →
                    </Link>

                    {hayNearbyCount === 0 && (
                      <p className="mt-3 text-center font-dm-sans text-xs text-forest-green/40">
                        <Link href="/hay" className="underline hover:text-forest-green">Post hay for sale</Link> to reach ranchers in drought-affected counties.
                      </p>
                    )}

                    {lfpResult && lfpResult.maxTier >= 1 && bannerDefaultEstimate > 0 && (
                      <div className="mt-3">
                        <LfpEstimateNote />
                      </div>
                    )}
                  </div>

                </div>

                {/* LAYER 3 — Deep dive accordions */}
                <div className="space-y-2 pt-2">

                  <DashboardAccordion
                    title="Eligibility math"
                    preview={
                      lfpUnavailable
                        ? 'Estimate temporarily unavailable'
                        : lfpResult && lfpResult.maxTier >= 1
                          ? `Tier ${lfpResult.maxTier} — ${lfpResult.payments} payment${lfpResult.payments !== 1 ? 's' : ''}`
                          : 'Not currently triggered'
                    }
                    previewAmount={!lfpUnavailable && lfpResult && lfpResult.maxTier >= 1 && bannerDefaultEstimate > 0 ? `~$${Math.round(bannerDefaultEstimate).toLocaleString()}` : undefined}
                    highlight={!!(lfpResult && lfpResult.maxTier >= 1)}
                    defaultOpen={lfpUnavailable}
                  >
                    {lfpUnavailable ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                        <p className="font-dm-sans text-sm font-semibold text-amber-800">
                          LFP estimate temporarily unavailable
                        </p>
                        <p className="mt-1 font-dm-sans text-sm leading-relaxed text-amber-700">
                          The U.S. Drought Monitor eligibility service isn&apos;t responding right now, so we
                          can&apos;t compute your LFP tier or payment estimate.
                          {latest ? ` Drought conditions above are current as of the week of ${formatDate(latest.week_date)}.` : ''}{' '}
                          Check back shortly — this usually clears on its own.
                        </p>
                      </div>
                    ) : lfpResult ? (
                      <ProgramStatus
                        eligibility={lfpResult}
                        priorYearEligibility={priorYearLfpResult}
                        fips={selectedCounty.fips}
                        countyName={selectedCounty.name}
                      />
                    ) : null}
                  </DashboardAccordion>

                  <DashboardAccordion
                    title="Drought history"
                    preview="3-year and 52-week trend charts"
                  >
                    <div className="space-y-6">
                      <DroughtHistoryChart data={threeYearHistory} countyName={selectedCounty.name} />
                      <DroughtTrendChart history={history} countyName={selectedCounty.name} />
                    </div>
                  </DashboardAccordion>

                  {/* Forecast — the CPC drought outlooks (national reference images), moved
                      out of the map toggle. OfficialMap renders the image + lightbox, and on a
                      null record shows its own honest "official map updating" note (no broken
                      image), so a missing/failed outlook degrades gracefully. */}
                  <DashboardAccordion
                    title="Forecast"
                    preview="30-day & 3-month CPC outlook"
                  >
                    <div className="space-y-6">
                      <OfficialMap map={cpcMonthlyMap} title="Monthly Drought Outlook" />
                      <OfficialMap map={cpcSeasonalMap} title="Seasonal Drought Outlook" />
                    </div>
                  </DashboardAccordion>

                </div>

                {/* Legal links (no site footer this pass) */}
                <p className="text-xs text-forest-green/40 font-dm-sans text-center pt-2">
                  <Link href="/terms" className="underline hover:text-forest-green/70">Terms</Link>
                  {' · '}
                  <Link href="/privacy" className="underline hover:text-forest-green/70">Privacy Policy</Link>
                </p>
              </>
            )}

              </>
            )}

          </div>
        )}
      </main>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-forest-green/8 mx-auto">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-forest-green/60">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
      </div>
      <h2 className="font-fraunces text-xl font-semibold text-forest-green sm:text-2xl">
        Select a county to begin
      </h2>
      <p className="mt-2 max-w-xs text-sm text-forest-green/60 font-dm-sans">
        Search above to view drought conditions and weekly history for any US county.
      </p>
    </div>
  )
}
