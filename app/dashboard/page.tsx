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
import LatestReadingCard, { type DroughtHistoryWeek } from './components/LatestReadingCard'
import { PrecipVsNormalPanel } from './components/PrecipForecastSection'
import ProgramStatus from './components/ProgramStatus'
import LfpHero from './components/LfpHero'
import type { County } from './components/CountySelector'
import { type OfficialMapRecord } from './components/OfficialMap'
import type { LfpEligibilityResult } from '@/lib/lfp-eligibility'
import { getPrecipNormal, type PrecipNormalResult } from '@/lib/precip-normal'
import { getLocalForecast, type LocalForecast } from '@/lib/nws'
import ForecastPanel from './components/ForecastPanel'
import { timeoutSignal } from '@/lib/external-fetch'
import { estimatePayment } from '@/lib/lfp-payment'
import { deliveredCost, roadMiles, type DeliveredCost } from '@/lib/freight'
import HayNearbyCards, { type NearbyHayCard } from './components/HayNearbyCards'
import HayMapLoader from './components/HayMapLoader'
import type { MapListing } from '@/app/hay/map/HayMapClient'
import DashboardAccordion from './components/DashboardAccordion'
import { getOperationProfile } from '@/lib/operation-profile-service'
import { getUpcomingDeadlines, type UpcomingDeadlinesResult } from '@/lib/rma-deadline-service'
import DeadlineCountdownCard from './components/DeadlineCountdownCard'
import LfpAlertCard, { LfpAlertSkeleton } from './components/LfpAlertCard'
import { getLatestLrp, type LrpResult } from '@/lib/lrp-service'
import LrpMarketsCard from './components/LrpMarketsCard'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import ScrollToTop from './components/ScrollToTop'
import HomeCountyButton from './components/HomeCountyButton'
import MarketsNews from '@/app/components/MarketsNews'
import { createClient } from '@/lib/supabase-server'
import { getHomeCountyFips } from '@/lib/concierge-service'
import { getHerdAnchor, type HerdAnchor } from '@/lib/herd-anchor'
import HerdAnchorLoader from './components/HerdAnchorLoader'
import MarketReadShell from './components/MarketReadShell'
import { getLatestCornSettle, type CornResult } from '@/lib/corn-service'
import { getFeedingRegionMoisture, type MoistureResult } from '@/lib/moisture-service'
import { getLatestCropCondition, type CropResult } from '@/lib/crop-service'
import { getCattleCycle, type CycleResult } from '@/lib/cattle-cycle-service'
import type { Lot } from '@/lib/herd'

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

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Coerce the operation-profile `crops` jsonb into a clean string[] for deadline
// filtering. Only a plain array of strings is trusted; any other shape (object array,
// null, etc.) → null, which the deadline service reads as "show all". Never throws on
// an unexpected jsonb shape.
function cropsToStringArray(crops: unknown): string[] | null {
  if (!Array.isArray(crops)) return null
  const strings = crops.filter((c): c is string => typeof c === 'string')
  return strings.length > 0 ? strings : null
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
    <Card className="p-4 sm:p-6" aria-hidden="true">
      <style>{`@keyframes dlRainShimmer{0%,100%{opacity:.55}50%{opacity:.85}}.dl-rain-skel{animation:dlRainShimmer 1.4s ease-in-out infinite}`}</style>
      <div className="dl-rain-skel h-40 w-full rounded-lg bg-forest-green/5" />
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="dl-rain-skel h-12 rounded bg-forest-green/5" />
        <div className="dl-rain-skel h-12 rounded bg-forest-green/5" />
        <div className="dl-rain-skel h-12 rounded bg-forest-green/5" />
      </div>
    </Card>
  )
}

