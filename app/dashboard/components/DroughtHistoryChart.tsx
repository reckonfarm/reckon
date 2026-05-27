'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'

export interface DroughtHistoryWeek {
  date: string  // "YYYY-MM-DD"
  none: number
  d0: number
  d1: number
  d2: number
  d3: number
  d4: number
}

interface Props {
  data: DroughtHistoryWeek[]
  countyName: string
}

const D_COLORS = ['#FFFF00', '#FCD37F', '#FFAA00', '#E60000', '#730000']
const D_LABELS = ['D0 Abnormally Dry', 'D1 Moderate', 'D2 Severe', 'D3 Extreme', 'D4 Exceptional']
const D_KEYS = ['d0', 'd1', 'd2', 'd3', 'd4'] as const

function formatWeekHeader(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: DroughtHistoryWeek }>
}) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload
  const levels = [
    { label: 'D4 Exceptional',    value: d.d4, color: '#730000' },
    { label: 'D3 Extreme',        value: d.d3, color: '#E60000' },
    { label: 'D2 Severe',         value: d.d2, color: '#FFAA00' },
    { label: 'D1 Moderate',       value: d.d1, color: '#FCD37F' },
    { label: 'D0 Abnormally Dry', value: d.d0, color: '#FFFF00' },
  ].filter(l => l.value > 0.5)

  return (
    <div className="rounded-lg border border-forest-green/10 bg-white px-3 py-2 shadow-md text-xs font-dm-sans">
      <p className="font-semibold text-forest-green">Week of {formatWeekHeader(d.date)}</p>
      {levels.length > 0 ? (
        <div className="mt-1 space-y-0.5">
          {levels.map(l => (
            <p key={l.label} style={{ color: l.color === '#FFFF00' ? '#a0900a' : l.color }}>
              {l.label} — {l.value.toFixed(1)}%
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-0.5 text-forest-green/40">No drought this week.</p>
      )}
    </div>
  )
}

function yearTicks(data: DroughtHistoryWeek[]): string[] {
  return data
    .filter(d => {
      const [, mm, dd] = d.date.split('-')
      return mm === '01' && parseInt(dd, 10) <= 7
    })
    .map(d => d.date)
}

export default function DroughtHistoryChart({ data, countyName }: Props) {
  if (data.length === 0) return null

  const ticks = yearTicks(data)

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-[#FDFBF7] shadow-[0_2px_12px_rgba(27,67,50,0.08)]">
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <h2 className="font-fraunces text-base font-semibold text-forest-green">
          3-Year Drought History
        </h2>
        <p className="text-xs text-forest-green/50 font-dm-sans mt-0.5">
          Weekly drought intensity by D-level — {countyName}
        </p>
      </div>

      <div className="p-4 sm:p-6">
        {/* Legend */}
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2">
          {D_LABELS.map((label, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-xs text-forest-green/70 font-dm-sans">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-black/10"
                style={{ backgroundColor: D_COLORS[i] }}
              />
              {label}
            </span>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={180}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            barCategoryGap={0}
            barGap={0}
          >
            <XAxis
              dataKey="date"
              ticks={ticks}
              tickFormatter={iso => iso.slice(0, 4)}
              tick={{ fontSize: 10, fill: '#1B4332', fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[100]}
              tickFormatter={() => '100%'}
              tick={{ fontSize: 10, fill: '#1B4332', fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(27,67,50,0.06)' }} />
            {D_KEYS.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="drought"
                fill={D_COLORS[i]}
                fillOpacity={1}
                stroke="none"
                isAnimationActive={false}
              />
            ))}
              <ReferenceLine
                x={data[data.length - 1]?.date}
                stroke="#1B4332"
                strokeWidth={1}
                strokeOpacity={0.25}
              />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
