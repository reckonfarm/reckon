'use client'

import { useState } from 'react'
import TabBar from './TabBar'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { NwsDiscussion } from '@/lib/nws-discussion'
import type { PrecipNormalData } from '@/lib/precip-normal'

interface Props {
  nwsDiscussion: NwsDiscussion | null
  wpcUpdated: string | null
  day814Updated: string | null
  weeks34Updated: string | null
  monthlyUpdated: string | null
  seasonalUpdated: string | null
}

const TABS = [
  'Local Discussion',
  '7-Day QPF',
  '8-14 Day',
  'Weeks 3-4',
  'Monthly',
  'Seasonal',
] as const
type Tab = (typeof TABS)[number]

function ForecastBadge() {
  return (
    <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 font-dm-sans">
      Forecast — not a current observation
    </span>
  )
}

function LocalDiscussionPanel({ discussion }: { discussion: NwsDiscussion | null }) {
  const [expanded, setExpanded] = useState(false)

  if (!discussion) {
    return (
      <p className="text-sm text-forest-green/50 font-dm-sans">
        Local forecast discussion temporarily unavailable. Visit{' '}
        <a href="https://www.weather.gov" target="_blank" rel="noopener noreferrer" className="underline">
          weather.gov
        </a>{' '}
        for your local forecast.
      </p>
    )
  }

  const paragraphs = discussion.discussionText
    .split('\n\n')
    .map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const fullText = paragraphs.join(' ')
  const previewMatch = fullText.match(/^((?:[^.!?]+[.!?]+){1,2})/)
  const preview = previewMatch ? previewMatch[1].trim() : fullText.slice(0, 300)

  const issued = new Date(discussion.issuanceTime).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  })

  return (
    <div className="space-y-4">
      <ForecastBadge />
      <div className="space-y-3">
        {expanded ? (
          paragraphs.map((p, i) => (
            <p key={i} className="text-sm text-forest-green font-dm-sans leading-relaxed">
              {p}
            </p>
          ))
        ) : (
          <p className="text-sm text-forest-green font-dm-sans leading-relaxed">
            {preview}
          </p>
        )}
      </div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="text-xs font-dm-sans text-forest-green/50 hover:text-forest-green transition-colors"
      >
        {expanded ? 'Collapse ↑' : 'Read full discussion ↓'}
      </button>
      <div className="border-t border-forest-green/10 pt-3">
        <p className="text-xs text-forest-green/50 font-dm-sans">
          NWS Area Forecast Discussion · {discussion.wfo} · Issued {issued}
        </p>
      </div>
    </div>
  )
}

function PrecipTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number }>
  label?: string
}) {
  if (!active || !payload?.length || !label) return null
  const actual = payload.find(p => p.name === 'actualCumulative')
  const normal = payload.find(p => p.name === 'normalCumulative')
  const date = new Date(`${label}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
  return (
    <div className="rounded-lg border border-forest-green/10 bg-white px-3 py-2 shadow-md text-xs font-dm-sans">
      <p className="font-semibold text-forest-green mb-1">{date}</p>
      {actual && <p className="text-forest-green">Actual: {actual.value.toFixed(2)}&quot;</p>}
      {normal && <p className="text-forest-green/50">Normal: {normal.value.toFixed(2)}&quot;</p>}
    </div>
  )
}

export function PrecipVsNormalPanel({ data }: { data: PrecipNormalData | null }) {
  if (!data) {
    return (
      <p className="text-sm text-forest-green/50 font-dm-sans">
        No precipitation station data available for this county. Sparse rural counties may not have
        nearby COOP weather stations in the NOAA network.
      </p>
    )
  }

  const { dailyData, ytdActual, ytdNormal, deficit, deficitPct, stationName, distanceMiles, dataThrough } = data
  const isDeficit = deficit < 0

  const monthTicks = dailyData
    .filter(d => d.date.endsWith('-01'))
    .map(d => d.date)

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            ticks={monthTicks}
            tickFormatter={(d: string) =>
              new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short' })
            }
            tick={{ fontSize: 10, fill: '#1B4332', fillOpacity: 0.5 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => `${v.toFixed(0)}"`}
            tick={{ fontSize: 10, fill: '#1B4332', fillOpacity: 0.5 }}
            tickLine={false}
            axisLine={false}
            width={32}
            domain={[0, 'auto']}
          />
          <ReferenceLine y={0} stroke="rgba(27,67,50,0.12)" strokeWidth={1} />
          <Tooltip
            content={<PrecipTooltip />}
            cursor={{ fill: 'rgba(27,67,50,0.06)' }}
          />
          <Line
            type="monotone"
            dataKey="normalCumulative"
            stroke="#1B4332"
            strokeOpacity={0.35}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="actualCumulative"
            stroke="#1B4332"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-3 gap-4 pt-1">
        <div>
          <p className="text-2xl font-fraunces font-semibold text-forest-green">
            {ytdActual.toFixed(2)}&quot;
          </p>
          <p className="text-xs text-forest-green/50 font-dm-sans mt-0.5">YTD Actual</p>
        </div>
        <div>
          <p className="text-2xl font-fraunces font-semibold text-forest-green/60">
            {ytdNormal.toFixed(2)}&quot;
          </p>
          <p className="text-xs text-forest-green/50 font-dm-sans mt-0.5">YTD Normal</p>
        </div>
        <div>
          <p className={`text-2xl font-fraunces font-semibold ${isDeficit ? 'text-red-600' : 'text-forest-green'}`}>
            {deficit >= 0 ? '+' : ''}{deficit.toFixed(2)}&quot;
          </p>
          <p className="text-xs text-forest-green/50 font-dm-sans mt-0.5">
            {isDeficit ? 'Deficit' : 'Surplus'} ({Math.abs(deficitPct).toFixed(0)}%)
          </p>
        </div>
      </div>

      {dataThrough && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 font-dm-sans">
          Data unavailable after{' '}
          {new Date(`${dataThrough}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}{' '}
          — station offline.
        </p>
      )}
      <p className="text-xs text-forest-green/40 font-dm-sans">
        Station: {stationName}
        {distanceMiles > 0 ? ` (${distanceMiles} miles from county center)` : ''}{' '}
        · NOAA/ACIS · 1991–2020 normals (NOAA)
      </p>
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
      <ForecastBadge />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={alt} className="w-full rounded-lg" loading="lazy" />
      <p className="text-xs text-forest-green/50 font-dm-sans">
        {label}
        {lastModified ? ` · Updated ${lastModified}` : ''}{' '}·{' '}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
          Source: NOAA/CPC
        </a>
      </p>
    </div>
  )
}

export default function PrecipForecastSection({
  nwsDiscussion,
  wpcUpdated,
  day814Updated,
  weeks34Updated,
  monthlyUpdated,
  seasonalUpdated,
}: Props) {
  const [active, setActive] = useState<Tab>('8-14 Day')

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-sm">
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <h2 className="font-fraunces text-base font-semibold text-forest-green">
          Rainfall Outlook
        </h2>
      </div>

      <TabBar
        tabs={TABS.map(t => ({ id: t, label: t }))}
        activeTab={active}
        onChange={id => setActive(id as Tab)}
      />

      <div className="p-4 sm:p-6">
        {active === 'Local Discussion' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Official forecast discussion from your local National Weather Service office.</p>
            <LocalDiscussionPanel discussion={nwsDiscussion} />
          </>
        )}
        {active === '7-Day QPF' && (
          <div className="space-y-3">
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Quantitative precipitation forecast showing expected rainfall totals over the next 7 days.</p>
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
        )}
        {active === '8-14 Day' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Probability of above or below normal precipitation over the next 8–14 days.</p>
            <CpcMapPanel
              imageUrl="https://www.cpc.ncep.noaa.gov/products/predictions/814day/814prcp.new.gif"
              alt="CPC 8-14 Day Precipitation Outlook"
              label="CPC 8-14 Day Precipitation Outlook"
              sourceUrl="https://www.cpc.ncep.noaa.gov/products/predictions/814day/"
              lastModified={day814Updated}
            />
          </>
        )}
        {active === 'Weeks 3-4' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Extended precipitation probability outlook for weeks 3 and 4.</p>
            <CpcMapPanel
              imageUrl="https://www.cpc.ncep.noaa.gov/products/predictions/WK34/gifs/WK34prcp.gif"
              alt="CPC Weeks 3-4 Precipitation Outlook"
              label="CPC Weeks 3-4 Precipitation Outlook"
              sourceUrl="https://www.cpc.ncep.noaa.gov/products/predictions/WK34/"
              lastModified={weeks34Updated}
            />
          </>
        )}
        {active === 'Monthly' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Monthly precipitation outlook from NOAA&apos;s Climate Prediction Center.</p>
            <CpcMapPanel
              imageUrl="https://www.cpc.ncep.noaa.gov/products/predictions/30day/off14_prcp.gif"
              alt="CPC Monthly Precipitation Outlook"
              label="CPC Monthly Precipitation Outlook"
              sourceUrl="https://www.cpc.ncep.noaa.gov/products/predictions/30day/"
              lastModified={monthlyUpdated}
            />
          </>
        )}
        {active === 'Seasonal' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Seasonal precipitation outlook covering the next 3 months from NOAA&apos;s Climate Prediction Center.</p>
            <CpcMapPanel
              imageUrl="https://www.cpc.ncep.noaa.gov/products/predictions/long_range/lead01/off01_prcp.gif"
              alt="CPC Seasonal Precipitation Outlook"
              label="CPC Seasonal Precipitation Outlook"
              sourceUrl="https://www.cpc.ncep.noaa.gov/products/predictions/long_range/seasonal.php?lead=1"
              lastModified={seasonalUpdated}
            />
          </>
        )}
      </div>
    </div>
  )
}
