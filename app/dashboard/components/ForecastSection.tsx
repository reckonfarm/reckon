'use client'

import { useState } from 'react'

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
  cpcSoilMoistureUpdated: string | null
  vhiUpdated: string | null
  hprcc30dUpdated: string | null
  hprcc60dUpdated: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = ['Now', 'Soil Moisture', 'Vegetation', '30-Day Precip', '60-Day Precip'] as const
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


function CpcMapPanel({
  imageUrl,
  alt,
  label,
  sourceUrl,
  lastModified,
}: {
  imageUrl: string
  alt: string
  label: string
  sourceUrl: string
  lastModified: string | null
}) {
  return (
    <div className="space-y-3">
      <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 font-dm-sans">
        Not a current observation
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={alt} className="w-full rounded-lg" loading="lazy" />
      <p className="text-xs text-forest-green/50 font-dm-sans">
        {label}
        {lastModified ? ` · Updated ${lastModified}` : ''}{' '}·{' '}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
          Source
        </a>
      </p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ForecastSection({
  countyName,
  droughtDiscussion,
  cpcSoilMoistureUpdated,
  vhiUpdated,
  hprcc30dUpdated,
  hprcc60dUpdated,
}: Props) {
  const [active, setActive] = useState<Tab>('Now')

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <h2 className="font-fraunces text-base font-semibold text-forest-green">
          Conditions — {countyName}
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
        {active === 'Soil Moisture' && (
          <CpcMapPanel
            imageUrl="https://www.cpc.ncep.noaa.gov/products/Soilmst_Monitoring/Figures/daily/curr.w.anom.daily.gif"
            alt="NOAA/CPC Daily Soil Moisture Anomaly"
            label="NOAA/CPC Soil Moisture Anomaly · Daily"
            sourceUrl="https://www.cpc.ncep.noaa.gov/products/Soilmst_Monitoring/"
            lastModified={cpcSoilMoistureUpdated}
          />
        )}
        {active === 'Vegetation' && (() => {
          const now = new Date()
          const year = now.getUTCFullYear()
          const startOfYear = new Date(Date.UTC(year, 0, 1))
          const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000) + 1
          const week = Math.ceil(dayOfYear / 7) - 1
          const week2d = String(week).padStart(2, '0')
          const vhiUrl = `https://www.star.nesdis.noaa.gov/smcd/emb/vci/WebDataVH/gvix_webImages/${year}/USA_VHI_DIVISION_${year}${week2d}.png`
          return (
            <CpcMapPanel
              imageUrl={vhiUrl}
              alt="NOAA STAR Vegetation Health Index — CONUS"
              label="NOAA STAR VHI · Vegetation Health Index by Climate Division · Updated weekly"
              sourceUrl="https://www.star.nesdis.noaa.gov/smcd/emb/vci/VH/vh_browse.php"
              lastModified={vhiUpdated}
            />
          )
        })()}
        {active === '30-Day Precip' && (
          <CpcMapPanel
            imageUrl="https://hprcc.unl.edu/products/maps/acis/30dPNormUS.png"
            alt="30-Day Percent of Normal Precipitation"
            label="HPRCC/ACIS · Percent of Normal Precipitation · Past 30 Days · 1991–2020 normals"
            sourceUrl="https://hprcc.unl.edu/maps.php?map=ACISClimateMaps"
            lastModified={hprcc30dUpdated}
          />
        )}
        {active === '60-Day Precip' && (
          <CpcMapPanel
            imageUrl="https://hprcc.unl.edu/products/maps/acis/60dPNormUS.png"
            alt="60-Day Percent of Normal Precipitation"
            label="HPRCC/ACIS · Percent of Normal Precipitation · Past 60 Days · 1991–2020 normals"
            sourceUrl="https://hprcc.unl.edu/maps.php?map=ACISClimateMaps"
            lastModified={hprcc60dUpdated}
          />
        )}
      </div>
    </div>
  )
}
