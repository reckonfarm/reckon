'use client'

import { Card } from '@/app/components/ui/Card'
import type { CornResult } from '@/lib/corn-service'
import type { MoistureResult } from '@/lib/moisture-service'
import type { CropResult } from '@/lib/crop-service'
import type { CycleResult } from '@/lib/cattle-cycle-service'
import { marketDelta } from '@/lib/market-direction'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

// Market Read — the §4 feedlot-demand corn read, shown as RAW EVIDENCE ONLY. A2 retired the
// composed narrative lead; Block 2 finished the job: PURE METRICS, ZERO PHRASES. Each chip is
// what the metric IS (label + definition footer), its value, and its trend — no phase words,
// no editorializing delta words ('wetter'/'better'/'fewer' are gone; arrow + magnitude + unit
// only), and no card disclaimer (with no read offered there is nothing to disclaim). The old
// composeLead() sentence generator was deleted, not hidden, so no lean quietly regenerates.
//
// ONE DIRECTION GRAMMAR, EVERYWHERE (lib/market-direction.ts): the arrow shows which way
// the number moved; the color shows whether that move is good or bad for a cow-calf
// operator. This replaced the old two-grammar scheme where the corn PRICE colored by raw
// settle direction and rendered feed cost spikes green — corn up now reads red, because
// feedlots bidding against expensive feed pay less for calves. Every chip routes through
// marketDelta() so none can drift back to raw-number coloring.
//
// Honest throughout: a leg with no data → "warming up"; a read error → "temporarily
// unavailable"; never a fabricated $0 / 0% / lean.

const CHIP = 'rounded-lg border border-forest-green/10 bg-cream/40 px-3 py-3'
const CHIP_LABEL = 'font-dm-sans text-xs font-medium text-forest-green/60'
const CHIP_VALUE = 'mt-1 font-dm-sans text-base font-semibold tabular-nums text-ink'
const CHIP_FOOT = 'mt-1 font-dm-sans text-[11px] leading-tight'

// 'YYYY-MM-DD' → 'Jun 20' (date-only → identical server/client, no tz drift).
function fmtShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Chips ─────────────────────────────────────────────────────────────────────────
// The Moisture leg — live USDM footprint D1+. COLOR ENCODES MEANING: wetter = good (text-up),
// drier = bad (text-down); the arrow tracks the raw number (▼ when drought fell). Never 0%.
function MoistureChip({ moisture }: { moisture: MoistureResult }) {
  if (moisture.status !== 'ok') {
    const note = moisture.status === 'data_unavailable' ? 'temporarily unavailable' : 'warming up'
    return (
      <div className={CHIP}>
        <p className={CHIP_LABEL}>Feed-region drought</p>
        <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
        <p className={`${CHIP_FOOT} text-muted/55`}>{note}</p>
        <p className={`${CHIP_FOOT} text-muted/40`}>16-state feeding area in D1+</p>
      </div>
    )
  }

  const { droughtPct, changePts, direction, mapDate, stale } = moisture
  const pts = changePts != null ? Math.abs(changePts) : null
  return (
    <div className={CHIP}>
      <p className={CHIP_LABEL}>Feed-region drought</p>
      <p className={CHIP_VALUE}>{Math.round(droughtPct)}%</p>
      <p className={CHIP_FOOT}>
        {direction === 'flat' || pts == null ? (
          <span className="text-muted/60">unchanged</span>
        ) : (
          // Drought footprint rising = drier feeding area = bad → ▲ red.
          (() => {
            const d = marketDelta(direction === 'drier', false)
            return (
              <span className={`font-semibold tabular-nums ${d.cls}`}>
                {d.arrow} {pts.toFixed(1)} pts
              </span>
            )
          })()
        )}
      </p>
      <p className={`${CHIP_FOOT} text-muted/40`}>{stale ? `as of ${fmtShort(mapDate)}` : '16-state feeding area in D1+'}</p>
    </div>
  )
}

// The Crop leg — live NASS corn good+excellent %. COLOR ENCODES MEANING (consistent green =
// supportive-for-calves): a BETTER crop (rising G/E) → more/cheaper feed → text-up ▲; WORSE →
// text-down ▼. Here arrow AND color agree (unlike Moisture). Distinctive 'off_season' state:
// out of NASS's Apr–Nov window we show "resumes in spring", never a frozen number / 0%.
function CropChip({ crop }: { crop: CropResult }) {
  if (crop.status === 'off_season') {
    return (
      <div className={CHIP}>
        <p className={CHIP_LABEL}>Corn condition</p>
        <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
        <p className={`${CHIP_FOOT} text-muted/55`}>resumes in spring</p>
        <p className={`${CHIP_FOOT} text-muted/40`}>US corn good + excellent</p>
      </div>
    )
  }
  if (crop.status !== 'ok') {
    const note = crop.status === 'data_unavailable' ? 'temporarily unavailable' : 'warming up'
    return (
      <div className={CHIP}>
        <p className={CHIP_LABEL}>Corn condition</p>
        <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
        <p className={`${CHIP_FOOT} text-muted/55`}>{note}</p>
        <p className={`${CHIP_FOOT} text-muted/40`}>US corn good + excellent</p>
      </div>
    )
  }

  const { gePct, changePts, direction, weekEnding, stale } = crop
  const pts = changePts != null ? Math.abs(changePts) : null
  return (
    <div className={CHIP}>
      <p className={CHIP_LABEL}>Corn condition</p>
      <p className={CHIP_VALUE}>{Math.round(gePct)}%</p>
      <p className={CHIP_FOOT}>
        {direction === 'flat' || pts == null ? (
          <span className="text-muted/60">unchanged</span>
        ) : (
          // A better crop = more/cheaper feed = good → ▲ green (arrow and color agree here).
          (() => {
            const d = marketDelta(direction === 'better', true)
            return (
              <span className={`font-semibold tabular-nums ${d.cls}`}>
                {d.arrow} {pts.toFixed(1)} pts
              </span>
            )
          })()
        )}
      </p>
      <p className={`${CHIP_FOOT} text-muted/40`}>{stale ? `as of ${fmtShort(weekEnding)}` : 'US corn good + excellent'}</p>
    </div>
  )
}

