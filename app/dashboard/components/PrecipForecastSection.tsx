'use client'

import { useState } from 'react'
import TabBar from './TabBar'
import MapLightbox from './MapLightbox'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { NwsDiscussion } from '@/lib/nws-discussion'
import type { PrecipNormalResult } from '@/lib/precip-normal'

interface Props {
  nwsDiscussion: NwsDiscussion | null
  wpcUpdated: string | null
  day814Updated: string | null
  weeks34Updated: string | null
  monthlyUpdated: string | null
  seasonalUpdated: string | null
  // When embedded in an accordion that already supplies the title, skip the
  // component's own "Rainfall Outlook" header to avoid a duplicate heading.
  hideHeader?: boolean
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

// Water-blue rain-event accent (two weights) — blue reads instantly as rain and pops
// against the forest-green data lines without fighting them. Light = good rain, saturated
// = great rain. Shared by the tooltip readout and the Scatter markers below.
const RAIN_GOOD  = '#60A5FA'   // 0.5–1.0" in a day
const RAIN_GREAT = '#2563EB'   // ≥ 1.0" in a day

function PrecipTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; payload?: {
    dayRain?: number | null
    tier?: number
    nearestRain?: { date: string; amount: number; tier: number; dir: 'same' | 'past' | 'future' } | null
  } }>
  label?: string
}) {
  if (!active || !payload?.length || !label) return null
  const actual = payload.find(p => p.name === 'actualCumulative')
  const normal = payload.find(p => p.name === 'normalCumulative')
  // Every payload entry shares the same source datum, so read the per-day rain off the first.
  const datum  = payload[0]?.payload
  const tier   = datum?.tier ?? 0
  const dayRain = datum?.dayRain
  const nearest = datum?.nearestRain
  const fmtShort = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const date = new Date(`${label}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
  return (
    <div className="rounded-lg border border-forest-green/10 bg-white px-3 py-2 shadow-md text-xs font-dm-sans">
      <p className="font-semibold text-forest-green mb-1">{date}</p>
      {actual && <p className="text-forest-green">Actual: {actual.value.toFixed(2)}&quot;</p>}
      {normal && <p className="text-forest-green/50">Normal: {normal.value.toFixed(2)}&quot;</p>}
      {/* Rain context follows the scrub: an event day shows "Rain that day"; a dry day
          shows the NEAREST event ("Last rain" before it, "Next rain" if ahead of the first). */}
      {tier > 0 && dayRain != null ? (
        <p className="mt-1 font-semibold" style={{ color: tier === 2 ? RAIN_GREAT : RAIN_GOOD }}>
          Rain that day: {dayRain.toFixed(2)}&quot;
        </p>
      ) : nearest ? (
        <p className="mt-1 font-medium" style={{ color: nearest.tier === 2 ? RAIN_GREAT : RAIN_GOOD }}>
          {nearest.dir === 'future' ? 'Next rain' : 'Last rain'}: {fmtShort(nearest.date)} · {nearest.amount.toFixed(2)}&quot;
        </p>
      ) : null}
    </div>
  )
}

// Custom Scatter shape: a water-blue marker on notable single-day rain. Returns nothing for
// non-event days (tier 0), a subtle HOLLOW dot for good rain (tier 1), and a fuller SATURATED
// dot for great rain (tier 2) so great rains pop. Anchored a few px above the baseline (cy)
// so it rides the bottom of the plot as a clean "rain rug", clear of the axis labels.
function RainMarker(props: { cx?: number; cy?: number; payload?: { tier?: number } }) {
  const { cx, cy, payload } = props
  const tier = payload?.tier ?? 0
  if (!tier || cx == null || cy == null) return null
  const y = cy - 5
  return tier === 2
    ? <circle cx={cx} cy={y} r={5}   fill={RAIN_GREAT} stroke="#fff" strokeWidth={1} />
    : <circle cx={cx} cy={y} r={3.5} fill="#fff"       stroke={RAIN_GOOD} strokeWidth={1.5} />
}

export function PrecipVsNormalPanel({ data, countyName }: { data: PrecipNormalResult; countyName?: string }) {
  if (data == null) {
    return (
      <p className="text-sm text-forest-green/50 font-dm-sans">
        No precipitation station data available for this county. Sparse rural counties may not have
        nearby COOP weather stations in the NOAA network.
      </p>
    )
  }

  // Availability failure (ACIS unreachable / blocked / errored) — NOT data absence.
  // Never let an outage masquerade as "no nearby weather station has enough history."
  if (data === 'data_unavailable') {
    return (
      <p className="text-sm text-forest-green/50 font-dm-sans">
        Precipitation data is temporarily unavailable — check back shortly.
      </p>
    )
  }

  // Defense in depth: never render a deficit/surplus or claim 30-year normals when
  // no station with usable normals + enough history exists, or normals are zero.
  if (data === 'no_qualifying_station' || data.ytdNormal === 0) {
    return (
      <p className="text-sm text-forest-green/50 font-dm-sans">
        No nearby weather station has enough reporting history this year to compare against its
        30-year normal. We&apos;d rather show nothing than a misleading total.
      </p>
    )
  }

  const { dailyData, ytdActual, ytdNormal, deficit, deficitPct, source, label, distanceMiles, context, outOfCounty } = data
  const isDeficit = deficit < 0

  // Per-day rainfall for the event markers — derived from the cumulative series (NO new
  // fetch). dayRain = today's cumulative − yesterday's, but ONLY when the two points are
  // exactly one calendar day apart; a date gap means we can't attribute the delta to a
  // single day, so we skip it (never collapse a multi-day span onto one marker). Missing
  // days don't accumulate (cum stays flat), so a gap reads as 0, never a false spike.
  // tier: 2 = great rain (≥1.0"), 1 = good rain (0.5–1.0"), 0 = none. markerY=0 anchors the
  // Scatter to the baseline; RainMarker draws just above it.
  // NOTE (future enhancement): ACIS can report a multi-day total on ONE date via the 'A'
  // (accumulated) flag, which we don't fetch — such a day could over-read here. Out of
  // scope now; add the 'a' flag to the precip fetch (lib/precip-normal.ts) and skip flagged
  // days to harden this. Markers are notable-rain HINTS, not an authoritative daily record.
  const ONE_DAY_MS = 86_400_000
  const tierFor = (mm: number) => (mm >= 1 ? 2 : mm >= 0.5 ? 1 : 0)
  const markerData = dailyData.map((d, i) => {
    if (i === 0) {
      const dayRain = d.actualCumulative   // cum starts at 0, so day 0's cum IS its own daily total
      return { ...d, dayRain, tier: tierFor(dayRain), markerY: 0 }
    }
    const prev = dailyData[i - 1]
    const gapDays = Math.round(
      (Date.parse(`${d.date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`)) / ONE_DAY_MS,
    )
    if (gapDays !== 1) return { ...d, dayRain: null, tier: 0, markerY: 0 }   // gap → can't trust the diff
    const dayRain = d.actualCumulative - prev.actualCumulative
    return { ...d, dayRain, tier: tierFor(dayRain), markerY: 0 }
  })

  // Nearest notable-rain event to each point, so dragging onto a DRY day still surfaces the
  // closest rain ("Last rain …" before it, "Next rain …" if you're ahead of the first one)
  // instead of going blank. Pure derivation off markerData — no new fetch — and it rides
  // along in each datum so the tooltip reads it straight off the active point's payload.
  // Ties (equidistant past/future) resolve to the PAST event (events are chronological, so
  // the strict `<` keeps the earlier one) — "Last rain" is the more useful read.
  const events = markerData
    .filter(d => d.tier > 0 && d.dayRain != null)
    .map(d => ({ date: d.date, amount: d.dayRain as number, tier: d.tier, ms: Date.parse(`${d.date}T00:00:00Z`) }))
  const chartData = markerData.map(d => {
    if (events.length === 0) return { ...d, nearestRain: null }
    const ms = Date.parse(`${d.date}T00:00:00Z`)
    let best = events[0]
    for (const e of events) if (Math.abs(e.ms - ms) < Math.abs(best.ms - ms)) best = e
    const dir: 'same' | 'past' | 'future' = best.date === d.date ? 'same' : best.ms < ms ? 'past' : 'future'
    return { ...d, nearestRain: { date: best.date, amount: best.amount, tier: best.tier, dir } }
  })

  const monthTicks = dailyData
    .filter(d => d.date.endsWith('-01'))
    .map(d => d.date)

  const fmtDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const throughDate = dailyData[dailyData.length - 1]?.date ?? null

  return (
    <div className="space-y-4">
      {/* touch-action: pan-y → a vertical drag still scrolls the page, but a HORIZONTAL
          drag is left to Recharts to scrub the tooltip (the chart wins the scrub gesture
          without trapping page scroll — the mobile gotcha). */}
      <div style={{ touchAction: 'pan-y' }}>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
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
            // Initialize the readout on the latest/rightmost point so the rancher opens on
            // "where we are now," then can drag back. Any touch/drag overrides it.
            defaultIndex={chartData.length - 1}
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
          {/* Two-tier rain-event markers (water-blue). RainMarker draws nothing for non-event
              days, so this rides the baseline as a clean "rain rug" without touching the lines. */}
          <Scatter dataKey="markerY" shape={<RainMarker />} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      </div>

      {/* Visible freshness label — tells a rancher who just got rain whether it's
          in the window yet. Station data lags a couple days; this is the honest
          "current as of" so the chart never looks wrong, just current-as-of-a-date. */}
      {throughDate && (
        <p className="-mt-2 flex items-center justify-center gap-1.5 text-xs font-dm-sans font-medium text-forest-green/60">
          <svg className="h-3.5 w-3.5 text-forest-green/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Data through {fmtDate(throughDate)}
        </p>
      )}

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

      {/* Honest source label. Station mode is authoritative (its own gauge + own
          normal); grid mode is a clearly-labeled modeled estimate, never a gauge. */}
      {source === 'grid' ? (
        <>
          <p className="text-xs text-forest-green/40 font-dm-sans">
            PRISM county estimate{throughDate ? ` · current through ${fmtDate(throughDate)}` : ''}
            {' '}· no current NOAA station
            {context ? ` · normal from ${context.name}` : ''}{' '}
            · 1991–2020 (NOAA)
          </p>
          {context && (
            <p className="text-xs text-forest-green/40 font-dm-sans">
              Nearest full station: {context.name}
              {context.distanceMiles > 0 ? ` (${context.distanceMiles} mi)` : ''}
              {context.lastValid ? ` — last reported ${fmtDate(context.lastValid)}` : ''}
            </p>
          )}
        </>
      ) : outOfCounty ? (
        /* Out-of-county gauge: make the "outside the county" fact explicit, not just a mileage.
           Don't double "County" — some county names already include the word. */
        <p className="text-xs text-forest-green/40 font-dm-sans">
          Station: {label} — nearest current gauge, outside {
            countyName
              ? /\bcounty$/i.test(countyName.trim()) ? countyName.trim() : `${countyName.trim()} County`
              : 'the county'
          }
          {distanceMiles > 0 ? ` (${distanceMiles} mi)` : ''}
          {throughDate ? ` · through ${fmtDate(throughDate)}` : ''}{' '}
          · NOAA/ACIS · 1991–2020 normals (NOAA)
        </p>
      ) : (
        <p className="text-xs text-forest-green/40 font-dm-sans">
          Station: {label}
          {distanceMiles > 0 ? ` (${distanceMiles} miles from county center)` : ''}
          {throughDate ? ` · through ${fmtDate(throughDate)}` : ''}{' '}
          · NOAA/ACIS · 1991–2020 normals (NOAA)
        </p>
      )}
    </div>
  )
}

function CpcMapPanel({
  imageUrl,
  alt,
  label,
  sourceUrl,
  lastModified,
  sourceName = 'NOAA/CPC',
}: {
  imageUrl: string
  alt: string
  label: string
  sourceUrl: string
  lastModified: string | null
  sourceName?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-3">
      <ForecastBadge />
      <div className="group relative cursor-pointer overflow-hidden rounded-lg" onClick={() => setOpen(true)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={alt} className="w-full rounded-lg transition-opacity group-hover:opacity-90" loading="lazy" />
        <span className="absolute bottom-2 right-2 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          Tap to enlarge
        </span>
      </div>
      <MapLightbox open={open} onClose={() => setOpen(false)} src={imageUrl} alt={alt} />
      <p className="text-xs text-forest-green/50 font-dm-sans">
        {label}
        {lastModified ? ` · Updated ${lastModified}` : ''}{' '}·{' '}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
          Source: {sourceName}
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
  hideHeader = false,
}: Props) {
  // Default to the FIRST tab in the defined order (the local discussion), not a map.
  const [active, setActive] = useState<Tab>(TABS[0])

  return (
    <Card className="overflow-hidden">
      {!hideHeader && (
        <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
          <Heading level={5}>
            Rainfall Outlook
          </Heading>
        </div>
      )}

      <TabBar
        tabs={TABS.map(t => ({ id: t, label: t }))}
        activeTab={active}
        onChange={id => setActive(id as Tab)}
      />

      {/* key={active} → each tab's panel mounts fresh, so a switched-to map never
          inherits/repaints the previously shown map's <img> (no flicker-back). */}
      <div className="p-4 sm:p-6" key={active}>
        {active === 'Local Discussion' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Official forecast discussion from your local National Weather Service office.</p>
            <LocalDiscussionPanel discussion={nwsDiscussion} />
          </>
        )}
        {active === '7-Day QPF' && (
          <>
            <p className="mb-3 text-xs text-forest-green/50 font-dm-sans">Quantitative precipitation forecast showing expected rainfall totals over the next 7 days.</p>
            <CpcMapPanel
              imageUrl="https://www.wpc.ncep.noaa.gov/qpf/p168i.gif"
              alt="WPC 7-Day Accumulated Precipitation Forecast"
              label="WPC 7-Day Accumulated Precipitation Forecast"
              sourceUrl="https://www.wpc.ncep.noaa.gov/qpf/"
              sourceName="NOAA/WPC"
              lastModified={wpcUpdated}
            />
          </>
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
    </Card>
  )
}
