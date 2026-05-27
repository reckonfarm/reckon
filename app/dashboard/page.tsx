import { createServiceClient } from '@/lib/supabase'
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
import type { County } from './components/CountySelector'
import type { OfficialMapRecord } from './components/OfficialMap'
import type { ForecastOutlook, DroughtDiscussion } from './components/ForecastSection'
import type { LfpEligibilityResult } from '@/lib/lfp-eligibility'
import { getDroughtDiscussion } from '@/lib/drought-discussion'
import { getNwsDiscussion, type NwsDiscussion } from '@/lib/nws-discussion'
import { getPrecipNormal, type PrecipNormalData } from '@/lib/precip-normal'

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
    ])

    history            = historyRes.data ?? []
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

  return (
    <div className="min-h-screen bg-cream">

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-forest-green/10 bg-cream/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/">
            <p className="font-fraunces text-xl font-semibold text-forest-green sm:text-2xl">
              Reckon
            </p>
            <p className="text-xs text-forest-green/50 font-dm-sans">Drought Monitor</p>
          </Link>
          {selectedCounty && (
            <p className="hidden text-sm text-forest-green/60 font-dm-sans sm:block">
              {selectedCounty.name}, {selectedCounty.state}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">

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

        {/* ── Ranch view (county selected) ──────────────────────────────────── */}
        {selectedCounty && (
          <div className="space-y-6">

            {/* County heading + watchlist button */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
                  {selectedCounty.name}
                </h1>
                <p className="mt-0.5 text-sm text-forest-green/60 font-dm-sans">
                  {selectedCounty.state} · FIPS {selectedCounty.fips}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href="/watchlist"
                  className="font-dm-sans text-sm text-forest-green/60 underline hover:text-forest-green"
                >
                  My Counties
                </Link>
                <WatchlistButton
                  countyId={selectedCounty.id}
                  countyName={selectedCounty.name}
                />
              </div>
            </div>

            {/* No data yet */}
            {!latest && (
              <div className="rounded-xl border border-forest-green/10 bg-white p-6 text-center">
                <p className="text-sm text-forest-green/60 font-dm-sans">
                  No drought data yet for this county. Trigger the ingestion cron to populate it.
                </p>
              </div>
            )}

            {/* Latest reading card */}
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

            {/* 52-week trend chart */}
            {history.length > 0 && (
              <DroughtTrendChart history={history} countyName={selectedCounty.name} />
            )}

            {/* Program Status — LFP eligibility and row crop programs */}
            <ProgramStatus
              eligibility={lfpResult}
              priorYearEligibility={priorYearLfpResult}
              fips={selectedCounty.fips}
              countyName={selectedCounty.name}
            />

            {/* Precipitation vs Normal card */}
            {precipNormal !== null && precipNormal.dailyData.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-[0_2px_12px_rgba(27,67,50,0.08)]">
                <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
                  <h2 className="font-fraunces text-base font-semibold text-forest-green">
                    Precipitation vs Normal — {selectedCounty.name}
                  </h2>
                </div>
                <div className="p-4 sm:p-6">
                  <PrecipVsNormalPanel data={precipNormal} />
                </div>
              </div>
            )}

            {/* Official maps row: regional + national + monthly + seasonal */}
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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

            {/* Conditions & Outlook section */}
            <ForecastSection
              stateAbbr={selectedCounty.state}
              droughtDiscussion={droughtDiscussion}
              cpcSoilMoistureUpdated={cpcSoilMoistureUpdated}
              vhiUpdated={vhiUpdated}
              hprcc14dUpdated={hprcc14dUpdated}
              hprcc30dUpdated={hprcc30dUpdated}
              hprcc60dUpdated={hprcc60dUpdated}
            />

            {/* Precipitation Forecast & Deficit section */}
            <PrecipForecastSection
              nwsDiscussion={nwsDiscussion}
              wpcUpdated={wpcUpdated}
              day814Updated={prcp814Updated}
              weeks34Updated={prcpWk34Updated}
              monthlyUpdated={prcpMonthlyUpdated}
              seasonalUpdated={prcpSeasonalUpdated}
            />

            {/* FSA disclaimer */}
            <p className="rounded-lg border border-forest-green/10 bg-white px-4 py-3 text-xs text-forest-green/50 font-dm-sans">
              Drought data is provided for general awareness only. Your local FSA office makes
              the final determination for all program eligibility and assistance decisions.
              Data sources:{' '}
              <a href="https://droughtmonitor.unl.edu" target="_blank" rel="noopener noreferrer" className="underline">U.S. Drought Monitor</a>,{' '}
              <a href="https://weather.gov" target="_blank" rel="noopener noreferrer" className="underline">NOAA/NWS</a>,{' '}
              <a href="https://cpc.ncep.noaa.gov" target="_blank" rel="noopener noreferrer" className="underline">NOAA CPC</a>.
            </p>
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
