import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase'
import SiteHeader from '@/app/components/SiteHeader'
import { computeLfpEligibility } from '@/lib/lfp-eligibility'
import { getGrazingPeriod } from '@/lib/grazing-periods'
import Link from 'next/link'
import CountySelector from './components/CountySelector'
import WatchlistButton from './components/WatchlistButton'
import OfficialMap from './components/OfficialMap'
import DroughtTrendChart from './components/DroughtTrendChart'
import ForecastSection from './components/ForecastSection'
import PrecipForecastSection, { PrecipVsNormalPanel } from './components/PrecipForecastSection'
import ProgramStatus from './components/ProgramStatus'
import TriggeredBanner from './components/TriggeredBanner'
import type { County } from './components/CountySelector'
import type { OfficialMapRecord } from './components/OfficialMap'
import type { ForecastOutlook, DroughtDiscussion } from './components/ForecastSection'
import type { LfpEligibilityResult } from '@/lib/lfp-eligibility'
import { getDroughtDiscussion } from '@/lib/drought-discussion'
import { getNwsDiscussion, type NwsDiscussion } from '@/lib/nws-discussion'
import { getPrecipNormal, type PrecipNormalData } from '@/lib/precip-normal'
import DroughtHistoryChart, { type DroughtHistoryWeek } from './components/DroughtHistoryChart'
import { estimatePayment } from '@/lib/lfp-payment'
import { deliveredCost, type DeliveredCost } from '@/lib/freight'
import DashboardAccordion from './components/DashboardAccordion'
import ScrollToTop from './components/ScrollToTop'

