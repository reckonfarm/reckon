'use client'

import { useState, useMemo } from 'react'
import type { FeederClass } from '@/lib/cattle-market-service'

// ─── Pillar 1: "What's my calf worth?" ───────────────────────────────────────────
//
// Client-side estimate, no PII stored. head + sex + avg weight → estimated value
// per head and total, using THIS WEEK's local $/cwt for the matching weight class.
// Honest: clearly an ESTIMATE; if no class matches the entered weight we say so
// rather than guessing.

function nearestClass(rows: FeederClass[], weight: number): FeederClass | null {
  if (rows.length === 0 || !Number.isFinite(weight) || weight <= 0) return null
  const bucket = Math.floor(weight / 100)
  const exact = rows.find(r => r.weightClass === `${bucket}-${bucket + 1}`)
  if (exact) return exact
  // else nearest by midpoint
  return rows.reduce((best, r) =>
    Math.abs(r.midWeight - weight) < Math.abs(best.midWeight - weight) ? r : best,
  )
}

export default function CalfValueCalculator({
  steers,
  heifers,
  asOfLabel,
  stale = false,
  scopeLabel = '',
}: {
  steers: FeederClass[]
  heifers: FeederClass[]
  asOfLabel: string | null
  stale?: boolean        // when true (e.g. frozen national report), emphasize the date
  scopeLabel?: string    // e.g. 'national' — included in the dated qualifier
}) {
  const [sex, setSex] = useState<'steers' | 'heifers'>('steers')
  const [weight, setWeight] = useState('550')
  const [head, setHead] = useState('50')

  const rows = sex === 'steers' ? steers : heifers
  const w = parseFloat(weight)
  const h = parseInt(head, 10)

  const result = useMemo(() => {
    const cls = nearestClass(rows, w)
    if (!cls || !Number.isFinite(w) || w <= 0) return null
    const perHead = (cls.avgCwt * w) / 100
    const total = Number.isFinite(h) && h > 0 ? perHead * h : null
    const exact = cls.weightClass === `${Math.floor(w / 100)}-${Math.floor(w / 100) + 1}`
    return { cls, perHead, total, exact }
  }, [rows, w, h])

  const dollars = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-[0_2px_12px_rgba(27,67,50,0.08)]">
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <h2 className="font-fraunces text-base font-semibold text-forest-green">What&apos;s my calf worth?</h2>
        <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">
          Estimate from this week&apos;s Montana cash prices
        </p>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {/* Sex toggle */}
          <div className="col-span-2 sm:col-span-1">
            <label className="mb-1 block font-dm-sans text-xs font-medium text-forest-green/50">Sex</label>
            <div className="flex rounded-lg border border-forest-green/15 p-0.5">
              {(['steers', 'heifers'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSex(s)}
                  className={[
                    'flex-1 rounded-md px-3 py-1.5 font-dm-sans text-sm font-medium capitalize transition-colors',
                    sex === s ? 'bg-forest-green text-white' : 'text-forest-green/60 hover:bg-forest-green/5',
                  ].join(' ')}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block font-dm-sans text-xs font-medium text-forest-green/50">Avg weight (lb)</label>
            <input
              type="number"
              inputMode="numeric"
              value={weight}
              onChange={e => setWeight(e.target.value)}
              className="w-full rounded-lg border border-forest-green/15 px-3 py-1.5 font-dm-sans text-sm tabular-nums text-forest-green focus:border-forest-green/40 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block font-dm-sans text-xs font-medium text-forest-green/50">Head</label>
            <input
              type="number"
              inputMode="numeric"
              value={head}
              onChange={e => setHead(e.target.value)}
              className="w-full rounded-lg border border-forest-green/15 px-3 py-1.5 font-dm-sans text-sm tabular-nums text-forest-green focus:border-forest-green/40 focus:outline-none"
            />
          </div>
        </div>

        {result ? (
          <div className="rounded-lg bg-forest-green/5 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="font-fraunces text-2xl font-semibold text-forest-green tabular-nums">
                  {dollars(result.perHead)}<span className="font-dm-sans text-sm font-normal text-forest-green/50">/head</span>
                </p>
                {result.total != null && (
                  <p className="mt-0.5 font-dm-sans text-sm text-forest-green/60">
                    ≈ <span className="font-semibold text-forest-green">{dollars(result.total)}</span> for {h} head
                  </p>
                )}
              </div>
              <p className="font-dm-sans text-[11px] text-forest-green/40">
                {result.cls.label} {sex} @ {fmtNum(result.cls.avgCwt)}/cwt
                {!result.exact && <span className="block">nearest class to your weight</span>}
              </p>
            </div>

            {/* Stale source (e.g. frozen national report): make the estimate's date
                unmistakable so it's never read as a current quote. */}
            {stale && asOfLabel && (
              <p className="mt-2 font-dm-sans text-[11px] font-medium text-amber-800">
                Based on {asOfLabel}{scopeLabel ? ` ${scopeLabel}` : ''} prices — the latest available, not a current quote.
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-lg bg-forest-green/5 px-4 py-3 font-dm-sans text-sm text-forest-green/50">
            Enter a weight to see an estimate — no {sex} prices reported for that weight.
          </p>
        )}

        <p className="font-dm-sans text-[11px] leading-snug text-forest-green/40">
          Estimate only — your actual sale depends on quality, frame, fill, and the day&apos;s market.
          {!stale && (asOfLabel ? ` Based on the ${asOfLabel} report.` : ' Based on the latest report.')} Nothing entered here is stored.
        </p>
      </div>
    </div>
  )
}

function fmtNum(n: number): string {
  return `$${n.toFixed(2)}`
}