// 7-day NWS point forecast — awaited INSIDE a Suspense boundary so the 2-step NWS call
// (points → forecast) never blocks the weather-view paint, exactly like the rainfall
// panel. getLocalForecast owns its own timeout + cache + honest-null; a null degrades to
// ForecastPanel's "temporarily unavailable", never a stale or blank-as-loaded card.
async function ForecastPanelAsync({ dataPromise }: { dataPromise: Promise<LocalForecast | null> }) {
  const data = await dataPromise
  return <ForecastPanel data={data} />
}

function ForecastPanelSkeleton() {
  return (
    <Card className="p-4 sm:p-5" aria-hidden="true">
      <style>{`@keyframes dlFcShimmer{0%,100%{opacity:.55}50%{opacity:.85}}.dl-fc-skel{animation:dlFcShimmer 1.4s ease-in-out infinite}`}</style>
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="dl-fc-skel h-[92px] w-[64px] shrink-0 rounded-xl bg-forest-green/5" />
        ))}
      </div>
    </Card>
  )
}

// LFP status alert — the slow external USDM consecutive-weeks eligibility fetch is held
// as a PROMISE and awaited INSIDE a Suspense boundary so it NEVER blocks the page/news
// paint (same pattern as the rainfall + forecast panels). The promise resolves to a
// tagged outcome: a USDM outage/timeout → { ok: false } → the alert's honest
// "unavailable" state, never a false zero. The SAME promise feeds the Drought view's
// hero/banner/accordion (computed once, used in both).
// result is nullable: computeLfpEligibility returns null if the county FIPS doesn't
// resolve (near-unreachable here — selectedCounty is already resolved). A null result
// or { ok: false } both degrade the alert to its honest "unavailable" state.
type LfpFetchOutcome = { ok: true; result: LfpEligibilityResult | null } | { ok: false }

