'use client'

import { Heading } from '@/app/components/ui/Heading'
import {
  ComposedChart,
  Bar,
  Cell,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DroughtReading {
  week_date: string
  d0: number | null
  d1: number | null
  d2: number | null
  d3: number | null
  d4: number | null
}

interface ChartDatum {
  week: string         // "May 19, 2025" — tooltip display
  weekDate: string     // "YYYY-MM-DD"   — XAxis dataKey + tick formatting
  maxCategory: number  // -1 (none) to 4
  yValue: number       // 0=none, 1=D0 … 5=D4
  // Per-category values for stacked areas; null = not this week's level
  y0: number | null
  y1: number | null
  y2: number | null
  y3: number | null
  y4: number | null
  d0: number
  d1: number
  d2: number
  d3: number
  d4: number
}

interface Props {
  history: DroughtReading[]
  countyName: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#FFFF00', '#FCD37F', '#FFAA00', '#E60000', '#730000']
const LABELS = ['D0 Abnormally Dry', 'D1 Moderate', 'D2 Severe', 'D3 Extreme', 'D4 Exceptional']

const Y_LABELS: Record<number, string> = { 0: '', 1: 'D0', 2: 'D1', 3: 'D2', 4: 'D3', 5: 'D4' }

function severityColor(maxCategory: number): string {
  if (maxCategory === 4) return '#730000'
  if (maxCategory === 3) return '#E60000'
  if (maxCategory === 2) return '#FFAA00'
  if (maxCategory === 1) return '#FCD37F'
  if (maxCategory === 0) return '#FFFF00'
  return '#E5E0D8'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcMaxCategory(row: DroughtReading): number {
  if ((row.d4 ?? 0) > 0) return 4
  if ((row.d3 ?? 0) > 0) return 3
  if ((row.d2 ?? 0) > 0) return 2
  if ((row.d1 ?? 0) > 0) return 1
  if ((row.d0 ?? 0) > 0) return 0
  return -1
}

function formatWeek(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTickLabel(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  })
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartDatum }>
}) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload

  // USDM cumulative → actual per-category (d2 means "D2 or worse", so actual D2 = d2 - d3)
  const actual: Record<number, number> = {
    0: d.d0 - d.d1,
    1: d.d1 - d.d2,
    2: d.d2 - d.d3,
    3: d.d3 - d.d4,
    4: d.d4,
  }

  return (
    <div className="rounded-lg border border-forest-green/10 bg-white px-3 py-2 shadow-md text-xs font-dm-sans">
      <p className="font-semibold text-forest-green">{d.week}</p>
      {d.maxCategory >= 0 ? (
        <div className="mt-1 space-y-0.5">
          {([4, 3, 2, 1, 0] as const).map(i =>
            actual[i] > 0.5 ? (
              <p key={i} style={{ color: COLORS[i] }}>
                {LABELS[i]} — {actual[i].toFixed(1)}%
              </p>
            ) : null,
          )}
        </div>
      ) : (
        <p className="mt-0.5 text-forest-green/40">No drought this week.</p>
      )}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DroughtTrendChart({ history, countyName }: Props) {
  const data: ChartDatum[] = [...history].reverse().map(row => {
    const maxCategory = calcMaxCategory(row)
    return {
      week: formatWeek(row.week_date),
      weekDate: row.week_date,
      maxCategory,
      yValue: maxCategory === -1 ? 0 : maxCategory + 1,
      y0: maxCategory === 0 ? 1 : null,
      y1: maxCategory === 1 ? 2 : null,
      y2: maxCategory === 2 ? 3 : null,
      y3: maxCategory === 3 ? 4 : null,
      y4: maxCategory === 4 ? 5 : null,
      d0: row.d0 ?? 0,
      d1: row.d1 ?? 0,
      d2: row.d2 ?? 0,
      d3: row.d3 ?? 0,
      d4: row.d4 ?? 0,
    }
  })

  if (data.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-[#FDFBF7] shadow-[0_2px_12px_rgba(27,67,50,0.08)]">
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <Heading level={5}>
          52-Week Trend
        </Heading>
        <p className="text-xs text-forest-green/50 font-dm-sans mt-0.5">
          Peak drought category per week — {countyName}
        </p>
      </div>

      <div className="p-4 sm:p-6">
        {/* Legend */}
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
          {LABELS.map((label, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-xs text-forest-green/70 font-dm-sans">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-black/10"
                style={{ backgroundColor: COLORS[i] }}
              />
              {label}
            </span>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={0} barGap={0}>
            <XAxis
              dataKey="weekDate"
              tick={{ fontSize: 10, fill: '#1B4332', fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              interval={7}
              tickFormatter={formatTickLabel}
            />
            <YAxis
              domain={[0, 5]}
              ticks={[0, 1, 2, 3, 4, 5]}
              tickFormatter={(v: number) => Y_LABELS[v] ?? ''}
              tick={{ fontSize: 10, fill: '#1B4332', fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              width={28}
            />
            <ReferenceLine y={0} stroke="rgba(27,67,50,0.12)" strokeWidth={1} />
              <ReferenceLine
                y={3}
                stroke="#FFAA00"
                strokeWidth={1}
                strokeDasharray="4 3"
                strokeOpacity={0.6}
                label={{ value: 'LFP trigger', position: 'insideTopRight', fontSize: 9, fill: '#FFAA00', fillOpacity: 0.8 }}
              />
              <ReferenceLine
                x={data[data.length - 1]?.weekDate}
                stroke="#1B4332"
                strokeWidth={1}
                strokeOpacity={0.25}
              />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(27,67,50,0.06)' }} />
            <Bar dataKey="yValue" stroke="none" isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={severityColor(d.maxCategory)}
                  fillOpacity={1}
                />
              ))}
            </Bar>
            <Line
              type="step"
              dataKey="yValue"
              stroke="#1B4332"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
