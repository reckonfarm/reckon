'use client'

import { Card } from '@/app/components/ui/Card'
import type { CornResult } from '@/lib/corn-service'

// Market Read — the interpretation layer that LEADS the operation zone: it sits ABOVE the
// herd value (read first, value beneath — the decision-forward order). This is the §4
// feedlot-demand corn read, and per §3 it is a READ, never a calculator and never a
// sell-or-hold call — so the lead line is a sentence, never a number.
//
// Slice 2b-B wires the PRICE leg (CBOT ZC=F daily settle) to live data; Moisture and Crop
// are still later legs and stay in their honest "warming up" state. The lead line stays
// neutral until moisture is also live and the read can actually compose — one live chip is
// not yet a lean. Honest throughout: no settle → "warming up", a read error → "temporarily
// unavailable", never a fabricated $0.

const EYEBROW = 'font-dm-sans text-xs font-medium uppercase tracking-wider text-muted/50'
const CHIP = 'rounded-lg border border-forest-green/10 bg-cream/40 px-3 py-3'
const CHIP_LABEL = 'font-dm-sans text-xs font-medium text-forest-green/60'
const CHIP_FOOT = 'mt-1 font-dm-sans text-[11px] leading-tight'

// 'YYYY-MM-DD' → 'Jun 20' (date-only → identical server/client, no tz drift).
function fmtShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// A leg whose data isn't wired yet (Moisture, Crop): honest "warming up", never fake data.
function PendingChip({ label, hint }: { label: string; hint: string }) {
  return (
    <div className={CHIP}>
      <p className={CHIP_LABEL}>{label}</p>
      <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
      <p className={`${CHIP_FOOT} text-muted/55`}>warming up</p>
      <p className={`${CHIP_FOOT} text-muted/40`}>{hint}</p>
    </div>
  )
}

// The Price leg — live once a real ZC=F settle exists; otherwise the same honest pending /
// unavailable states as the other chips (never $0, never a fabricated move).
function PriceChip({ corn }: { corn: CornResult }) {
  if (corn.status !== 'ok') {
    const note = corn.status === 'data_unavailable' ? 'temporarily unavailable' : 'warming up'
    return (
      <div className={CHIP}>
        <p className={CHIP_LABEL}>Price</p>
        <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
        <p className={`${CHIP_FOOT} text-muted/55`}>{note}</p>
        <p className={`${CHIP_FOOT} text-muted/40`}>corn board</p>
      </div>
    )
  }

  const { settlePrice, priorSettle, changePct, direction, settleDate, stale } = corn
  const abs = priorSettle != null ? Math.abs(settlePrice - priorSettle) : null
  return (
    <div className={CHIP}>
      <p className={CHIP_LABEL}>Price</p>
      <p className="mt-1 font-dm-sans text-base font-semibold tabular-nums text-ink">{settlePrice.toFixed(2)}&cent;</p>
      {/* direction — reuses HerdEstimatePanel's ▲/▼ + text-up/text-down delta grammar */}
      <p className={CHIP_FOOT}>
        {direction === 'flat' || abs == null ? (
          <span className="text-muted/60">unchanged</span>
        ) : (
          <span className={`font-semibold tabular-nums ${direction === 'up' ? 'text-up' : 'text-down'}`}>
            {direction === 'up' ? '▲' : '▼'} {abs.toFixed(2)}
            {changePct != null && ` (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)`}
          </span>
        )}
      </p>
      <p className={`${CHIP_FOOT} text-muted/40`}>{stale ? `as of ${fmtShort(settleDate)}` : 'corn board · ¢/bu'}</p>
    </div>
  )
}

export default function MarketReadShell({ corn }: { corn: CornResult }) {
  return (
    <Card shadow="sm" className="p-6 sm:p-8">
      <p className={EYEBROW}>Market Read</p>

      {/* The read — a sentence, never a number or a lean. Stays neutral until moisture is
          also live and the read can compose; one live chip (Price) is not yet a lean. */}
      <p className="mt-2 font-fraunces text-2xl font-semibold leading-snug tracking-tight text-ink/80 sm:text-3xl">
        Reading feeder demand&hellip;
      </p>
      <p className="mt-2 max-w-md font-dm-sans text-sm leading-relaxed text-muted/70">
        What corn and grass are doing to feedlot demand &mdash; the read behind this week&rsquo;s number. Coming online.
      </p>

      {/* Evidence legs, in read order. Price is live (Slice 2b); Moisture / Crop are later legs. */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <PendingChip label="Moisture" hint="feeding-region rain vs normal" />
        <PendingChip label="Crop" hint="corn condition" />
        <PriceChip corn={corn} />
      </div>

      <p className="mt-4 font-dm-sans text-xs leading-relaxed text-muted/55">
        A read on the market, not a recommendation &mdash; never a sell-or-hold call.
      </p>
    </Card>
  )
}
