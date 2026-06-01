import type { CattleMarket, FeederClass } from '@/lib/cattle-market-service'

// ─── Feeder weight-class table — "The Familiar" ──────────────────────────────────
//
// SERVER component. The trust anchor: the exact weight-class grid a rancher reads
// in the auction report — steers + heifers, avg $/cwt, range, head, avg weight —
// with an explicit as-of date and USDA AMS attribution. Honesty is load-bearing:
//   • status 'data_unavailable' → an honest outage line, never stale numbers.
//   • a sex with no sales this week → "No sales reported", never a fabricated row.
//   • cash prices only; never implied as CME futures.

function fmtCwt(n: number): string {
  return `$${n.toFixed(2)}`
}

function FeederTable({ title, rows }: { title: string; rows: FeederClass[] }) {
  return (
    <div>
      <h3 className="mb-2 font-fraunces text-sm font-semibold text-forest-green">{title}</h3>
      {rows.length === 0 ? (
        <p className="rounded-md bg-forest-green/5 px-3 py-3 text-center font-dm-sans text-sm text-forest-green/50">
          No {title.toLowerCase()} sales reported this week.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-dm-sans text-sm">
            <thead>
              <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-forest-green/40">
                <th className="py-1.5 pr-3 font-medium">Weight</th>
                <th className="py-1.5 pr-3 font-medium">Avg $/cwt</th>
                <th className="py-1.5 pr-3 font-medium">Range</th>
                <th className="py-1.5 pr-3 font-medium">Head</th>
                <th className="py-1.5 font-medium">Avg wt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.weightClass} className="border-t border-forest-green/8">
                  <td className="py-2 pr-3 font-medium text-forest-green">{c.label}</td>
                  <td className="py-2 pr-3 font-semibold tabular-nums text-forest-green">{fmtCwt(c.avgCwt)}</td>
                  <td className="py-2 pr-3 tabular-nums text-forest-green/60">
                    {fmtCwt(c.priceLow)}–{fmtCwt(c.priceHigh)}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-forest-green/60">{c.head.toLocaleString()}</td>
                  <td className="py-2 tabular-nums text-forest-green/60">{c.avgWeight} lb</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function CattleMarketPanel({ data }: { data: CattleMarket }) {
  const r = data.receipts
  const trend =
    r.current != null && r.lastReported != null
      ? r.current > r.lastReported ? 'up' : r.current < r.lastReported ? 'down' : 'steady'
      : null

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-[0_2px_12px_rgba(27,67,50,0.08)]">
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-fraunces text-base font-semibold text-forest-green">
              {data.stale ? 'Feeder cattle' : 'Feeder cattle — this week'}
            </h2>
            <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">
              Weighted-average cash auction prices
            </p>
          </div>
          {/* When stale (e.g. the frozen national report), pin the real date to the
              prices themselves so a number is never mistaken for today's. */}
          {data.stale && data.asOfLabel ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 font-dm-sans text-[11px] font-semibold text-amber-900">
              as of {data.asOfLabel}
            </span>
          ) : data.mode === 'mock' ? (
            <span className="rounded-full border border-rust/30 bg-rust/8 px-3 py-1 font-dm-sans text-[11px] font-semibold text-rust">
              Sample data
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        {/* Receipts + week-over-week */}
        {r.current != null && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-dm-sans text-sm text-forest-green/70">
            <span>
              <span className="font-semibold text-forest-green">{r.current.toLocaleString()}</span> head this week
            </span>
            {r.lastReported != null && (
              <span className="text-forest-green/50">
                vs {r.lastReported.toLocaleString()} last reported
                {trend === 'up' && <span className="ml-1 font-semibold text-forest-green">▲</span>}
                {trend === 'down' && <span className="ml-1 font-semibold text-rust">▼</span>}
              </span>
            )}
            {r.lastYear != null && <span className="text-forest-green/50">· {r.lastYear.toLocaleString()} a year ago</span>}
          </div>
        )}

        <FeederTable title="Steers" rows={data.feeder.steers} />
        <FeederTable title="Heifers" rows={data.feeder.heifers} />

        {data.trendText && (
          <div className="rounded-md bg-forest-green/4 px-3 py-2.5">
            <p className="font-dm-sans text-[11px] font-medium uppercase tracking-wide text-forest-green/40">
              Compared to last week
            </p>
            <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/70 line-clamp-4">
              {data.trendText}
            </p>
          </div>
        )}

        <p className="pt-1 font-dm-sans text-[11px] leading-snug text-forest-green/40">
          {data.reportWindowLabel ? `Week of ${data.reportWindowLabel}` : ''}
          {data.asOfLabel ? ` · as of ${data.asOfLabel}` : ''} · source:{' '}
          <a
            href="https://mymarketnews.ams.usda.gov/viewReport/1778"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            USDA AMS Market News
          </a>
          . Cash auction averages, not a quote or guarantee of price.
        </p>
      </div>
    </div>
  )
}
