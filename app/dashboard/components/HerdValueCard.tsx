import Link from 'next/link'
import { Card } from '@/app/components/ui/Card'
import type { HerdAnchor } from '@/lib/herd-anchor'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

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

  return (
    <Link href="/herd" className="block">
      <Card shadow="none" className="px-5 py-4 transition-colors hover:bg-forest-green/[0.03]">
        <p className={EYEBROW}>
          Herd value
        </p>
        {priced ? (
          <>
            <p className="mt-1.5 font-fraunces text-2xl font-semibold tabular-nums text-forest-green">
              {formatUSD(estimate.total_priced)}
            </p>
            <p className="mt-1 font-dm-sans text-xs text-forest-green/55">
              {estimate.lots_priced} of {estimate.lots_total} lot{estimate.lots_total === 1 ? '' : 's'} priced
              {estimate.county_name && ` · ${estimate.county_name} auction`}
              {estimate.as_of && ` · as of ${fmtShort(estimate.as_of)}`}
            </p>
          </>
        ) : (
          <p className="mt-1.5 font-dm-sans text-sm text-forest-green/60">{estimate.note}</p>
        )}
        {minFloor != null && (
          <p className="mt-1 font-dm-sans text-xs text-forest-green/55">
            LRP floor under {floors.length} of {estimate.lots_total} lot{estimate.lots_total === 1 ? '' : 's'} · from ${minFloor.toFixed(2)}/cwt
          </p>
        )}
      </Card>
    </Link>
  )
}
