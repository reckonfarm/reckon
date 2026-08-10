import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { NationalBeefResult, NationalMetricRead } from '@/lib/national-beef-service'
import { marketDelta } from '@/lib/market-direction'

// National beef — the two benchmark reads a cow-calf operator anchors on: what fed
// cattle brought (5-Area weekly weighted average, the LMR benchmark) and what feeder
// steers brought at the country's benchmark auction (Oklahoma National Stockyards —
// honestly labeled as OKC, never passed off as a national average; the old national
// summary report is dashboard-only since Apr 2026 and exists on no API). Each metric
// degrades independently to 'warming up' — a dead source never kills the card.

const EYEBROW = 'text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide'

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function MetricLine({ label, read }: { label: string; read: NationalMetricRead | null }) {
  if (!read) {
    return (
      <li className="flex items-baseline justify-between gap-3 font-dm-sans text-sm">
        <span className="text-forest-green/70">{label}</span>
        <span className="shrink-0 text-forest-green/40">— <span className="text-xs">warming up</span></span>
      </li>
    )
  }
  return (
    <li className="flex items-baseline justify-between gap-3 font-dm-sans text-sm">
      <span className="text-forest-green/70">
        {label}
        {read.stale && <span className="ml-2 text-xs text-forest-green/40">as of {fmtDate(read.weekEnding)}</span>}
      </span>
      <span className="shrink-0 tabular-nums">
        <span className="font-semibold text-ink">${read.value.toFixed(2)}</span>
        {read.changePct != null && read.changePct !== 0 && (
          // Cattle benchmarks up = good for the seller — arrow and color agree
          // (lib/market-direction.ts: the rule holds even where it's invisible).
          (() => {
            const d = marketDelta(read.changePct! > 0, true)
            return (
              <span className={`ml-2 text-xs font-semibold ${d.cls}`}>
                {d.arrow} {Math.abs(read.changePct!).toFixed(1)}%
              </span>
            )
          })()
        )}
      </span>
    </li>
  )
}

export default function NationalBeefCard({ result }: { result: NationalBeefResult }) {
  // The freshest week-ending across present metrics — the card-level as-of line.
  const newestWeek =
    result.status === 'ok'
      ? [result.fedSteer, result.feeder500, result.feeder700]
          .filter((r): r is NationalMetricRead => r != null)
          .map(r => r.weekEnding)
          .sort()
          .at(-1) ?? null
      : null

  return (
    <Card shadow="soft" className="p-4 sm:p-6">
      <div className="mb-3">
        <p className={EYEBROW}>Cattle markets</p>
        <Heading level={5} className="mt-1">National beef</Heading>
      </div>

      {result.status === 'data_unavailable' && (
        <p className="text-sm text-forest-green/50 font-dm-sans">
          National price data temporarily unavailable — check back shortly.
        </p>
      )}

      {result.status === 'none' && (
        <p className="text-sm text-forest-green/50 font-dm-sans">
          National prices not loaded yet — check back shortly.
        </p>
      )}

      {result.status === 'ok' && (
        <>
          <ul className="space-y-2">
            <MetricLine label="Fed steers · 5-Area live" read={result.fedSteer} />
            <MetricLine label="Feeder steers 500–599 lb · OKC" read={result.feeder500} />
            <MetricLine label="Feeder steers 700–799 lb · OKC" read={result.feeder700} />
          </ul>
          <p className="mt-3 text-xs text-forest-green/40 font-dm-sans">
            USDA AMS Market News · $/cwt · weekly change
            {newestWeek ? ` · week ending ${fmtDate(newestWeek)}` : ''}
          </p>
        </>
      )}
    </Card>
  )
}
