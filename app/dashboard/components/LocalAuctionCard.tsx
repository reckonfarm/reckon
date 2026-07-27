import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { LocalAuctionResult } from '@/lib/local-auction-service'

// Local auction — the nearest reporting barn's latest sale, steers by weight band
// (index spec: Medium & Large 1, Per Cwt), receipts, and week-over-week deltas.
// Boring layout, every state honest: fresh prices ≠ summer no-sale gap ≠ genuine
// no-coverage ≠ outage. Freshness = the SALE date, always shown.

const EYEBROW = 'text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide'

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function bandLabel(band: string): string {
  const lo = parseInt(band, 10)
  return `${lo}–${lo + 99} lb`
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

export default function LocalAuctionCard({ result }: { result: LocalAuctionResult }) {
  return (
    <Card shadow="soft" className="p-4 sm:p-6">
      <div className="mb-3">
        <p className={EYEBROW}>Cattle markets</p>
        <Heading level={5} className="mt-1">Local auction</Heading>
      </div>

      {result.status === 'data_unavailable' && (
        <p className="text-sm text-forest-green/50 font-dm-sans">
          Auction data temporarily unavailable — check back shortly.
        </p>
      )}

      {result.status === 'no_coverage' && (
        <p className="text-sm text-forest-green/50 font-dm-sans">
          No reporting auction within haul distance of this county — Montana coverage
          today, expanding.
        </p>
      )}

      {result.status === 'no_recent_sale' && (
        <p className="text-sm text-forest-green/50 font-dm-sans">
          No recent sale reported at {result.barnName} ({result.town}) — last sale{' '}
          {fmtDate(result.lastSale)}. Montana barns run lighter summer schedules.
        </p>
      )}

      {result.status === 'ok' && (
        <>
          <p className="font-dm-sans text-sm text-forest-green/70">
            <span className="font-semibold text-forest-green">{result.barnName}</span>
            <span className="text-forest-green/50"> · {result.town} · {result.miles} mi</span>
          </p>
          {result.beyondHaul && (
            <p className="mt-1 font-dm-sans text-xs text-forest-green/50">
              Nearest reporting barn — beyond typical haul distance, shown for reference.
            </p>
          )}

          <ul className="mt-3 space-y-2 border-t border-forest-green/[0.08] pt-3">
            {result.bands.map(b => (
              <li key={b.band} className="flex items-baseline justify-between gap-3 font-dm-sans text-sm">
                <span className="text-forest-green/70">Steers {bandLabel(b.band)}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-semibold text-ink">${b.avgPrice.toFixed(2)}</span>
                  {b.wowPct != null && b.wowPct !== 0 && (
                    <span className={`ml-2 text-xs font-semibold ${b.wowPct > 0 ? 'text-up' : 'text-down'}`}>
                      {b.wowPct > 0 ? '▲' : '▼'} {Math.abs(b.wowPct).toFixed(1)}%
                    </span>
                  )}
                  <span className="ml-2 text-xs text-forest-green/40">{fmtInt(b.head)} head</span>
                </span>
              </li>
            ))}
          </ul>

          {result.receipts != null && (
            <p className="mt-3 font-dm-sans text-xs text-forest-green/50 tabular-nums">
              {fmtInt(result.receipts)} receipts
              {result.receiptsWeekAgo != null && ` · wk ago ${fmtInt(result.receiptsWeekAgo)}`}
              {result.receiptsYearAgo != null && ` · yr ago ${fmtInt(result.receiptsYearAgo)}`}
            </p>
          )}

          <p className="mt-3 text-xs text-forest-green/40 font-dm-sans">
            USDA AMS Market News · $/cwt · sale of {fmtDate(result.saleDate)}
          </p>
        </>
      )}
    </Card>
  )
}
