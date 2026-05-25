'use client'

import { useState } from 'react'
import type { OfficialMapRecord } from './OfficialMap'

// ─── Shared types (no server-only — serialized across RSC boundary) ───────────

export interface ForecastOutlook {
  outlook_type: string
  outlook_text: string
  release_date: string
  valid_through: string | null
}

interface NWSPeriod {
  name: string
  isDaytime: boolean
  temperature: number
  temperatureUnit: string
  shortForecast: string
  detailedForecast: string
  startTime: string
}

interface LocalForecast {
  generatedAt: string
  updateTime: string
  periods: NWSPeriod[]
  forecastUrl: string
}

interface DroughtReading {
  week_date: string
  d0: number | null
  d1: number | null
  d2: number | null
  d3: number | null
  d4: number | null
}

interface Props {
  countyName: string
  latestReading: DroughtReading | null
  nwsForecast: LocalForecast | null
  monthlyOutlook: ForecastOutlook | null
  seasonalOutlook: ForecastOutlook | null
  cpcMonthlyMap: OfficialMapRecord | null
  cpcSeasonalMap: OfficialMapRecord | null
  hasCoords: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = ['Now', 'Week', 'Month', 'Season'] as const
type Tab = typeof TABS[number]

const D_COLORS = ['#FFFF00', '#FCD37F', '#FFAA00', '#E60000', '#730000']
const D_LABELS = ['Abnormally Dry', 'Moderate', 'Severe', 'Extreme', 'Exceptional']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function calcMaxCategory(reading: DroughtReading): number {
  if ((reading.d4 ?? 0) > 0) return 4
  if ((reading.d3 ?? 0) > 0) return 3
  if ((reading.d2 ?? 0) > 0) return 2
  if ((reading.d1 ?? 0) > 0) return 1
  if ((reading.d0 ?? 0) > 0) return 0
  return -1
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ForecastBadge() {
  return (
    <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 font-dm-sans">
      Forecast — not a current observation
    </span>
  )
}

function MapBlock({ map, title }: { map: OfficialMapRecord | null; title: string }) {
  if (!map) {
    return (
      <div className="flex min-h-[160px] items-center justify-center rounded-lg border border-forest-green/10 bg-cream p-4 text-center">
        <p className="text-xs text-forest-green/40 font-dm-sans">
          {title} — updating after next release.
        </p>
      </div>
    )
  }
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={map.image_url} alt={title} className="w-full rounded-lg" loading="lazy" />
      <p className="mt-2 text-xs text-forest-green/50 font-dm-sans">
        Released {formatDate(map.release_date)} ·{' '}
        <a href={map.source_url} target="_blank" rel="noopener noreferrer" className="underline">
          Source
        </a>
      </p>
    </div>
  )
}

// ─── Tab panels ───────────────────────────────────────────────────────────────

function NowPanel({ reading }: { reading: DroughtReading | null }) {
  if (!reading) {
    return (
      <p className="text-sm text-forest-green/50 font-dm-sans">
        No drought data yet for this county.
      </p>
    )
  }
  const max = calcMaxCategory(reading)
  const levels: Array<{ key: keyof DroughtReading; pct: number }> = [
    { key: 'd0', pct: reading.d0 ?? 0 },
    { key: 'd1', pct: reading.d1 ?? 0 },
    { key: 'd2', pct: reading.d2 ?? 0 },
    { key: 'd3', pct: reading.d3 ?? 0 },
    { key: 'd4', pct: reading.d4 ?? 0 },
  ]
  return (
    <div className="space-y-4">
      {/* Current status badge */}
      <div>
        {max >= 0 ? (
          <div className="inline-flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: D_COLORS[max] }}
            />
            <span className="text-sm font-semibold text-forest-green font-dm-sans">
              D{max} {D_LABELS[max]}
            </span>
            <span className="text-xs text-forest-green/50 font-dm-sans">
              — current maximum · week of {formatDate(reading.week_date)}
            </span>
          </div>
        ) : (
          <p className="text-sm text-forest-green/60 font-dm-sans">
            No drought conditions — week of {formatDate(reading.week_date)}
          </p>
        )}
      </div>

      {/* Level breakdown */}
      <dl className="grid grid-cols-5 gap-2">
        {levels.map(({ key, pct }, i) => (
          <div key={key} className="rounded-lg bg-cream p-2 text-center">
            <div
              className="mx-auto mb-1 h-2 w-2 rounded-full ring-1 ring-forest-green/10"
              style={{ backgroundColor: D_COLORS[i] }}
            />
            <dt className="text-xs text-forest-green/50 font-dm-sans">D{i}</dt>
            <dd className="font-fraunces text-base font-semibold text-forest-green">
              {pct.toFixed(1)}
              <span className="text-xs font-normal text-forest-green/40">%</span>
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-forest-green/40 font-dm-sans">
        Source: U.S. Drought Monitor · Released Tuesdays
      </p>
    </div>
  )
}

function WeekPanel({
  nwsForecast,
  hasCoords,
}: {
  nwsForecast: LocalForecast | null
  hasCoords: boolean
}) {
  if (!hasCoords) {
    return (
      <div className="rounded-lg bg-cream p-4 text-xs text-forest-green/50 font-dm-sans">
        County coordinates not yet seeded.{' '}
        Run <code className="font-mono">npx tsx lib/seed-county-coords.ts</code> to enable NWS forecasts.
      </div>
    )
  }
  if (!nwsForecast) {
    return (
      <p className="text-sm text-forest-green/50 font-dm-sans">
        NWS forecast unavailable for this location.
      </p>
    )
  }

  const daytimePeriods = nwsForecast.periods.filter(p => p.isDaytime).slice(0, 7)

  return (
    <div className="space-y-3">
      <ForecastBadge />
      <p className="text-xs text-forest-green/40 font-dm-sans">
        NWS 7-day forecast · Updated{' '}
        {new Date(nwsForecast.updateTime).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
        })} ·{' '}
        <a href={nwsForecast.forecastUrl} target="_blank" rel="noopener noreferrer" className="underline">
          Source
        </a>
      </p>

      {/* Scrollable row on mobile, grid on sm+ */}
      <div className="-mx-1 flex gap-2 overflow-x-auto pb-2 sm:mx-0 sm:grid sm:grid-cols-7 sm:overflow-visible sm:pb-0">
        {daytimePeriods.map(period => (
          <div
            key={period.name}
            className="min-w-[80px] shrink-0 rounded-lg border border-forest-green/10 bg-cream p-2.5 text-center sm:min-w-0"
          >
            <p className="text-xs font-semibold text-forest-green font-dm-sans leading-tight">
              {period.name}
            </p>
            <p className="mt-1 font-fraunces text-xl font-semibold text-forest-green">
              {period.temperature}
              <span className="text-sm font-normal text-forest-green/50">°{period.temperatureUnit}</span>
            </p>
            <p className="mt-1 text-xs text-forest-green/60 font-dm-sans leading-tight">
              {period.shortForecast}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function OutlookPanel({
  outlook,
  map,
  mapTitle,
}: {
  outlook: ForecastOutlook | null
  map: OfficialMapRecord | null
  mapTitle: string
}) {
  return (
    <div className="space-y-4">
      <ForecastBadge />

      {outlook ? (
        <div>
          <p className="text-sm text-forest-green font-dm-sans leading-relaxed">
            {outlook.outlook_text}
          </p>
          <p className="mt-2 text-xs text-forest-green/40 font-dm-sans">
            CPC outlook · Released {formatDate(outlook.release_date)}
            {outlook.valid_through ? ` · Valid through ${formatDate(outlook.valid_through)}` : ''}
          </p>
        </div>
      ) : (
        <p className="text-sm text-forest-green/40 font-dm-sans">
          CPC outlook not yet available for this county.
        </p>
      )}

      <MapBlock map={map} title={mapTitle} />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ForecastSection({
  countyName,
  latestReading,
  nwsForecast,
  monthlyOutlook,
  seasonalOutlook,
  cpcMonthlyMap,
  cpcSeasonalMap,
  hasCoords,
}: Props) {
  const [active, setActive] = useState<Tab>('Now')

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <h2 className="font-fraunces text-base font-semibold text-forest-green">
          Conditions &amp; Outlook — {countyName}
        </h2>
      </div>

      {/* Tab bar — scrollable on mobile */}
      <div className="border-b border-forest-green/10 overflow-x-auto">
        <div className="flex min-w-max">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActive(tab)}
              className={[
                'px-4 py-2.5 text-sm font-medium font-dm-sans whitespace-nowrap transition-colors',
                active === tab
                  ? 'border-b-2 border-forest-green text-forest-green'
                  : 'text-forest-green/50 hover:text-forest-green/80',
              ].join(' ')}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Panels — instant show/hide, no animation */}
      <div className="p-4 sm:p-6">
        {active === 'Now' && <NowPanel reading={latestReading} />}
        {active === 'Week' && <WeekPanel nwsForecast={nwsForecast} hasCoords={hasCoords} />}
        {active === 'Month' && (
          <OutlookPanel
            outlook={monthlyOutlook}
            map={cpcMonthlyMap}
            mapTitle="CPC Monthly Drought Outlook"
          />
        )}
        {active === 'Season' && (
          <OutlookPanel
            outlook={seasonalOutlook}
            map={cpcSeasonalMap}
            mapTitle="CPC Seasonal Drought Outlook"
          />
        )}
      </div>
    </div>
  )
}
