'use client'

import { useState } from 'react'
import TabBar from './TabBar'

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
  stateAbbr: string
  droughtDiscussion: DroughtDiscussion | null
  cpcSoilMoistureUpdated: string | null
  vhiUpdated: string | null
  hprcc14dUpdated: string | null
  hprcc30dUpdated: string | null
  hprcc60dUpdated: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = ['Now', 'Soil Moisture', 'Vegetation', '14-Day Precip', '30-Day Precip', '60-Day Precip'] as const
type Tab = typeof TABS[number]

// ─── Helpers ──────────────────────────────────────────────────────────────────

// HPRCC publishes state-level precip maps at the same path with state abbr instead of "US"
// e.g. 14dPNormMT.png — fall back to national if state map fails to load
function hprccStateUrl(period: '14d' | '30d' | '60d', state: string): string {
  return `https://hprcc.unl.edu/products/maps/acis/${period}PNorm${state}.png`
}
function hprccNationalUrl(period: '14d' | '30d' | '60d'): string {
  return `https://hprcc.unl.edu/products/maps/acis/${period}PNormUS.png`
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────


// ─── Tab panels ───────────────────────────────────────────────────────────────

// TODO Sprint 5: Replace intro display with Claude-generated plain-language summary stored on drought_data per-county-week
function NowPanel({ discussion }: { discussion: DroughtDiscussion | null }) {
  const [expanded, setExpanded] = useState(false)

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
      {regionParagraphs.length > 0 && (
        <div className="space-y-3 border-t border-forest-green/10 pt-4">
          <p className="text-xs font-semibold text-forest-green/50 font-dm-sans uppercase tracking-wide">
            {discussion.regionName}
          </p>

          {/* Teaser: first paragraph with left border accent */}
          <div className="border-l-2 border-forest-green/20 pl-3">
            <p className="text-sm text-forest-green font-dm-sans leading-relaxed">
              {regionParagraphs[0].length > 240
                ? regionParagraphs[0].slice(0, 240).replace(/\s\S+$/, '') + '…'
                : regionParagraphs[0]}
            </p>
          </div>

          {/* Expanded: all region paragraphs */}
          {expanded && (
            <div className="space-y-3">
              {regionParagraphs.map((p, i) => (
                <p key={i} className="text-sm text-forest-green font-dm-sans leading-relaxed">
                  {p}
                </p>
              ))}
            </div>
          )}

          {/* Expanded: national intro */}
          {expanded && introParagraphs.length > 0 && (
            <div className="mt-2 space-y-3 border-t border-forest-green/10 pt-3">
              <p className="text-xs font-semibold text-forest-green/50 font-dm-sans uppercase tracking-wide">
                National summary
              </p>
              {introParagraphs.map((p, i) => (
                <p key={i} className="text-sm text-forest-green/70 font-dm-sans leading-relaxed">
                  {p}
                </p>
              ))}
            </div>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 font-dm-sans text-xs text-forest-green/50 underline hover:text-forest-green transition-colors"
          >
            {expanded ? 'Collapse summary ↑' : 'Read full drought summary →'}
          </button>
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
  fallbackUrl,
  alt,
  label,
  sourceUrl,
  lastModified,
}: {
  imageUrl: string
  fallbackUrl?: string
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
      <img
        src={imageUrl}
        alt={alt}
        className="w-full rounded-lg"
        loading="lazy"
        onError={fallbackUrl ? (e) => {
          const img = e.currentTarget
          if (img.src !== fallbackUrl) img.src = fallbackUrl
        } : undefined}
      />
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
  stateAbbr,
  droughtDiscussion,
  cpcSoilMoistureUpdated,
  vhiUpdated,
  hprcc14dUpdated,
  hprcc30dUpdated,
  hprcc60dUpdated,
}: Props) {
  const [active, setActive] = useState<Tab>('Now')
  const droughtWeekEnding = droughtDiscussion?.releaseDate
    ? new Date(droughtDiscussion.releaseDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'this week'

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <h2 className="font-fraunces text-base font-semibold text-forest-green">
          Drought Indicators
        </h2>
      </div>

      <TabBar
        tabs={TABS.map(t => ({ id: t, label: t }))}
        activeTab={active}
        onChange={id => setActive(id as Tab)}
      />

      {/* Panels — instant show/hide, no animation */}
      <div className="p-4 sm:p-6">
        {active === 'Now' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">{`Summary of drought conditions across the US for the week ending ${droughtWeekEnding}. Produced by NOAA’s National Drought Mitigation Center.`}</p>
            <NowPanel discussion={droughtDiscussion} />
          </>
        )}
        {active === 'Soil Moisture' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Daily soil moisture departure from normal across the contiguous US. Red indicates drier than average conditions.</p>
            <CpcMapPanel
              imageUrl="https://www.cpc.ncep.noaa.gov/products/Soilmst_Monitoring/Figures/daily/curr.w.anom.daily.gif"
              alt="NOAA/CPC Daily Soil Moisture Anomaly"
              label="NOAA/CPC Soil Moisture Anomaly · Daily"
              sourceUrl="https://www.cpc.ncep.noaa.gov/products/Soilmst_Monitoring/"
              lastModified={cpcSoilMoistureUpdated}
            />
          </>
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
            <>
              <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Weekly vegetation health index derived from satellite data. Low values indicate stressed or drought-affected vegetation.</p>
              <CpcMapPanel
                imageUrl={vhiUrl}
                alt="NOAA STAR Vegetation Health Index — CONUS"
                label="NOAA STAR VHI · Vegetation Health Index by Climate Division · Updated weekly"
                sourceUrl="https://www.star.nesdis.noaa.gov/smcd/emb/vci/VH/vh_browse.php"
                lastModified={vhiUpdated}
              />
            </>
          )
        })()}
        {active === '14-Day Precip' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Precipitation received over the past 14 days as a percent of the 1991–2020 average. Below 75% indicates notable deficit.</p>
            <CpcMapPanel
              imageUrl={hprccStateUrl('14d', stateAbbr)}
              fallbackUrl={hprccNationalUrl('14d')}
              alt={`14-Day Percent of Normal Precipitation — ${stateAbbr}`}
              label={`HPRCC/ACIS · Percent of Normal Precipitation · Past 14 Days · ${stateAbbr} · 1991–2020 normals`}
              sourceUrl="https://hprcc.unl.edu/maps.php?map=ACISClimateMaps"
              lastModified={hprcc14dUpdated}
            />
          </>
        )}
        {active === '30-Day Precip' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Precipitation received over the past 30 days as a percent of the 1991–2020 average. Below 75% indicates notable deficit.</p>
            <CpcMapPanel
              imageUrl={hprccStateUrl('30d', stateAbbr)}
              fallbackUrl={hprccNationalUrl('30d')}
              alt={`30-Day Percent of Normal Precipitation — ${stateAbbr}`}
              label={`HPRCC/ACIS · Percent of Normal Precipitation · Past 30 Days · ${stateAbbr} · 1991–2020 normals`}
              sourceUrl="https://hprcc.unl.edu/maps.php?map=ACISClimateMaps"
              lastModified={hprcc30dUpdated}
            />
          </>
        )}
        {active === '60-Day Precip' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Precipitation received over the past 60 days as a percent of the 1991–2020 average. Below 75% indicates notable deficit.</p>
            <CpcMapPanel
              imageUrl={hprccStateUrl('60d', stateAbbr)}
              fallbackUrl={hprccNationalUrl('60d')}
              alt={`60-Day Percent of Normal Precipitation — ${stateAbbr}`}
              label={`HPRCC/ACIS · Percent of Normal Precipitation · Past 60 Days · ${stateAbbr} · 1991–2020 normals`}
              sourceUrl="https://hprcc.unl.edu/maps.php?map=ACISClimateMaps"
              lastModified={hprcc60dUpdated}
            />
          </>
        )}

      </div>
    </div>
  )
}
