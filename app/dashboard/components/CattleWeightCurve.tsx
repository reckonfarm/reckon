'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { FeederClass } from '@/lib/cattle-market-service'

// ─── Pillar 2: price-by-weight curve ─────────────────────────────────────────────
//
// The "price slide" — avg $/cwt across weight classes, steers vs heifers. Makes the
// inverse weight↔price relationship every rancher knows visible at a glance. Cash
// auction data only.

interface Row {
  midWeight: number
  label: string
  Steers: number | null
  Heifers: number | null
}

function PriceTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number | null; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-forest-green/10 bg-white px-3 py-2 shadow-md font-dm-sans text-xs">
      <p className="mb-1 font-semibold text-forest-green">{label}</p>
      {payload.map(p =>
        p.value == null ? null : (
          <p key={p.name} style={{ color: p.color }}>
            {p.name}: ${p.value.toFixed(2)}/cwt
          </p>
        ),
      )}
    </div>
  )
}

export default function CattleWeightCurve({
  steers,
  heifers,
}: {
  steers: FeederClass[]
  heifers: FeederClass[]
}) {
  const byMid = new Map<number, Row>()
  for (const s of steers) {
    byMid.set(s.midWeight, { midWeight: s.midWeight, label: s.label.replace(' lb', ''), Steers: s.avgCwt, Heifers: null })
  }
  for (const h of heifers) {
    const r = byMid.get(h.midWeight) ?? { midWeight: h.midWeight, label: h.label.replace(' lb', ''), Steers: null, Heifers: null }
    r.Heifers = h.avgCwt
    byMid.set(h.midWeight, r)
  }
  const data = [...byMid.values()].sort((a, b) => a.midWeight - b.midWeight)

  if (data.length < 2) {
    return (
      <p className="rounded-md bg-forest-green/5 px-3 py-4 text-center font-dm-sans text-sm text-forest-green/50">
        Not enough weight classes reported this week to draw the price curve.
      </p>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(27,67,50,0.08)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: '#1B4332', fillOpacity: 0.5 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `$${v}`}
          tick={{ fontSize: 11, fill: '#1B4332', fillOpacity: 0.5 }}
          tickLine={false}
          axisLine={false}
          width={48}
          domain={['dataMin - 15', 'dataMax + 15']}
        />
        <Tooltip content={<PriceTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-dm-sans)' }} />
        <Line type="monotone" dataKey="Steers" stroke="#1B4332" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="Heifers" stroke="#8B3A2B" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
