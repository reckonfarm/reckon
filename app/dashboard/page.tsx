import { createServiceClient } from '@/lib/supabase'
import { getLocalForecast } from '@/lib/nws'
import { computeLfpEligibility } from '@/lib/lfp-eligibility'
import { getGrazingPreset } from '@/lib/grazing-presets'
import CountySelector from './components/CountySelector'
import WatchlistButton from './components/WatchlistButton'
import OfficialMap from './components/OfficialMap'
import DroughtTrendChart from './components/DroughtTrendChart'
import ForecastSection from './components/ForecastSection'
import ProgramStatus from './components/ProgramStatus'
import type { County } from './components/CountySelector'
import type { OfficialMapRecord } from './components/OfficialMap'
import type { ForecastOutlook } from './components/ForecastSection'
import type { LfpEligibilityResult } from '@/lib/lfp-eligibility'

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
  const segments = [
    { pct: reading.d0 ?? 0, bg: '#FFFF00' },
    { pct: reading.d1 ?? 0, bg: '#FCD37F' },
    { pct: reading.d2 ?? 0, bg: '#FFAA00' },
    { pct: reading.d3 ?? 0, bg: '#E60000' },
    { pct: reading.d4 ?? 0, bg: '#730000' },
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

const LEVELS = [
  { key: 'd0' as const, label: 'D0', sublabel: 'Abnormally Dry',  dot: '#FFFF00' },
  { key: 'd1' as const, label: 'D1', sublabel: 'Moderate',        dot: '#FCD37F' },
  { key: 'd2' as const, label: 'D2', sublabel: 'Severe',          dot: '#FFAA00' },
  { key: 'd3' as const, label: 'D3', sublabel: 'Extreme',         dot: '#E60000' },
  { key: 'd4' as const, label: 'D4', sublabel: 'Exceptional',     dot: '#730000' },
]

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
  searchParams: Promise<{ fips?: string; gs?: string; ge?: string }>
}) {
  const { fips, gs, ge } = await searchParams
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
  let nwsForecast: Awaited<ReturnType<typeof getLocalForecast>> = null
  let lfpResult: LfpEligibilityResult | null        = null

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
      nwsResult,
      lfpRes,
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

      // NWS 7-day forecast (null if coords not seeded)
      selectedCounty.lat != null && selectedCounty.lon != null
        ? getLocalForecast(selectedCounty.lat, selectedCounty.lon)
        : Promise.resolve(null),

      // LFP eligibility
      computeLfpEligibility(selectedCounty.fips, (() => {
        if (gs && ge) return { grazingPeriod: { startDate: gs, endDate: ge } }
        const preset = getGrazingPreset(selectedCounty.fips, 2025)
        if (preset.source === 'county') return { grazingPeriod: { startDate: preset.startDate, endDate: preset.endDate } }
        return {}
      })()),
    ])

    history         = historyRes.data ?? []
    stateMap        = stateMapRes.data as OfficialMapRecord | null
    cpcMonthlyMap   = cpcMonthlyMapRes.data as OfficialMapRecord | null
    cpcSeasonalMap  = cpcSeasonalMapRes.data as OfficialMapRecord | null
    monthlyOutlook  = monthlyOutlookRes.data as ForecastOutlook | null
    seasonalOutlook = seasonalOutlookRes.data as ForecastOutlook | null
    nwsForecast     = nwsResult
    lfpResult       = lfpRes
  }

  const latest = history[0] ?? null

  return (
    <div className="min-h-screen bg-cream">

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-forest-green/10 bg-cream/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div>
            <p className="font-fraunces text-xl font-semibold text-forest-green sm:text-2xl">
              Reckon
            </p>
            <p className="text-xs text-forest-green/50 font-dm-sans">Drought Monitor</p>
          </div>
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
              <WatchlistButton
                countyId={selectedCounty.id}
                countyName={selectedCounty.name}
              />
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
              <div className="rounded-xl border border-forest-green/10 bg-white p-4 shadow-sm sm:p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-fraunces text-base font-semibold text-forest-green sm:text-lg">
                    Latest Reading
                  </h2>
                  <span className="rounded-full bg-forest-green/10 px-3 py-1 text-xs font-medium text-forest-green font-dm-sans">
                    Week of {formatDate(latest.week_date)}
                  </span>
                </div>

                <DroughtBar reading={latest} />

                {/* D0–D4 stat grid */}
                <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
                  {LEVELS.map(({ key, label, sublabel, dot }) => (
                    <div key={key} className="rounded-lg bg-cream p-3 text-center">
                      <div
                        className="mx-auto mb-1.5 h-2.5 w-2.5 rounded-full ring-1 ring-forest-green/10"
                        style={{ backgroundColor: dot }}
                      />
                      <dt className="text-xs text-forest-green/60 font-dm-sans leading-tight">
                        <span className="font-semibold">{label}</span> {sublabel}
                      </dt>
                      <dd className="mt-1 font-fraunces text-xl font-semibold text-forest-green">
                        {(latest[key] ?? 0).toFixed(1)}
                        <span className="text-sm font-normal text-forest-green/50">%</span>
                      </dd>
                    </div>
                  ))}
                </dl>

                <p className="mt-3 text-xs text-forest-green/40 font-dm-sans">
                  Source: U.S. Drought Monitor · droughtmonitor.unl.edu
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
              fips={selectedCounty.fips}
              countyName={selectedCounty.name}
            />

            {/* Official maps row: state + national */}
            <div className="grid gap-6 sm:grid-cols-2">
              <OfficialMap
                map={stateMap ?? nationalMap}
                title={`USDM — ${selectedCounty.state}`}
                note={
                  stateMap == null && nationalMap != null
                    ? `USDM does not publish per-state map images. Locate ${selectedCounty.state} on this national view.`
                    : undefined
                }
              />
              <OfficialMap
                map={nationalMap}
                title="USDM — National"
              />
            </div>

            {/* Conditions & Outlook section */}
            <ForecastSection
              countyName={selectedCounty.name}
              latestReading={latest}
              nwsForecast={nwsForecast}
              monthlyOutlook={monthlyOutlook}
              seasonalOutlook={seasonalOutlook}
              cpcMonthlyMap={cpcMonthlyMap}
              cpcSeasonalMap={cpcSeasonalMap}
              hasCoords={selectedCounty.lat != null && selectedCounty.lon != null}
            />

            {/* Recent history table */}
            {history.length > 1 && (
              <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-sm">
                <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
                  <h2 className="font-fraunces text-base font-semibold text-forest-green">
                    Recent History
                  </h2>
                </div>

                {/* Mobile: card stack */}
                <div className="divide-y divide-forest-green/10 sm:hidden">
                  {history.slice(0, 12).map(row => (
                    <div key={row.week_date} className="px-4 py-3">
                      <p className="mb-2 text-xs font-medium text-forest-green/60 font-dm-sans">
                        {formatDate(row.week_date)}
                      </p>
                      <DroughtBar reading={row} />
                      <div className="mt-2 flex gap-3 text-xs text-forest-green/60 font-dm-sans">
                        {LEVELS.map(({ key, label }) => (
                          <span key={key}>
                            {label}{' '}
                            <span className="font-medium text-forest-green">
                              {(row[key] ?? 0).toFixed(0)}%
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop: table */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm font-dm-sans">
                    <thead>
                      <tr className="border-b border-forest-green/10 bg-cream/50">
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-forest-green/50">
                          Week
                        </th>
                        {LEVELS.map(({ label, dot }) => (
                          <th
                            key={label}
                            className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wide text-forest-green/50"
                          >
                            <span className="inline-flex items-center gap-1">
                              <span
                                className="inline-block h-2 w-2 rounded-full ring-1 ring-forest-green/10"
                                style={{ backgroundColor: dot }}
                              />
                              {label}
                            </span>
                          </th>
                        ))}
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-forest-green/50">
                          Distribution
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-forest-green/10">
                      {history.map(row => (
                        <tr key={row.week_date} className="hover:bg-cream/40">
                          <td className="px-6 py-3 font-medium text-forest-green">
                            {formatDate(row.week_date)}
                          </td>
                          {LEVELS.map(({ key }) => (
                            <td key={key} className="px-3 py-3 text-right tabular-nums text-forest-green/70">
                              {(row[key] ?? 0).toFixed(1)}%
                            </td>
                          ))}
                          <td className="px-6 py-3">
                            <div className="w-32">
                              <DroughtBar reading={row} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* FSA disclaimer */}
            <p className="rounded-lg border border-forest-green/10 bg-white px-4 py-3 text-xs text-forest-green/50 font-dm-sans">
              Drought data is provided for general awareness only. Your local FSA office makes
              the final determination for all program eligibility and assistance decisions.
              Data sources: U.S. Drought Monitor (droughtmonitor.unl.edu), NOAA/NWS
              (weather.gov), NOAA CPC (cpc.ncep.noaa.gov).
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
      <div className="mb-4 text-5xl select-none">🌾</div>
      <h2 className="font-fraunces text-xl font-semibold text-forest-green sm:text-2xl">
        Select a county to begin
      </h2>
      <p className="mt-2 max-w-xs text-sm text-forest-green/60 font-dm-sans">
        Search above to view drought conditions and weekly history for any US county.
      </p>
    </div>
  )
}