async function LfpAlertAsync({
  dataPromise,
  countyName,
}: {
  dataPromise: Promise<LfpFetchOutcome>
  countyName: string
}) {
  const res = await dataPromise
  return (
    <LfpAlertCard
      eligibility={res.ok ? res.result : null}
      unavailable={!res.ok}
      countyName={countyName}
    />
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
  // My Operation defaults to the Market News view; Drought is opt-in via &view=drought,
  // Hay via &view=hay, Markets via &view=markets.
  const view: 'news' | 'drought' | 'hay' | 'markets' =
    viewParam === 'drought' ? 'drought'
      : viewParam === 'hay' ? 'hay'
        : viewParam === 'markets' ? 'markets'
          : 'news'
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
  let lfpResult: LfpEligibilityResult | null          = null
  let priorYearLfpResult: LfpEligibilityResult | null = null
  let lfpUnavailable = false   // true only when the live USDM eligibility call failed/timed out
  let regionalMapUrl: string | null                 = null
  let hayNearbyCount: number                        = 0
  let hayNearbyCards: NearbyHayCard[]               = []   // nearest-4 sell listings — Hay view only
  let hayMapPins: MapListing[]                      = []   // same nearest-4, shaped for the hay map pins
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

  // 7-day NWS forecast — same streamed-behind-Suspense pattern. Started here (concurrent
  // with the cheap reads); resolved in ForecastPanelAsync. A rejection degrades to null →
  // honest "temporarily unavailable". Needs the county centroid for the gridpoint lookup.
  const forecastPromise: Promise<LocalForecast | null> =
    selectedCounty && selectedCounty.lat != null && selectedCounty.lon != null
      ? getLocalForecast(selectedCounty.lat, selectedCounty.lon).catch(() => null)
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

  // Insurance deadline countdown — shown for EVERY selected county in EVERY view (it
  // serves all producers, farmers included, so it is not gated behind the view toggle).
  // Crops come from the signed-in user's operation profile when present; a missing
  // profile or a crops jsonb that isn't a clean string array → null → show all county/
  // state deadlines. Fast local queries, so a direct await (no Suspense) is fine.
  let deadlineResult: UpcomingDeadlinesResult = { status: 'none' }
  // Operation zone (Block 2, Slice 1) — the herd-value anchor for a signed-in user with a
  // herd. Additive: gated on the SAME getOperationProfile() result the deadline read already
  // uses (NO new getUser/auth call). userId comes from the profile row; homeFips via the
  // existing service-role home-county helper; the user-scoped SSR client is created only so
  // the herd_estimate_history read inside getHerdAnchor stays RLS-scoped to the owner. Anon /
  // no-herd / no-home-county all leave herdAnchor null → nothing renders, and any failure
  // degrades to null so the public county view below never blocks.
  let herdAnchor: HerdAnchor | null = null
  if (selectedCounty) {
    const profileResult = await getOperationProfile()
    const crops = profileResult.status === 'ok' ? cropsToStringArray(profileResult.profile.crops) : null
    deadlineResult = await getUpcomingDeadlines(selectedCounty.fips, crops)

    if (profileResult.status === 'ok') {
      const herd = profileResult.profile.herd as { lots?: Lot[] } | null
      const lots = Array.isArray(herd?.lots) ? herd!.lots : []
      if (lots.length > 0) {
        try {
          const homeFips = await getHomeCountyFips(profileResult.profile.user_id)
          if (homeFips) {
            const supabase = await createClient()
            herdAnchor = await getHerdAnchor({ lots, homeFips, supabase })
          }
        } catch {
          herdAnchor = null
        }
      }
    }
  }

  // Corn settle for the Market Read Price chip (§4 Leg 3) — fetched ONLY when the Market Read
  // will actually render (signed-in user with a herd), so the anon / no-herd ?fips= path adds
  // no query. getLatestCornSettle is a fast service-role SELECT and never throws — none /
  // data_unavailable keep the chip's honest "warming up" / "temporarily unavailable" state.
  let corn: CornResult = { status: 'none' }
  let moisture: MoistureResult = { status: 'none' }
  let crop: CropResult = { status: 'none' }
  let cycle: CycleResult = { status: 'none' }
  if (herdAnchor) {
    const [cornRes, moistureRes, cropRes, cycleRes] = await Promise.all([
      getLatestCornSettle(),
      getFeedingRegionMoisture(),
      getLatestCropCondition(),
      getCattleCycle(),
    ])
    corn = cornRes
    moisture = moistureRes
    crop = cropRes
    cycle = cycleRes
  }

  // LRP coverage-price floor — gated to the Markets view so news/drought/hay never pay
  // for it. getLatestLrp is a fast Supabase SELECT (the RMA fetch is the offline seed,
  // not a request-path call), so a direct await is fine — no Suspense needed. 'MT' is the
  // seeded national-index snapshot; the card frames it as the CME national floor, never a
  // state-specific claim. A miss degrades to 'none'/'data_unavailable', never a fake price.
  let lrpResult: LrpResult = { status: 'none' }
  if (selectedCounty && view === 'markets') {
    lrpResult = await getLatestLrp('MT')
  }

  // LFP eligibility — HOISTED to the always-run path (was Drought-only) so the LFP alert
  // can show in EVERY view. Held as a PROMISE, not awaited here: it streams behind a
  // <Suspense> boundary (LfpAlertAsync) so the slow USDM consecutive-weeks fetch never
  // blocks the news/page paint. Resolves to a tagged outcome so an outage/timeout
  // degrades honestly. The Drought view's Promise.all below consumes this SAME promise,
  // so eligibility is computed ONCE and shared by the alert and the hero.
  const lfpPromise: Promise<LfpFetchOutcome> = selectedCounty
    ? computeLfpEligibility(selectedCounty.fips, (() => {
        if (gs && ge) return { grazingPeriod: { startDate: gs, endDate: ge } }
        return { grazingPeriod: resolveDefaultGrazingWindow(selectedCounty.fips, pt) }
      })())
        .then(result => ({ ok: true as const, result }))
        .catch(() => ({ ok: false as const }))
    : Promise.resolve({ ok: false as const })

  // Heavy ranch-view data only when the Drought view is open — keeps News fast and
  // off the external USDM/ACIS calls.
  if (selectedCounty && view === 'drought') {
    const state = selectedCounty.state

    // Run all ranch-view queries in parallel
    const [
      historyRes,
      stateMapRes,
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

      // LFP eligibility — reuse the hoisted always-run promise (computed ONCE, shared
      // with the LFP alert). Same tagged { ok, result } outcome the destructure expects.
      lfpPromise,

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

  // ── Hay view data — nearest-4 sell listings (Hay view ONLY) ──────────────────
  // Runs only on view === 'hay' so news/drought never pay for it. Sell-only (matches
  // the "Hay nearby" card's listing-type filter), active, non-expired, with seller
  // county coords (coordless listings are dropped — never ranked, never shown).
  // Ranked by road miles from the home county centroid (selectedCounty), nearest 4.
  if (selectedCounty && view === 'hay' && selectedCounty.lat != null && selectedCounty.lon != null) {
    const buyer = { lat: selectedCounty.lat, lon: selectedCounty.lon }

    const { data: hayRows } = await db
      .from('hay_listings')
      .select(
        'id, listing_type, hay_type, cutting_number, bale_type, storage_method, ' +
        'tonnage, price_per_ton, haul_radius_miles, relief_flag, description, photo_urls, ' +
        'hay_test_protein_pct, hay_test_tdn_pct, hay_test_rfv, hay_test_moisture_pct, ' +
        'counties(id, name, state, lat, lon)',
      )
      .eq('active', true)
      .eq('listing_type', 'sell')
      .gt('expires_at', new Date().toISOString())

    type HayRow = {
      id: string
      listing_type: string
      hay_type: string | null
      cutting_number: number | null
      bale_type: string | null
      storage_method: string | null
      tonnage: number | null
      price_per_ton: number | null
      haul_radius_miles: number | null
      relief_flag: boolean | null
      description: string | null
      photo_urls: string[] | null
      hay_test_protein_pct: number | null
      hay_test_tdn_pct: number | null
      hay_test_rfv: number | null
      hay_test_moisture_pct: number | null
      counties: { id: number; name: string; state: string; lat: number | null; lon: number | null } | { id: number; name: string; state: string; lat: number | null; lon: number | null }[] | null
    }

    const ranked = ((hayRows ?? []) as unknown as HayRow[])
      .flatMap(row => {
        const c = Array.isArray(row.counties) ? row.counties[0] : row.counties
        if (!c || c.lat == null || c.lon == null) return []
        return [{ row, county: { id: c.id, name: c.name, state: c.state, lat: c.lat, lon: c.lon }, miles: Math.round(roadMiles(buyer.lat, buyer.lon, c.lat, c.lon)) }]
      })
      .sort((a, b) => a.miles - b.miles)
      .slice(0, 4)

    // Latest drought tier for the displayed counties — one cheap lookup, only the few
    // counties actually shown. Mirrors the tier derivation used on the marketplace map.
    const countyIds = [...new Set(ranked.map(r => r.county.id))]
    const tierByCounty = new Map<number, number | null>()
    if (countyIds.length > 0) {
      const { data: droughtRows } = await db
        .from('drought_data')
        .select('county_id, d0, d1, d2, d3, d4')
        .in('county_id', countyIds)
        .order('week_date', { ascending: false })
      for (const d of droughtRows ?? []) {
        if (tierByCounty.has(d.county_id)) continue
        tierByCounty.set(
          d.county_id,
          d.d4 > 0 ? 4 : d.d3 > 0 ? 3 : d.d2 > 0 ? 2 : d.d1 > 0 ? 1 : d.d0 > 0 ? 0 : null,
        )
      }
    }

    hayNearbyCards = ranked.map(({ row, county, miles }): NearbyHayCard => ({
      id:              row.id,
      hayType:         row.hay_type,
      cuttingNumber:   row.cutting_number,
      baleType:        row.bale_type,
      storageMethod:   row.storage_method,
      tonnage:         row.tonnage,
      pricePerTon:     row.price_per_ton,
      haulRadiusMiles: row.haul_radius_miles,
      reliefFlag:      row.relief_flag ?? false,
      hasTest:
        row.hay_test_protein_pct  != null ||
        row.hay_test_tdn_pct      != null ||
        row.hay_test_rfv          != null ||
        row.hay_test_moisture_pct != null,
      photoUrls:       row.photo_urls ?? [],
      description:     row.description,
      countyName:      county.name,
      state:           county.state,
      miles,
      droughtTier:     tierByCounty.get(county.id) ?? null,
      delivered:       deliveredCost(buyer, { listing_type: row.listing_type, price_per_ton: row.price_per_ton, counties: county }),
    }))

    // Same nearest-4, shaped for the map pins (reuses the marketplace map renderer).
    hayMapPins = ranked.map(({ row, county }): MapListing => ({
      id:           row.id,
      hay_type:     row.hay_type,
      listing_type: row.listing_type,
      price_per_ton: row.price_per_ton,
      tonnage:      row.tonnage,
      lat:          county.lat,
      lon:          county.lon,
      drought_tier: tierByCounty.get(county.id) ?? null,
      county_name:  county.name,
      state:        county.state,
    }))
  }

  // Public, neighborly drought descriptor for the Share affordance (no money/PII).
  const shareDrought = droughtSeverity(latest)

  // Default reference estimate (100 head beef_adult) — feeds the hay card's
  // cash-to-hay line and the eligibility-math accordion preview.
  const bannerDefaultEstimate = (lfpResult && lfpResult.maxTier >= 1 && lfpResult.payments > 0)
    ? estimatePayment('beef_adult', 100, lfpResult.payments).cappedEstimate
    : 0

  // FSA-enforcement gate for the DOLLAR-bearing surfaces. The estimate above stays the real
  // value; this only gates VISIBILITY. A 'pending_obbba' county (D2 qualifies under OBBBA but
  // FSA hasn't loaded the 2026 maps) shows the amber pending banner and NO dollar figure.
  const lfpOfficial = !!lfpResult && lfpResult.enforcement === 'officially_eligible'

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

            {/* Operation zone (Block 2) — the read leads, the value sits beneath it.
                Market Read (Slice 2a, shell only) renders ABOVE the herd anchor, gated on the
                SAME condition (signed-in user with a herd) so the two move together; anon /
                no-herd ?fips= sees neither and the public county view below is unchanged. */}
            {herdAnchor && <MarketReadShell corn={corn} moisture={moisture} crop={crop} cycle={cycle} />}

            {/* Herd-value anchor (Slice 1) — the number the read sits above. */}
            {herdAnchor && (
              <HerdAnchorLoader
                estimate={herdAnchor.estimate}
                trend={herdAnchor.trend}
                outlook={herdAnchor.outlook}
              />
            )}

            {/* County heading + actions — shared across both views, above the toggle */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-2">
              <div>
                <Heading level={2}>
                  {selectedCounty.name}, {selectedCounty.state}
                </Heading>
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

            {/* LFP status alert — always visible, ON TOP of the insurance card (higher
                priority). Streamed behind Suspense so the slow USDM eligibility fetch
                never blocks the page/news paint; a failure degrades to the honest
                "unavailable" state. Renders in all three views, persistent across the toggle. */}
            <Suspense fallback={<LfpAlertSkeleton />}>
              <LfpAlertAsync dataPromise={lfpPromise} countyName={selectedCounty.name} />
            </Suspense>

            {/* Insurance deadline countdown — always visible, above the view toggle.
                Serves all producers (farmers + ranchers), so it is never gated behind
                a view. Filters to the user's crops when set, else shows all. */}
            <DeadlineCountdownCard result={deadlineResult} countyName={selectedCounty.name} />

            {/* Peer-view toggle — Market News ↔ Drought (same county) */}
            <DroughtCattleToggle fips={selectedCounty.fips} active={view} />

            {view === 'news' && (
              <MarketsNews fips={selectedCounty.fips} />
            )}

            {/* Markets view — USDA RMA LRP coverage-price floor. Additive 4th view; the
                always-visible LFP + deadline band above the toggle is untouched. */}
            {view === 'markets' && (
              <LrpMarketsCard result={lrpResult} />
            )}

            {/* Hay view — placeholder only. Nearest-4 pins/cards + the hay map land in
                later commits. For now it just routes into the existing marketplace. */}
            {view === 'hay' && (
              <div className="space-y-4">
                <p className="text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide">
                  Hay for sale near you
                </p>

                {/* Map-prominent lead: the nearest-4 pinned on a hay map centered on the
                    home county. Pins tap → /hay/[id]. Renders whenever the home county has
                    a centroid (the drought overlay gives regional context even at 0 pins). */}
                {selectedCounty.lat != null && selectedCounty.lon != null && (
                  <HayMapLoader
                    listings={hayMapPins}
                    center={[selectedCounty.lat, selectedCounty.lon]}
                  />
                )}

                {/* Honest explainer of the hay-score choropleth — collapsed by default,
                    opens inline (reuses DashboardAccordion's toggle so it matches the rest
                    of the dashboard and can't trap the user). Copy is edited in one place
                    after the calibration drive; render-only, no score/backend tie-in. */}
                <DashboardAccordion title="How the Hay Score works">
                  <div className="space-y-4 font-dm-sans text-sm leading-relaxed text-forest-green/80">
                    <p>
                      Each county gets a 0–100 score for how its hay outlook is shaping up this
                      season. Greener is better, redder is worse. It&rsquo;s built from four things:
                    </p>
                    <ul className="space-y-2">
                      <li>
                        <span className="font-semibold text-ink">Rain so far</span> — this year&rsquo;s
                        moisture vs. normal for that county, updated weekly.
                      </li>
                      <li>
                        <span className="font-semibold text-ink">How the season started</span> — drought
                        and moisture on hand at green-up. A county that started dry stays capped, no
                        matter how spring went.
                      </li>
                      <li>
                        <span className="font-semibold text-ink">Spring frost</span> — whether a killing
                        freeze hit after a county greened up, when new growth was tender. Counties that
                        greened up early and got frosted score lower than ones still dormant when the
                        cold came.
                      </li>
                      <li>
                        <span className="font-semibold text-ink">Heat &amp; dry stress</span> — hot,
                        windy, dry stretches that pull moisture out of the crop, weighted toward the
                        stages when it hurts most.
                      </li>
                    </ul>
                    <p>
                      <span className="font-semibold text-ink">What it is and isn&rsquo;t.</span> This is
                      an early, free tool, and the exact numbers are still being calibrated against real
                      fields — including a drive across these counties this season. Treat the score as a
                      directional read on the region, not a verdict on any one field, and not a
                      substitute for walking your own ground. Conditions change fast as rain comes. If a
                      county looks wrong to you, that&rsquo;s worth knowing — tell us.
                    </p>
                    <p className="text-forest-green/50">
                      Data: PRISM precip, gridMET temperature/humidity/wind, USDM drought monitor.
                      Updated weekly, provisional for the current season.
                    </p>
                  </div>
                </DashboardAccordion>

                <HayNearbyCards listings={hayNearbyCards} deliverToFips={selectedCounty.fips} />

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/hay"
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-forest-green px-4 font-dm-sans text-sm font-medium text-cream transition-colors hover:bg-forest-green/90"
                  >
                    Browse all hay
                  </Link>
                  <Link
                    href="/hay"
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-forest-green/20 bg-white px-4 font-dm-sans text-sm font-medium text-forest-green transition-colors hover:bg-forest-green/5"
                  >
                    Post a listing
                  </Link>
                </div>
              </div>
            )}

            {view === 'drought' && (
              <>

            {/* Latest Reading — unified timeline-ribbon card (hero + 3-yr weekly ribbon +
                summary). Weather view only (above the map). Hero renders from the reliable
                DB `latest`; the ribbon + summary come from the live 3-year USDM history and
                degrade independently to "history unavailable" if it failed. */}
            {latest && (
              <LatestReadingCard latest={latest} history={threeYearHistory} />
            )}

            {/* Rainfall vs normal — Weather view only. Streamed behind a Suspense
                boundary so the slow ACIS call never blocks the Weather view paint. */}
            <div>
              <p className="text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide mb-3">Rainfall vs normal</p>
              <Suspense fallback={<RainfallPanelSkeleton />}>
                <RainfallPanelAsync dataPromise={precipPromise} countyName={selectedCounty.name} />
              </Suspense>
            </div>

            {/* 7-day forecast — the forward-looking weather cluster (with rainfall above).
                Compact swipe carousel; streamed behind Suspense like the rainfall panel. */}
            <div>
              <p className="text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide mb-3">7-day forecast</p>
              <Suspense fallback={<ForecastPanelSkeleton />}>
                <ForecastPanelAsync dataPromise={forecastPromise} />
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

            {/* ── LFP status — the single contextual LFP card (A1 merged the old
                   TriggeredBanner into LfpHero): hero line per enforcement state, tracker,
                   and the signup CTA / pending FSA-office guidance. The detailed
                   "Eligibility math" accordion (calculator, tier ladder, CCC-853) is
                   untouched below. ── */}
            {lfpResult && !lfpUnavailable && (
              <LfpHero eligibility={lfpResult} countyName={selectedCounty.name} />
            )}

            {!history.length && (
              <Card shadow="none" className="px-6 py-8 text-center">
                <p className="text-sm text-forest-green/60 font-dm-sans">
                  No drought data yet for this county.
                </p>
              </Card>
            )}

            {history.length > 0 && (
              <>
                {/* LAYER 2 — The why (compact cards, always visible) */}
                <div className="space-y-3">

                  {/* Hay (consolidated) — supply nearby + cash-to-hay context + one CTA */}
                  <Card shadow="none" className="px-5 py-4">
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

                    {lfpOfficial && bannerDefaultEstimate > 0 && (
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

                    {lfpOfficial && bannerDefaultEstimate > 0 && (
                      <div className="mt-3">
                        <LfpEstimateNote />
                      </div>
                    )}
                  </Card>

                </div>

                {/* LAYER 3 — Deep dive accordions. id = stable scroll target for the
                    hero's "View FSA checklist" link (the old #action-cards anchor only
                    exists while the accordion is open). */}
                <div id="eligibility-math" className="scroll-mt-24 space-y-2 pt-2">

                  <DashboardAccordion
                    title="Eligibility math"
                    preview={
                      lfpUnavailable
                        ? 'Estimate temporarily unavailable'
                        : lfpOfficial && lfpResult
                          ? `Tier ${lfpResult.maxTier} — ${lfpResult.payments} payment${lfpResult.payments !== 1 ? 's' : ''}`
                          : lfpResult?.enforcement === 'pending_obbba'
                            ? 'Meets new OBBBA threshold — pending FSA'
                            : 'Not currently triggered'
                    }
                    previewAmount={lfpOfficial && bannerDefaultEstimate > 0 ? `~$${Math.round(bannerDefaultEstimate).toLocaleString()}` : undefined}
                    highlight={lfpOfficial}
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

                  {/* The CPC monthly + seasonal drought outlooks now live on the map as the
                      "Drought Forecast" layer (live cpc_drought_outlk service), so the static
                      "Forecast" accordion that showed them as images was removed here. */}

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
      <Heading level={3}>
        Select a county to begin
      </Heading>
      <p className="mt-2 max-w-xs text-sm text-forest-green/60 font-dm-sans">
        Search above to view drought conditions and weekly history for any US county.
      </p>
    </div>
  )
}