export const dynamic = 'force-dynamic'

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
  searchParams: Promise<{ fips?: string; gs?: string; ge?: string; pt?: string }>
}) {
  const { fips, gs, ge, pt } = await searchParams
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
  let history: DroughtReading[]                     = []
  let threeYearHistory: DroughtHistoryWeek[]        = []
  let stateMap: OfficialMapRecord | null            = null
  let cpcMonthlyMap: OfficialMapRecord | null       = null
  let cpcSeasonalMap: OfficialMapRecord | null      = null
  let monthlyOutlook: ForecastOutlook | null        = null
  let seasonalOutlook: ForecastOutlook | null       = null
  let lfpResult: LfpEligibilityResult | null          = null
  let priorYearLfpResult: LfpEligibilityResult | null = null
  let droughtDiscussion: DroughtDiscussion | null   = null
  let wpcUpdated: string | null                     = null
  let prcp814Updated: string | null                 = null
  let prcpWk34Updated: string | null                = null
  let prcpMonthlyUpdated: string | null             = null
  let prcpSeasonalUpdated: string | null            = null
  let nwsDiscussion: NwsDiscussion | null           = null
  let precipNormal: PrecipNormalData | null         = null
  let cpcSoilMoistureUpdated: string | null         = null
  let vhiUpdated: string | null                     = null
  let hprcc14dUpdated: string | null                = null
  let hprcc30dUpdated: string | null                = null
  let hprcc60dUpdated: string | null                = null
  let regionalMapUrl: string | null                 = null
  let hayNearbyCount: number                        = 0
  let hayPrimaryVariety: string | null              = null
  let hayAvgPrice: number | null                    = null   // average DELIVERED $/ton, sell-only

  if (selectedCounty) {
    const state = selectedCounty.state

    // Run all ranch-view queries in parallel
    const [
      historyRes,
      stateMapRes,
      cpcMonthlyMapRes,
      cpcSeasonalMapRes,
      monthlyOutlookRes,
      seasonalOutlookRes,
      lfpRes,
      discussionRes,
      wpcHead,
      prcp814Head,
      prcpWk34Head,
      prcpMonthlyHead,
      prcpSeasonalHead,
      nwsDiscussionRes,
      precipNormalRes,
      cpcSoilMoistureHead,
      vhiHead,
      hprcc14dHead,
      hprcc30dHead,
      hprcc60dHead,
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

      // CPC monthly text outlook for this county
      db
        .from('forecast_outlooks')
        .select('outlook_type, outlook_text, release_date, valid_through')
        .eq('county_id', selectedCounty.id)
        .eq('outlook_type', 'monthly')
        .order('release_date', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // CPC seasonal text outlook for this county
      db
        .from('forecast_outlooks')
        .select('outlook_type, outlook_text, release_date, valid_through')
        .eq('county_id', selectedCounty.id)
        .eq('outlook_type', 'seasonal')
        .order('release_date', { ascending: false })
        .limit(1)
        .maybeSingle(),

      // LFP eligibility
      computeLfpEligibility(selectedCounty.fips, (() => {
        if (gs && ge) return { grazingPeriod: { startDate: gs, endDate: ge } }
        const period = getGrazingPeriod(selectedCounty.fips, pt)
        if (period) {
          const current = new Date().getFullYear()
          const startMM = parseInt(period.start.slice(0, 2), 10)
          const endMM   = parseInt(period.end.slice(0, 2), 10)
          const endYear = endMM < startMM ? current + 1 : current
          return { grazingPeriod: { startDate: `${current}-${period.start}`, endDate: `${endYear}-${period.end}` } }
        }
        // Generic Northern Plains fallback for counties not in FOIA dataset
        const yr = new Date().getFullYear()
        return { grazingPeriod: { startDate: `${yr}-05-01`, endDate: `${yr}-11-30` } }
      })()),

      // USDM drought discussion narrative (weekly, cached 24h)
      getDroughtDiscussion(state),

      // WPC 7-day QPF map provenance — HEAD request for Last-Modified (cached 1h)
      fetch('https://www.wpc.ncep.noaa.gov/qpf/p168i.gif', {
        method: 'HEAD',
        next: { revalidate: 3600 },
      }).catch(() => null),

      // CPC precipitation outlook map provenances (cached 1h)
      fetch('https://www.cpc.ncep.noaa.gov/products/predictions/814day/814prcp.new.gif', {
        method: 'HEAD',
        next: { revalidate: 3600 },
      }).catch(() => null),

      fetch('https://www.cpc.ncep.noaa.gov/products/predictions/WK34/gifs/WK34prcp.gif', {
        method: 'HEAD',
        next: { revalidate: 3600 },
      }).catch(() => null),

      fetch('https://www.cpc.ncep.noaa.gov/products/predictions/30day/off14_prcp.gif', {
        method: 'HEAD',
        next: { revalidate: 3600 },
      }).catch(() => null),

      fetch('https://www.cpc.ncep.noaa.gov/products/predictions/long_range/lead01/off01_prcp.gif', {
        method: 'HEAD',
        next: { revalidate: 3600 },
      }).catch(() => null),

      // NWS Area Forecast Discussion — .DISCUSSION section for local precip narrative
      selectedCounty.lat != null && selectedCounty.lon != null
        ? getNwsDiscussion(selectedCounty.lat, selectedCounty.lon)
        : Promise.resolve(null),

      // ACIS YTD precipitation vs 30-year normals
      getPrecipNormal(selectedCounty.fips, selectedCounty.lat, selectedCounty.lon),

      // Drought condition map provenances (cached 1h)
      fetch('https://www.cpc.ncep.noaa.gov/products/Soilmst_Monitoring/Figures/daily/curr.w.anom.daily.gif', {
        method: 'HEAD',
        next: { revalidate: 3600 },
      }).catch(() => null),

      (() => {
        const now = new Date()
        const yr = now.getUTCFullYear()
        const doy = Math.floor((now.getTime() - Date.UTC(yr, 0, 1)) / 86400000) + 1
        const wk = String(Math.ceil(doy / 7) - 1).padStart(2, '0')
        return fetch(
          `https://www.star.nesdis.noaa.gov/smcd/emb/vci/WebDataVH/gvix_webImages/${yr}/USA_VHI_DIVISION_${yr}${wk}.png`,
          { method: 'HEAD', next: { revalidate: 3600 } },
        ).catch(() => null)
      })(),

      fetch('https://hprcc.unl.edu/products/maps/acis/14dPNormUS.png', {
        method: 'HEAD',
        next: { revalidate: 3600 },
      }).catch(() => null),

      fetch('https://hprcc.unl.edu/products/maps/acis/30dPNormUS.png', {
        method: 'HEAD',
        next: { revalidate: 3600 },
      }).catch(() => null),

      fetch('https://hprcc.unl.edu/products/maps/acis/60dPNormUS.png', {
        method: 'HEAD',
        next: { revalidate: 3600 },
      }).catch(() => null),

      // Prior year LFP eligibility — same forage period but year - 1
      computeLfpEligibility(selectedCounty.fips, (() => {
        const period = getGrazingPeriod(selectedCounty.fips, pt)
        if (period) {
          const prior   = new Date().getFullYear() - 1
          const startMM = parseInt(period.start.slice(0, 2), 10)
          const endMM   = parseInt(period.end.slice(0, 2), 10)
          const endYear = endMM < startMM ? prior + 1 : prior
          return { grazingPeriod: { startDate: `${prior}-${period.start}`, endDate: `${endYear}-${period.end}` } }
        }
        const prior = new Date().getFullYear() - 1
        return { grazingPeriod: { startDate: `${prior}-05-01`, endDate: `${prior}-11-30` } }
      })()),

      // 3-year weekly drought history from USDM API (statisticsType=2 = actual per-category %)
      (() => {
        const today        = new Date().toISOString().slice(0, 10)
        const threeYearsAgo = new Date(Date.now() - 3 * 365.25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        return fetch(
          `https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent` +
          `?aoi=${selectedCounty.fips}&startdate=${threeYearsAgo}&enddate=${today}&statisticsType=2`,
          { headers: { Accept: 'application/json' }, next: { revalidate: 86400 } },
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
    monthlyOutlook     = monthlyOutlookRes.data as ForecastOutlook | null
    seasonalOutlook    = seasonalOutlookRes.data as ForecastOutlook | null
    lfpResult          = lfpRes
    priorYearLfpResult = priorYearLfpRes
    droughtDiscussion  = discussionRes
    const lastMod      = wpcHead?.headers.get('last-modified')
    if (lastMod) {
      wpcUpdated = new Date(lastMod).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
      })
    }
    const fmtLM = (res: Response | null) => {
      const lm = res?.headers.get('last-modified')
      return lm ? new Date(lm).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
      }) : null
    }
    prcp814Updated      = fmtLM(prcp814Head)
    prcpWk34Updated     = fmtLM(prcpWk34Head)
    prcpMonthlyUpdated  = fmtLM(prcpMonthlyHead)
    prcpSeasonalUpdated = fmtLM(prcpSeasonalHead)
    nwsDiscussion       = nwsDiscussionRes
    precipNormal        = precipNormalRes
    cpcSoilMoistureUpdated = fmtLM(cpcSoilMoistureHead)
    vhiUpdated             = fmtLM(vhiHead)
    hprcc14dUpdated        = fmtLM(hprcc14dHead)
    hprcc30dUpdated        = fmtLM(hprcc30dHead)
    hprcc60dUpdated        = fmtLM(hprcc60dHead)

    if (selectedCounty.lat != null && selectedCounty.lon != null) {
      const buyer = { lat: selectedCounty.lat, lon: selectedCounty.lon }

      // One consistent set: ACTIVE SELL listings, priced, with seller coords,
      // within 200 ROAD miles (haversine × 1.2). deliveredCost enforces sell +
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

  const latest = history[0] ?? null

  // Default estimate for the triggered banner (100 head beef_adult)
  const bannerDefaultEstimate = (lfpResult && lfpResult.maxTier >= 1 && lfpResult.payments > 0)
    ? estimatePayment('beef_adult', 100, lfpResult.payments).grossEstimate
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
        subtitle="Drought Monitor"
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
        {!fips && (
          <div className="space-y-6">
            <EmptyState />
            <OfficialMap map={nationalMap} title="U.S. Drought Monitor — National" />
          </div>
        )}

        {fips && !selectedCounty && (
          <p className="text-sm text-forest-green/60 font-dm-sans">
            County not found for FIPS {fips}.
          </p>
        )}

        {/* ── Ranch view (county selected) ───────────────────────── */}
        {selectedCounty && (
          <div className="max-w-2xl mx-auto px-4 pb-16 space-y-4">

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

            {/* County heading */}
            <div className="flex items-center justify-between pt-2">
              <div>
                <h1 className="font-fraunces text-2xl font-semibold text-forest-green">
                  {selectedCounty.name}, {selectedCounty.state}
                </h1>
                <p className="text-sm text-forest-green/50 font-dm-sans mt-0.5">
                  FIPS {selectedCounty.fips}
                </p>
              </div>
              <WatchlistButton
                countyId={selectedCounty.id}
                countyName={selectedCounty.name}
              />
            </div>

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

                  {/* Current conditions card */}
                  <div className="rounded-xl border border-forest-green/10 bg-white px-5 py-4">
                    <p className="text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide mb-3">Current conditions</p>
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
                  </div>

                  {/* Rainfall vs normal card */}
                  <div className="rounded-xl border border-forest-green/10 bg-white px-5 py-4">
                    <p className="text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide mb-3">Rainfall vs normal</p>
                    <PrecipVsNormalPanel data={precipNormal} />
                  </div>

                  {/* Forage outlook / Hay nearby card */}
                  <div className="rounded-xl border border-forest-green/10 bg-white px-5 py-4">
                    <p className="text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide mb-3">
                      {lfpResult && lfpResult.maxTier >= 1 ? 'Forage outlook' : 'Hay nearby'}
                    </p>

                    {lfpResult && lfpResult.maxTier >= 1 ? (
                      /* Triggered: forage outlook hero */
                      <div className="space-y-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
                          {/* Left: pasture estimate */}
                          <div className="flex-1 rounded-lg bg-rust/8 border border-rust/15 px-4 py-3">
                            <p className="font-dm-sans text-xs font-medium text-rust/70 uppercase tracking-wide mb-1">Pasture outlook</p>
                            <p className="font-fraunces text-sm font-semibold text-forest-green leading-snug">
                              {lfpResult.maxTier >= 4
                                ? 'Pastures may stop carrying cows within ~1 week at this rate.'
                                : lfpResult.maxTier >= 3
                                ? 'Pastures will likely stop carrying cows in ~3 weeks at this rate.'
                                : 'Pastures will likely stop carrying cows in ~6 weeks at this rate.'}
                            </p>
                          </div>
                          {/* Right: hay supply */}
                          <div className="flex-1 rounded-lg bg-forest-green/5 border border-forest-green/10 px-4 py-3">
                            <p className="font-dm-sans text-xs font-medium text-forest-green/40 uppercase tracking-wide mb-1">Hay supply nearby</p>
                            {hayNearbyCount > 0 ? (
                              <p className="font-fraunces text-sm font-semibold text-forest-green leading-snug">
                                {hayNearbyCount} seller{hayNearbyCount !== 1 ? 's' : ''} within 200 mi
                                {hayPrimaryVariety && ` · ${hayPrimaryVariety.toLowerCase()}`}
                                {hayAvgPrice && ` · avg $${hayAvgPrice}/ton`}
                              </p>
                            ) : (
                              <p className="font-fraunces text-sm font-semibold text-forest-green/50 leading-snug">
                                No hay listed within 200 mi yet.
                              </p>
                            )}
                          </div>
                        </div>
                        <Link
                          href={`/hay?deliverTo=${selectedCounty.fips}&type=sell`}
                          className="block w-full rounded-lg bg-forest-green px-4 py-2.5 font-dm-sans text-sm font-semibold text-white text-center hover:bg-forest-green/90 transition-colors"
                        >
                          View hay nearby →
                        </Link>
                        {hayNearbyCount === 0 && (
                          <p className="text-center font-dm-sans text-xs text-forest-green/40">
                            <Link href="/hay" className="underline hover:text-forest-green">Post hay for sale</Link> to reach ranchers in drought-affected counties.
                          </p>
                        )}
                      </div>
                    ) : (
                      /* Not triggered: simple hay nearby card */
                      <div className={[
                        'overflow-hidden rounded-xl border bg-white shadow-[0_2px_12px_rgba(27,67,50,0.08)]',
                        hayNearbyCount > 0 ? 'border-l-4 border-l-forest-green border-forest-green/10' : 'border-forest-green/10',
                      ].join(' ')}>
                        <div className="p-4 sm:p-5">
                          {hayNearbyCount > 0 ? (
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-fraunces text-base font-semibold text-forest-green sm:text-lg">
                                  🌾 {hayNearbyCount} hay listing{hayNearbyCount !== 1 ? 's' : ''} within 200 miles
                                </p>
                                <p className="mt-0.5 text-sm text-forest-green/60 font-dm-sans">
                                  Sellers nearby — sorted by distance on the hay board
                                </p>
                              </div>
                              <Link
                                href={`/hay?deliverTo=${selectedCounty.fips}&type=sell`}
                                className="shrink-0 rounded-lg bg-forest-green px-4 py-2 font-dm-sans text-sm font-semibold text-white hover:bg-forest-green/90 transition-colors"
                              >
                                Find hay near you →
                              </Link>
                            </div>
                          ) : (
                            <div className="rounded-lg border-2 border-dashed border-forest-green/20 px-4 py-6 text-center">
                              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-forest-green/8">
                                <svg className="h-5 w-5 text-forest-green/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                </svg>
                              </div>
                              <p className="font-fraunces text-sm font-semibold text-forest-green">No hay listings nearby</p>
                              <p className="mt-1 font-dm-sans text-xs text-forest-green/50">
                                <Link href="/hay" className="underline hover:text-forest-green">Post hay for sale</Link> to reach ranchers in drought-affected counties.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Cash-to-hay loop — only when triggered with a real estimate */}
                  {lfpResult && lfpResult.maxTier >= 1 && bannerDefaultEstimate > 0 && (
                    <div className="rounded-xl border border-forest-green/10 bg-white px-5 py-4">
                      <p className="text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide mb-3">
                        Put your LFP toward hay
                      </p>

                      {cashToHayTons != null && hayAvgPrice != null ? (
                        <>
                          <p className="font-fraunces text-base font-semibold text-forest-green leading-snug sm:text-lg">
                            Your estimated LFP payment of ~${Math.round(bannerDefaultEstimate).toLocaleString()} could buy
                            roughly ~{cashToHayTons.toLocaleString()} ton{cashToHayTons !== 1 ? 's' : ''} of hay delivered
                            to {selectedCounty.name} County.
                          </p>
                          <p className="mt-2 font-dm-sans text-sm text-forest-green/60">
                            Based on ~${hayAvgPrice.toLocaleString()}/ton average delivered price from {hayNearbyCount} seller{hayNearbyCount !== 1 ? 's' : ''} within 200 miles.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-fraunces text-base font-semibold text-forest-green leading-snug sm:text-lg">
                            Your estimated LFP payment is ~${Math.round(bannerDefaultEstimate).toLocaleString()}.
                          </p>
                          <p className="mt-2 font-dm-sans text-sm text-forest-green/60">
                            No priced hay listed within 200 miles yet — browse what&apos;s posted, priced to your county.
                          </p>
                        </>
                      )}

                      <Link
                        href={`/hay?deliverTo=${selectedCounty.fips}&type=sell`}
                        className="mt-3 block w-full rounded-lg bg-forest-green px-4 py-2.5 font-dm-sans text-sm font-semibold text-white text-center hover:bg-forest-green/90 transition-colors"
                      >
                        {cashToHayTons != null
                          ? `Shop hay delivered to ${selectedCounty.name} →`
                          : `Browse hay delivered to ${selectedCounty.name} →`}
                      </Link>

                      <p className="mt-3 font-dm-sans text-xs text-forest-green/40 leading-snug">
                        Estimate assumes ~100 head of adult beef cattle — your actual payment and tonnage depend on your
                        herd. Not a guarantee of payment or price.
                      </p>
                    </div>
                  )}

                </div>

                {/* LAYER 3 — Deep dive accordions */}
                <div className="space-y-2 pt-2">

                  <DashboardAccordion
                    title="Eligibility math"
                    preview={lfpResult && lfpResult.maxTier >= 1 ? `Tier ${lfpResult.maxTier} — ${lfpResult.payments} payment${lfpResult.payments !== 1 ? 's' : ''}` : 'Not currently triggered'}
                    previewAmount={lfpResult && lfpResult.maxTier >= 1 && bannerDefaultEstimate > 0 ? `~$${Math.round(bannerDefaultEstimate).toLocaleString()}` : undefined}
                    highlight={!!(lfpResult && lfpResult.maxTier >= 1)}
                    defaultOpen={!!(lfpResult && lfpResult.maxTier >= 1)}
                  >
                    {lfpResult && (
                      <ProgramStatus
                        eligibility={lfpResult}
                        priorYearEligibility={priorYearLfpResult}
                        fips={selectedCounty.fips}
                        countyName={selectedCounty.name}
                      />
                    )}
                  </DashboardAccordion>

                  <DashboardAccordion
                    title="Regional context"
                    preview="USDM maps and drought outlook"
                  >
                    <div className="space-y-6">
                      <OfficialMap
                        map={stateMap ?? nationalMap}
                        title={`USDM — ${selectedCounty.state}`}
                        note={
                          stateMap == null && nationalMap != null && regionalMapUrl == null
                            ? `USDM does not publish per-state map images. Locate ${selectedCounty.state} on this national view.`
                            : undefined
                        }
                        regionalMapUrl={regionalMapUrl}
                      />
                      <div className="grid gap-4 sm:grid-cols-3">
                        <OfficialMap
                          map={nationalMap}
                          title="USDM — National"
                        />
                        <OfficialMap
                          map={cpcMonthlyMap}
                          title="Monthly Drought Outlook"
                        />
                        <OfficialMap
                          map={cpcSeasonalMap}
                          title="Seasonal Drought Outlook"
                        />
                      </div>
                    </div>
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

                  <DashboardAccordion
                    title="Forecast"
                    preview="NWS discussion, rainfall outlook, soil moisture"
                  >
                    <div className="space-y-6">
                      <ForecastSection
                        stateAbbr={selectedCounty.state}
                        droughtDiscussion={droughtDiscussion}
                        cpcSoilMoistureUpdated={cpcSoilMoistureUpdated}
                        vhiUpdated={vhiUpdated}
                        hprcc14dUpdated={hprcc14dUpdated}
                        hprcc30dUpdated={hprcc30dUpdated}
                        hprcc60dUpdated={hprcc60dUpdated}
                      />
                      <PrecipForecastSection
                        nwsDiscussion={nwsDiscussion}
                        wpcUpdated={wpcUpdated}
                        day814Updated={prcp814Updated}
                        weeks34Updated={prcpWk34Updated}
                        monthlyUpdated={prcpMonthlyUpdated}
                        seasonalUpdated={prcpSeasonalUpdated}
                      />
                    </div>
                  </DashboardAccordion>

                </div>

                {/* FSA disclaimer */}
                <p className="text-xs text-forest-green/40 font-dm-sans text-center pt-2">
                  LFP payment estimates are for planning purposes only. Contact your local FSA office for official determinations.
                </p>
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
