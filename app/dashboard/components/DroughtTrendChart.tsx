'use client'

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
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
  week: string
  maxCategory: number  // 0-4 or -1 (no drought)
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
  return (
    <div className="rounded-lg border border-forest-green/10 bg-white px-3 py-2 shadow-md text-xs font-dm-sans">
      <p className="font-semibold text-forest-green">{d.week}</p>
      {d.maxCategory >= 0 ? (
        <p className="mt-0.5" style={{ color: COLORS[d.maxCategory] }}>
          {LABELS[d.maxCategory]}
        </p>
      ) : (
        <p className="mt-0.5 text-forest-green/40">No drought</p>
      )}
      <div className="mt-1 space-y-0.5 text-forest-green/60">
        {([d.d0, d.d1, d.d2, d.d3, d.d4] as number[]).map((pct, i) =>
          pct > 0 ? <p key={i}>D{i}: {pct.toFixed(1)}%</p> : null,
        )}
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DroughtTrendChart({ history, countyName }: Props) {
  const data: ChartDatum[] = [...history].reverse().map(row => ({
    week: formatWeek(row.week_date),
    maxCategory: calcMaxCategory(row),
    d0: row.d0 ?? 0,
    d1: row.d1 ?? 0,
    d2: row.d2 ?? 0,
    d3: row.d3 ?? 0,
    d4: row.d4 ?? 0,
  }))

  if (data.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-sm">
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <h2 className="font-fraunces text-base font-semibold text-forest-green">
          52-Week Trend
        </h2>
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

        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} barCategoryGap="20%">
            <XAxis
              dataKey="week"
              tick={{ fontSize: 10, fill: '#1B4332', fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis hide domain={[0, 4]} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(27,67,50,0.06)' }} />
            <Bar dataKey="maxCategory" isAnimationActive={false} radius={[2, 2, 0, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.maxCategory >= 0 ? COLORS[d.maxCategory] : 'rgba(27,67,50,0.08)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
