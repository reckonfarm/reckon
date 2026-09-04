import { Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'
import { createClient } from '@/lib/supabase-server'
import { computeLfpEligibility, type LfpEligibilityResult } from '@/lib/lfp-eligibility'
import { resolveDefaultGrazingWindow } from '@/lib/grazing-window'
import { getPrecipNormal, type PrecipNormalResult } from '@/lib/precip-normal'
import { getLocalForecast, type LocalForecast } from '@/lib/nws'
import { timeoutSignal } from '@/lib/external-fetch'
import { estimatePayment } from '@/lib/lfp-payment'
import { deliveredCost, roadMiles, type DeliveredCost } from '@/lib/freight'
import { getOperationProfile } from '@/lib/operation-profile-service'
import { getLatestLrp, type LrpResult } from '@/lib/lrp-service'
import { getLocalAuctionRead, type LocalAuctionResult } from '@/lib/local-auction-service'
import { getNationalBeef, type NationalBeefResult } from '@/lib/national-beef-service'
import { getLatestCornSettle, type CornResult } from '@/lib/corn-service'
import { getFeedingRegionMoisture, type MoistureResult } from '@/lib/moisture-service'
import { getLatestCropCondition, type CropResult } from '@/lib/crop-service'
import { getCattleCycle, type CycleResult } from '@/lib/cattle-cycle-service'
import { flagEnabled } from '@/lib/flags'
import type { Lot } from '@/lib/herd'
import type { MapListing } from '@/app/hay/map/HayMapClient'
import LfpEstimateNote from '@/app/components/LfpEstimateNote'
import { Card } from '@/app/components/ui/Card'
import CountySelector, { type County } from './CountySelector'
import { type OfficialMapRecord } from './OfficialMap'
import RegionalMapLoader from './RegionalMapLoader'
import type { OwnPlace, OwnDevice } from './RegionalMapClient'
import LatestReadingCard, { type DroughtHistoryWeek } from './LatestReadingCard'
import PrecipVsNormalPanel from './RainfallPanelLoader'
import RainByPlaceCard from './RainByPlaceCard'
import ForecastPanel from './ForecastPanel'
import HayNearbyCards, { type NearbyHayCard } from './HayNearbyCards'
import HayMapLoader from './HayMapLoader'
import DashboardAccordion from './DashboardAccordion'
import LrpMarketsCard from './LrpMarketsCard'
import LocalAuctionCard from './LocalAuctionCard'
import NationalBeefCard from './NationalBeefCard'
import MarketReadShell from './MarketReadShell'
import JobsView, { JobsViewSkeleton } from './JobsView'
import type { DashboardViewKey, ViewParams } from './DashboardViews'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

// ─── Dashboard view bodies — server components, one per peer view ─────────────
// Extracted from app/dashboard/page.tsx (perf block, commit 5) so the deferred
// loader (load-view.tsx, a server action) and the page can render the same
// bodies. The page renders Today always and the URL's active view eagerly;
// the other bodies are rendered here on first activation, with the same data
// gathering the page used to do for them — the reads simply start when the
// view is asked for instead of on every load.

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

export interface DroughtReading {
  week_date: string
  d0: number | null
  d1: number | null
  d2: number | null
  d3: number | null
  d4: number | null
}

export interface CountyRow extends County {
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

// ─── Rainfall unit (streamed behind Suspense) ────────────────────────────────────
// The ACIS rainfall fetch can be slow on a cold cache, so it resolves INSIDE a Suspense
// boundary — the page shell, the news feed, and the Latest Reading card paint
// immediately while this streams in. RainfallPanelAsync awaits the precip promise
// server-side and hands the resolved value to the client PrecipVsNormalPanel, which
// renders every state honestly (data / no-station / 'data_unavailable' / null) — so a
// slow or failed ACIS shows skeleton → "temporarily unavailable", never a false zero.
export async function RainfallPanelAsync({
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
export function RainfallPanelSkeleton() {
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
export async function ForecastPanelAsync({ dataPromise }: { dataPromise: Promise<LocalForecast | null> }) {
  const data = await dataPromise
  return <ForecastPanel data={data} />
}

export function ForecastPanelSkeleton() {
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
export type LfpFetchOutcome = { ok: true; result: LfpEligibilityResult | null } | { ok: false }

// ─── View bodies — one async server component per peer view ────────────────
// Each is rendered on EVERY load (Commit 2 of the perf block: the toggle is
// client state, not a navigation) but behind its own Suspense boundary, so
// the shell + the always-on stack paint from the head reads alone and each
// body streams in when its own reads finish. The data each one gathers is
// exactly what the page used to gather only when that view was open; the
// gating on `view` is gone, nothing else moved. Signed-out gates and honest
// degrade states are unchanged inside.

export async function WeatherViewBody({
  selectedCounty, latest, nationalMap, user, lfpPromise, precipPromise, forecastPromise,
}: {
  selectedCounty: CountyRow
  latest: DroughtReading | null
  nationalMap: OfficialMapRecord | null
  user: { id: string } | null
  lfpPromise: Promise<LfpFetchOutcome>
  precipPromise: Promise<PrecipNormalResult>
  forecastPromise: Promise<LocalForecast | null>
}) {
  const db = createServiceClient()
  let history: DroughtReading[]                     = []
  let threeYearHistory: DroughtHistoryWeek[]        = []
  let stateMap: OfficialMapRecord | null            = null
  let lfpResult: LfpEligibilityResult | null          = null
  let regionalMapUrl: string | null                 = null
  let hayNearbyCount: number                        = 0
  let hayPrimaryVariety: string | null              = null
  let hayAvgPrice: number | null                    = null   // average DELIVERED $/ton, sell-only

  const state = selectedCounty.state

  // Run all ranch-view queries in parallel
  const [
    historyRes,
    stateMapRes,
    lfpRes,
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

    // Active hay listings — fetched for the nearby + cash-to-hay cards.
    // Marketplace flagged off → skip the query entirely (the card is gated too).
    flagEnabled('marketplace')
      ? db
          .from('hay_listings')
          .select('id, listing_type, hay_type, price_per_ton, counties(lat, lon, state)')
          .eq('active', true)
          .gt('expires_at', new Date().toISOString())
      : Promise.resolve({ data: [] }),
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

  // ── Own ground (S4) — the signed-in user's places for the Weather map overlay.
  // Fetched only where the map renders (drought view), via the page's USER-SCOPED
  // client (third RLS consumer). Signed out → null → the public map is unchanged.
  // A failed read → error:true so the map's status line says so (never a silent
  // absence); an auth-resolution failure → null (indistinguishable from signed
  // out, and treated as such).
  let ownGround: { places: OwnPlace[]; devices: OwnDevice[]; error: boolean } | null = null
  {
    try {
        const sb = await createClient()
      if (user) {
        // Places + PLACED devices in parallel (unplaced devices are honestly
        // off the map — the Devices tab is the full registry).
        const [placesRes, devicesRes] = await Promise.all([
          sb.from('places').select('id, name, kind, geometry').order('name', { ascending: true }),
          sb.from('devices').select('id, name, battery_pct, last_seen, place_id').not('place_id', 'is', null),
        ])
        ownGround = {
          places:  (placesRes.data ?? []) as OwnPlace[],
          devices: (devicesRes.data ?? []) as OwnDevice[],
          error:   !!placesRes.error || !!devicesRes.error,
        }
      }
    } catch {
      ownGround = null
    }
  }

  // Default reference estimate (100 head beef_adult) — feeds the hay card's
  // cash-to-hay line and the eligibility-math accordion preview.
  const bannerDefaultEstimate = (lfpResult && lfpResult.maxTier >= 1 && lfpResult.payments > 0)
    ? estimatePayment('beef_adult', 100, lfpResult.payments).cappedEstimate
    : 0

  // FSA-enforcement gate for the DOLLAR-bearing surfaces. The estimate above stays the real
  // value; this only gates VISIBILITY. A 'pending_obbba' county (D2 qualifies under OBBBA but
  // FSA hasn't loaded the 2026 maps) shows the amber pending banner and NO dollar figure.
  const lfpOfficial = !!lfpResult && lfpResult.enforcement === 'officially_eligible'
  // Cash-to-hay: how many tons the estimated LFP check buys at the average
  // delivered price nearby. Honest only when both the estimate and a real
  // delivered average exist; otherwise null → soft browse fallback.
  const cashToHayTons = (bannerDefaultEstimate > 0 && hayAvgPrice != null && hayAvgPrice > 0)
    ? Math.round(bannerDefaultEstimate / hayAvgPrice)
    : null

  return (
    <>
      {/* Which county you're looking at (flow, commit 4) — signed in, the county
          selector lives HERE, above the county-scoped weather, framed as changing
          the county in view, not as the page's main control (the operation is the
          subject up top). Signed out it isn't here: the public page keeps its
          selector under the header. Switching keeps you on Weather. */}
      {user && (
        <div>
          <p className={`${EYEBROW} mb-2`}>Looking at</p>
          <CountySelector selectedCounty={selectedCounty} view="drought" />
        </div>
      )}

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
        <p className={`${EYEBROW} mb-3`}>Rainfall vs normal</p>
        <Suspense fallback={<RainfallPanelSkeleton />}>
          <RainfallPanelAsync dataPromise={precipPromise} countyName={selectedCounty.name} />
        </Suspense>
      </div>

      {/* Rain by place — the operator's own gauge readings, signed-in only
          (the dashboard is public; signed out renders nothing). Absent under
          3 readings. Consumes the SAME precipPromise for the county line —
          no new fetch — and keeps the two kinds of fact visibly apart. */}
      <Suspense fallback={null}>
        <RainByPlaceCard precipPromise={precipPromise} user={user} />
      </Suspense>

      {/* 7-day forecast — the forward-looking weather cluster (with rainfall above).
          Compact swipe carousel; streamed behind Suspense like the rainfall panel. */}
      <div>
        <p className={`${EYEBROW} mb-3`}>7-day forecast</p>
        <Suspense fallback={<ForecastPanelSkeleton />}>
          <ForecastPanelAsync dataPromise={forecastPromise} />
        </Suspense>
      </div>

      {/* Weather verdict band — fills in Slice 4 (renders nothing yet) */}

      {/* Regional conditions map — COLLAPSED BY DEFAULT (Block 2): a 400px canvas
          everyone has already scrolled is reference material, not a daily signal;
          the LatestReadingCard above carries the current category + 3-year ribbon.
          Collapsed, the ssr:false map client NEVER mounts (DashboardAccordion
          renders children only when open), so the Leaflet payload is spent on
          demand — restoring the collapsed-accordion economy the loader was
          originally built for. The USDM week stays visible in the preview so
          freshness is never hidden behind the fold (data-derived, never today's
          date). Own-ground places/device pins draw when expanded, unchanged. */}
      <DashboardAccordion
        title="Regional map"
        preview={latest ? `U.S. Drought Monitor · week of ${formatDate(latest.week_date)}` : 'U.S. Drought Monitor'}
      >
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
          ownGround={ownGround}
        />
      </DashboardAccordion>


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

            {/* Hay (consolidated) — supply nearby + cash-to-hay context + one CTA.
                Rides the marketplace flag: no listings fetch, no card, no /hay CTA. */}
            {flagEnabled('marketplace') && (
            <Card shadow="none" className="px-5 py-4">
              <p className={`${EYEBROW} mb-3`}>
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
            )}

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
  )
}

export async function HayViewBody({
  selectedCounty,
}: {
  selectedCounty: CountyRow
}) {
  const db = createServiceClient()
  let hayNearbyCards: NearbyHayCard[]               = []   // nearest-4 sell listings — Hay view only
  let hayMapPins: MapListing[]                      = []   // same nearest-4, shaped for the hay map pins

  // ── Hay view data — nearest-4 sell listings (Hay view ONLY) ──────────────────
  // Runs only on view === 'hay' so news/drought never pay for it. Sell-only (matches
  // the "Hay nearby" card's listing-type filter), active, non-expired, with seller
  // county coords (coordless listings are dropped — never ranked, never shown).
  // Ranked by road miles from the home county centroid (selectedCounty), nearest 4.
  if (selectedCounty.lat != null && selectedCounty.lon != null) {
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

  return (
    <>
      <div className="space-y-4">
        <p className={EYEBROW}>
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
    </>
  )
}

export async function MarketsViewBody({
  selectedCounty, hasHerd,
}: {
  selectedCounty: CountyRow
  // The Market Read gate (signed-in with a herd) — resolved by whoever renders
  // the body: the page from its herd anchor, the deferred loader from the profile.
  hasHerd: boolean
}) {
  // LRP coverage-price floor — gated to the Markets view so news/drought/hay never pay
  // for it. getLatestLrp is a fast Supabase SELECT (the RMA fetch is the offline seed,
  // not a request-path call), so a direct await is fine — no Suspense needed. 'MT' is the
  // seeded national-index snapshot; the card frames it as the CME national floor, never a
  // state-specific claim. A miss degrades to 'none'/'data_unavailable', never a fake price.
  let lrpResult: LrpResult = { status: 'none' }
  // Local auction + national beef (Block 2) — same gating and same character as LRP:
  // pure Supabase SELECTs (the external fetches live in the snapshot crons, never the
  // request path), fetched concurrently, each degrading to its own honest state.
  let localAuction: LocalAuctionResult = { status: 'no_coverage' }
  let nationalBeef: NationalBeefResult = { status: 'none' }

  // Market Read chips (§4 Leg 3) — corn settle, feeding-region moisture, crop
  // condition, cattle cycle: fetched ONLY when the Market Read will render
  // (hasHerd), and only when this body renders (perf block, commit 5 — these
  // used to be awaited in the page head for every view). Fast service-role
  // SELECTs that never throw; none / data_unavailable keep each chip's honest
  // "warming up" / "temporarily unavailable" state.
  let corn: CornResult = { status: 'none' }
  let moisture: MoistureResult = { status: 'none' }
  let crop: CropResult = { status: 'none' }
  let cycle: CycleResult = { status: 'none' }

  const [lrpRes, localRes, nationalRes, chips] = await Promise.all([
    getLatestLrp('MT'),
    getLocalAuctionRead(selectedCounty.fips),
    getNationalBeef(),
    hasHerd
      ? Promise.all([getLatestCornSettle(), getFeedingRegionMoisture(), getLatestCropCondition(), getCattleCycle()])
      : Promise.resolve(null),
  ])
  lrpResult = lrpRes
  localAuction = localRes
  nationalBeef = nationalRes
  if (chips) [corn, moisture, crop, cycle] = chips

  return (
    <>
      {/* Market Read leads the view its chips belong to — the missing
          header for the cards below. Gate unchanged in the move
          (signed-in with a herd): relocation only, nobody's
          visibility changed. */}
      {hasHerd && <MarketReadShell corn={corn} moisture={moisture} crop={crop} cycle={cycle} />}
      <LocalAuctionCard result={localAuction} />
      <NationalBeefCard result={nationalBeef} />
      <LrpMarketsCard result={lrpResult} />
    </>
  )
}


// ─── Deferred render — what the server action returns on first activation ───
// Resolves the county and the session the way the page does (one service
// read, one getUser), then builds exactly the element the page would have put
// in the panel: same bodies, same Suspense fallbacks, same signed-out gates.
// External calls the page already made for the always-on stack (LFP
// eligibility, NWS, ACIS) are unstable_cache / fetch-cache hits here. An
// unknown county → null (nothing to show; the page itself would say so).
export type DeferredViewKey = Exclude<DashboardViewKey, 'news'>

export async function renderDeferredView(key: DeferredViewKey, params: ViewParams): Promise<ReactNode> {
  const db = createServiceClient()
  const supabase = await createClient()
  const [countyRes, session] = await Promise.all([
    db.from('counties').select('id, fips, name, state, lat, lon').eq('fips', params.fips).single(),
    supabase.auth.getUser().then(r => r.data.user).catch(() => null),
  ])
  const county = countyRes.data as CountyRow | null
  if (!county) return null
  const user = session ? { id: session.id } : null

  switch (key) {
    case 'jobs':
      return (
        <Suspense fallback={<JobsViewSkeleton />}>
          <JobsView user={user} />
        </Suspense>
      )
    case 'markets': {
      // The Market Read gate — signed-in with a herd — from the profile itself.
      let hasHerd = false
      if (user) {
        const profile = await getOperationProfile({ supabase, user })
        const herd = profile.status === 'ok' ? (profile.profile.herd as { lots?: Lot[] } | null) : null
        hasHerd = Array.isArray(herd?.lots) && herd!.lots.length > 0
      }
      return (
        <Suspense fallback={<JobsViewSkeleton />}>
          <MarketsViewBody selectedCounty={county} hasHerd={hasHerd} />
        </Suspense>
      )
    }
    case 'hay':
      if (!flagEnabled('marketplace')) return null
      return (
        <Suspense fallback={null}>
          <HayViewBody selectedCounty={county} />
        </Suspense>
      )
    case 'drought': {
      const [{ data: latestRow }, { data: nationalMapRow }] = await Promise.all([
        db.from('drought_data').select('week_date, d0, d1, d2, d3, d4').eq('county_id', county.id).order('week_date', { ascending: false }).limit(1).maybeSingle(),
        db.from('official_maps').select('id, map_type, scope, release_date, image_url, source_url').eq('map_type', 'usdm_national').is('scope', null).order('release_date', { ascending: false }).limit(1).maybeSingle(),
      ])
      const latest = latestRow as DroughtReading | null
      const nationalMap = nationalMapRow as OfficialMapRecord | null
      const { gs, ge, pt } = params
      const lfpPromise: Promise<LfpFetchOutcome> = computeLfpEligibility(county.fips, (() => {
        if (gs && ge) return { grazingPeriod: { startDate: gs, endDate: ge } }
        return { grazingPeriod: resolveDefaultGrazingWindow(county.fips, pt) }
      })())
        .then(result => ({ ok: true as const, result }))
        .catch(() => ({ ok: false as const }))
      const precipPromise: Promise<PrecipNormalResult> =
        getPrecipNormal(county.fips, county.lat, county.lon).catch(() => 'data_unavailable' as const)
      const forecastPromise: Promise<LocalForecast | null> =
        county.lat != null && county.lon != null
          ? getLocalForecast(county.lat, county.lon).catch(() => null)
          : Promise.resolve(null)
      return (
        <Suspense fallback={<RainfallPanelSkeleton />}>
          <WeatherViewBody
            selectedCounty={county}
            latest={latest}
            nationalMap={nationalMap}
            user={user}
            lfpPromise={lfpPromise}
            precipPromise={precipPromise}
            forecastPromise={forecastPromise}
          />
        </Suspense>
      )
    }
  }
}
