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

export interface DroughtDiscussion {
  author: string
  affiliation: string
  intro: string
  regionText: string
  regionName: string
  releaseDate: string
}

interface Props {
  countyName: string
  stateAbbr: string
  droughtDiscussion: DroughtDiscussion | null
  wpcUpdated: string | null
  monthlyOutlook: ForecastOutlook | null
  seasonalOutlook: ForecastOutlook | null
  cpcMonthlyMap: OfficialMapRecord | null
  cpcSeasonalMap: OfficialMapRecord | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = ['Now', 'Week', 'Month', 'Season'] as const
type Tab = typeof TABS[number]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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

function NowPanel({ discussion }: { discussion: DroughtDiscussion | null }) {
  if (!discussion) {
    return (
      <p className="text-sm text-forest-green/50 font-dm-sans">
        Drought discussion unavailable.
      </p>
    )
  }

  const introParagraphs = discussion.intro.split('\n\n').filter(Boolean)
  const regionParagraphs = discussion.regionText.split('\n\n').filter(Boolean)

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {introParagraphs.map((p, i) => (
          <p key={i} className="text-sm text-forest-green font-dm-sans leading-relaxed">
            {p}
          </p>
        ))}
      </div>

      {regionParagraphs.length > 0 && (
        <div className="space-y-3 border-t border-forest-green/10 pt-4">
          <p className="text-xs font-semibold text-forest-green/50 font-dm-sans uppercase tracking-wide">
            {discussion.regionName}
          </p>
          {regionParagraphs.map((p, i) => (
            <p key={i} className="text-sm text-forest-green font-dm-sans leading-relaxed">
              {p}
            </p>
          ))}
        </div>
      )}

      <div className="border-t border-forest-green/10 pt-3 space-y-1">
        <p className="text-sm text-forest-green/60 font-dm-sans">
          — {discussion.author}, {discussion.affiliation}
        </p>
        <p className="text-xs text-forest-green/40 font-dm-sans">
          U.S. Drought Monitor · Released {discussion.releaseDate}
        </p>
      </div>
    </div>
  )
}

function WeekPanel({ wpcUpdated }: { wpcUpdated: string | null }) {
  return (
    <div className="space-y-3">
      <ForecastBadge />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="https://www.wpc.ncep.noaa.gov/qpf/p168i.gif"
        alt="WPC 7-Day Accumulated Precipitation Forecast"
        className="w-full rounded-lg"
        loading="lazy"
      />
      <p className="text-xs text-forest-green/50 font-dm-sans">
        WPC 7-Day Accumulated Precipitation Forecast
        {wpcUpdated ? ` · Updated ${wpcUpdated}` : ''}{' '}·{' '}
        <a
          href="https://www.wpc.ncep.noaa.gov/qpf/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Source: NOAA/WPC
        </a>
      </p>
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
  droughtDiscussion,
  wpcUpdated,
  monthlyOutlook,
  seasonalOutlook,
  cpcMonthlyMap,
  cpcSeasonalMap,
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
        {active === 'Now' && <NowPanel discussion={droughtDiscussion} />}
        {active === 'Week' && <WeekPanel wpcUpdated={wpcUpdated} />}
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
