import Link from 'next/link'
import { Card } from '@/app/components/ui/Card'
import type { HerdAnchor } from '@/lib/herd-anchor'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { dollarsPerCwtMove, scopeLabel } from '@/lib/market-scope'

// ─── Herd value — a card, not the hero (2026-08-09 repositioning) ──────────────
// One number (this week's estimate at the nearest auction) plus the LRP floor
// line — the floor survives because it's an insurance decision, not context.
// Trend died with the Now/Trend/Outlook toggle: week-over-week delta is
// vanity cadence on a number that moves with the market, not with the work.
// Pure server markup on purpose — the full HerdEstimatePanel is a client
// island with a known SSR-navigation history (HerdAnchorLoader's comment);
// this card renders plain text and links to /herd for the full panel.

function formatUSD(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}
// A thin reference reported one price (low = high): "~$X", never "$X–$X".
function fmtThinRange(low: number, high: number): string {
  return Math.round(low) === Math.round(high) ? `~${formatUSD(low)}` : `${formatUSD(low)}–${formatUSD(high)}`
}

function fmtShort(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function HerdValueCard({ anchor }: { anchor: HerdAnchor }) {
  const { estimate, outlook } = anchor
  const priced = estimate.lots_priced > 0

  // One honest floor line: how many lots have a current LRP floor, and the
  // lowest of them — never a fake floor, nothing when none priced.
  const floors = (outlook?.status === 'ok' ? outlook.lots : []).filter(
    l => l.state === 'priced' && l.floor != null
  )
  const minFloor = floors.length > 0 ? Math.min(...floors.map(l => l.floor!.coverage_price)) : null
  const towns = [...new Set(estimate.perLot.filter(l => l.source).map(l => l.source!.town.replace(/,\s*[A-Z]{2}$/, '')))].join(' / ')
  // The sensitivity line is arithmetic on the LOT (head × weight), so a thin
  // price reference does not withhold it — only a missing head or weight does.
  const cwtLots = estimate.perLot.filter(l => l.value != null && l.source?.price_basis === 'cwt')
  const perDollar = cwtLots.reduce((s, l) => s + (dollarsPerCwtMove(l.head_count, l.avg_weight_lb) ?? 0), 0)
  const sensitivity = perDollar > 0 ? `Every $1/cwt move is $${perDollar.toLocaleString('en-US')} across ${cwtLots.length === 1 ? 'this lot' : `${cwtLots.length} lots`}.` : null

  return (
    <Link href="/herd" className="block">
      <Card shadow="none" className="px-5 py-4 transition-colors hover:bg-forest-green/[0.03]" data-audit="herd-value-card">
        <p className={EYEBROW}>
          Herd value
        </p>
        {priced ? (
          <>
            <p className="mt-1.5 font-fraunces text-2xl font-semibold tabular-nums text-forest-green">
              {estimate.total_priced > 0 ? formatUSD(estimate.total_priced) : ''}
              {estimate.thin_range && (
                <span className={estimate.total_priced > 0 ? 'text-[17px] text-forest-green/80' : ''}>
                  {estimate.total_priced > 0 ? ' + ' : ''}{fmtThinRange(estimate.thin_range.low, estimate.thin_range.high)}
                </span>
              )}
            </p>
            {/* Scope is the BARN the prices came from (Block 2.5 A2) — never the county. */}
            <p className="mt-1 font-dm-sans text-[15px] text-forest-green/80">
              {estimate.lots_priced} of {estimate.lots_total} lot{estimate.lots_total === 1 ? '' : 's'} priced
              {towns && ` · ${scopeLabel({ kind: 'nearby', town: towns })}`}
              {estimate.as_of && ` · as of ${fmtShort(estimate.as_of)}`}
              {estimate.lots_thin > 0 && ` · ${estimate.lots_thin} on thin evidence`}
            </p>
            {sensitivity && <p className="mt-1 font-dm-sans text-[15px] font-medium text-forest-green">{sensitivity}</p>}
          </>
        ) : (
          <p className="mt-1.5 font-dm-sans text-[15px] text-forest-green/80">{estimate.note}</p>
        )}
        {minFloor != null && (
          <p className="mt-1 font-dm-sans text-[15px] text-forest-green/80">
            LRP coverage available to explore for {floors.length} of {estimate.lots_total} lot{estimate.lots_total === 1 ? '' : 's'} · reference coverage price from ${minFloor.toFixed(2)}/cwt · needs a purchased endorsement
          </p>
        )}
      </Card>
    </Link>
  )
}