// The Cattle Cycle leg — live NASS heifers-on-feed YoY (the §2 cycle "master switch"), shown
// as the signed YoY NUMBER (Block 2 deleted the phase word — the interpretation was a phrase).
// COLOR ENCODES MEANING: FEWER heifers YoY = herd holding back / rebuilding = tighter future
// supply = SUPPORTIVE → text-up (green); MORE = still feeding, not retaining = pressure →
// text-down. Arrow tracks the raw number (▼ when heifers fell); green alone carries the
// meaning — same inversion as Moisture. Quarterly, so a months-old reading is normal (the
// service's wide stale window handles that).
function CycleChip({ cycle }: { cycle: CycleResult }) {
  if (cycle.status !== 'ok') {
    const note = cycle.status === 'data_unavailable' ? 'temporarily unavailable' : 'warming up'
    return (
      <div className={CHIP}>
        <p className={CHIP_LABEL}>Heifers on feed</p>
        <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
        <p className={`${CHIP_FOOT} text-muted/55`}>{note}</p>
        <p className={`${CHIP_FOOT} text-muted/40`}>US feedlots · vs year ago</p>
      </div>
    )
  }

  const { yoyPct, direction, reportPoint, stale } = cycle
  return (
    <div className={CHIP}>
      <p className={CHIP_LABEL}>Heifers on feed</p>
      {yoyPct == null ? (
        <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
      ) : (
        <p className={CHIP_VALUE}>{yoyPct > 0 ? '+' : ''}{yoyPct.toFixed(1)}%</p>
      )}
      <p className={CHIP_FOOT}>
        {yoyPct == null ? (
          <span className="text-muted/60">no year-ago figure</span>
        ) : direction === 'steady' ? (
          <span className="text-muted/60">unchanged</span>
        ) : (
          // More heifers on feed = herd still liquidating = bad → ▲ red; fewer = rebuilding → ▼ green.
          (() => {
            const d = marketDelta(direction === 'still_feeding', false)
            return (
              <span className={`font-semibold ${d.cls}`}>
                {d.arrow} vs year ago
              </span>
            )
          })()
        )}
      </p>
      <p className={`${CHIP_FOOT} text-muted/40`}>US feedlots · quarterly{stale ? ` · as of ${fmtShort(reportPoint)}` : ''}</p>
    </div>
  )
}

// The Price leg — live CBOT ZC=F settle. THE CHIP THE RULE WAS NAMED FOR: corn up is feed
// cost rising, so ▲ pairs with red — the one place raw-number coloring used to lie.
function PriceChip({ corn }: { corn: CornResult }) {
  if (corn.status !== 'ok') {
    const note = corn.status === 'data_unavailable' ? 'temporarily unavailable' : 'warming up'
    return (
      <div className={CHIP}>
        <p className={CHIP_LABEL}>Corn</p>
        <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
        <p className={`${CHIP_FOOT} text-muted/55`}>{note}</p>
        <p className={`${CHIP_FOOT} text-muted/40`}>CBOT front month · ¢/bu</p>
      </div>
    )
  }

  const { settlePrice, priorSettle, changePct, direction, settleDate, stale } = corn
  const abs = priorSettle != null ? Math.abs(settlePrice - priorSettle) : null
  return (
    <div className={CHIP}>
      <p className={CHIP_LABEL}>Corn</p>
      <p className={CHIP_VALUE}>{settlePrice.toFixed(2)}&cent;</p>
      <p className={CHIP_FOOT}>
        {direction === 'flat' || abs == null ? (
          <span className="text-muted/60">unchanged</span>
        ) : (
          (() => {
            const d = marketDelta(direction === 'up', false)
            return (
              <span className={`font-semibold tabular-nums ${d.cls}`}>
                {d.arrow} {abs.toFixed(2)}
                {changePct != null && ` (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)`}
              </span>
            )
          })()
        )}
      </p>
      <p className={`${CHIP_FOOT} text-muted/40`}>{stale ? `as of ${fmtShort(settleDate)}` : 'CBOT front month · ¢/bu'}</p>
    </div>
  )
}

export default function MarketReadShell({ corn, moisture, crop, cycle }: { corn: CornResult; moisture: MoistureResult; crop: CropResult; cycle: CycleResult }) {
  return (
    <Card shadow="sm" className="p-6 sm:p-8">
      {/* Plain, neutral header — eyebrow only; the chips carry the story (A2: show-don't-preach). */}
      <p className={EYEBROW}>Market Read</p>

      {/* Evidence legs. Feed signals (Moisture / Crop / Price) + the cattle-cycle master-switch
          context. Four chips: 2×2 on a phone, one row on sm+ (wraps cleanly at chip width).
          No disclaimer footer: pure metrics offer no read, so there is nothing to disclaim. */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MoistureChip moisture={moisture} />
        <CropChip crop={crop} />
        <PriceChip corn={corn} />
        <CycleChip cycle={cycle} />
      </div>
    </Card>
  )
}
