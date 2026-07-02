'use client'

import { Card } from '@/app/components/ui/Card'
import type { CornResult } from '@/lib/corn-service'
import type { MoistureResult } from '@/lib/moisture-service'
import type { CropResult } from '@/lib/crop-service'
import type { CycleResult } from '@/lib/cattle-cycle-service'

// Market Read — the §4 feedlot-demand corn read, shown as RAW EVIDENCE ONLY (A2 retired
// the composed narrative lead: show-don't-preach). Four chips under the bare eyebrow;
// per §3 it is a READ, never a calculator and never a sell-or-hold call — the
// footer says so explicitly. The old composeLead() sentence generator was deleted, not
// hidden, so no lean quietly regenerates later.
//
// THE TWO DIRECTION GRAMMARS DIFFER ON PURPOSE:
//   • Price: raw settle direction — up = text-up, down = text-down (a number moving).
//   • Moisture: MEANING, not the raw number — a FALLING drought % means WETTER, which is GOOD
//     for calf demand, so 'wetter' = text-up (green) even though the number went DOWN. The
//     arrow tracks the number (▼ when drought fell); the color + word carry the meaning.
//
// Honest throughout: a leg with no data → "warming up"; a read error → "temporarily
// unavailable"; never a fabricated $0 / 0% / lean.

const EYEBROW = 'font-dm-sans text-xs font-medium uppercase tracking-wider text-muted/50'
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
        <p className={CHIP_LABEL}>Feed country</p>
        <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
        <p className={`${CHIP_FOOT} text-muted/55`}>{note}</p>
        <p className={`${CHIP_FOOT} text-muted/40`}>feeding-region rain vs normal</p>
      </div>
    )
  }

  const { droughtPct, changePts, direction, mapDate, stale } = moisture
  const pts = changePts != null ? Math.abs(changePts) : null
  return (
    <div className={CHIP}>
      <p className={CHIP_LABEL}>Feed country</p>
      <p className={CHIP_VALUE}>{Math.round(droughtPct)}%</p>
      <p className={CHIP_FOOT}>
        {direction === 'flat' || pts == null ? (
          <span className="text-muted/60">unchanged</span>
        ) : (
          // wetter ⇒ good ⇒ text-up (even though the % fell, ▼); drier ⇒ bad ⇒ text-down (▲).
          <span className={`font-semibold tabular-nums ${direction === 'wetter' ? 'text-up' : 'text-down'}`}>
            {direction === 'wetter' ? '▼' : '▲'} {pts.toFixed(1)} pts {direction}
          </span>
        )}
      </p>
      <p className={`${CHIP_FOOT} text-muted/40`}>{stale ? `as of ${fmtShort(mapDate)}` : 'corn belt · in drought D1+'}</p>
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
        <p className={CHIP_LABEL}>Crop</p>
        <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
        <p className={`${CHIP_FOOT} text-muted/55`}>resumes in spring</p>
        <p className={`${CHIP_FOOT} text-muted/40`}>corn condition</p>
      </div>
    )
  }
  if (crop.status !== 'ok') {
    const note = crop.status === 'data_unavailable' ? 'temporarily unavailable' : 'warming up'
    return (
      <div className={CHIP}>
        <p className={CHIP_LABEL}>Crop</p>
        <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
        <p className={`${CHIP_FOOT} text-muted/55`}>{note}</p>
        <p className={`${CHIP_FOOT} text-muted/40`}>corn condition</p>
      </div>
    )
  }

  const { gePct, changePts, direction, weekEnding, stale } = crop
  const pts = changePts != null ? Math.abs(changePts) : null
  return (
    <div className={CHIP}>
      <p className={CHIP_LABEL}>Crop</p>
      <p className={CHIP_VALUE}>{Math.round(gePct)}%</p>
      <p className={CHIP_FOOT}>
        {direction === 'flat' || pts == null ? (
          <span className="text-muted/60">unchanged</span>
        ) : (
          // better ⇒ good ⇒ text-up ▲ (rising G/E); worse ⇒ bad ⇒ text-down ▼. Arrow + color agree.
          <span className={`font-semibold tabular-nums ${direction === 'better' ? 'text-up' : 'text-down'}`}>
            {direction === 'better' ? '▲' : '▼'} {pts.toFixed(1)} pts {direction}
          </span>
        )}
      </p>
      <p className={`${CHIP_FOOT} text-muted/40`}>{stale ? `as of ${fmtShort(weekEnding)}` : 'good+excellent'}</p>
    </div>
  )
}

// The Cattle Cycle leg — live NASS heifers-on-feed YoY (the §2 cycle "master switch"), shown
// as a phase WORD, not a head count. COLOR ENCODES MEANING: FEWER heifers YoY = herd holding
// back / rebuilding = tighter future supply = SUPPORTIVE → text-up (green); MORE = still
// feeding, not retaining = pressure → text-down. Arrow tracks the raw number (▼ when heifers
// fell); green + word carry the meaning — same inversion as Moisture. Quarterly, so a months-
// old reading is normal (the service's wide stale window handles that).
function CycleChip({ cycle }: { cycle: CycleResult }) {
  if (cycle.status !== 'ok') {
    const note = cycle.status === 'data_unavailable' ? 'temporarily unavailable' : 'warming up'
    return (
      <div className={CHIP}>
        <p className={CHIP_LABEL}>Cattle cycle</p>
        <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
        <p className={`${CHIP_FOOT} text-muted/55`}>{note}</p>
        <p className={`${CHIP_FOOT} text-muted/40`}>heifers on feed</p>
      </div>
    )
  }

  const { yoyPct, direction, reportPoint, stale } = cycle
  const phase = direction === 'holding_back' ? 'Holding back' : direction === 'still_feeding' ? 'Still feeding' : 'Steady'
  const abs = yoyPct != null ? Math.abs(yoyPct) : null
  return (
    <div className={CHIP}>
      <p className={CHIP_LABEL}>Cattle cycle</p>
      <p className="mt-1 font-fraunces text-lg font-semibold leading-tight text-ink">{phase}</p>
      <p className={CHIP_FOOT}>
        {abs == null ? (
          <span className="text-muted/60">no year-ago figure</span>
        ) : direction === 'steady' ? (
          <span className="text-muted/60">about even with last year</span>
        ) : (
          // holding_back ⇒ supportive ⇒ text-up ▼ (fewer heifers); still_feeding ⇒ text-down ▲.
          <span className={`font-semibold tabular-nums ${direction === 'holding_back' ? 'text-up' : 'text-down'}`}>
            {direction === 'holding_back' ? '▼' : '▲'} {abs.toFixed(1)}% {direction === 'holding_back' ? 'fewer' : 'more'} heifers
          </span>
        )}
      </p>
      <p className={`${CHIP_FOOT} text-muted/40`}>heifers on feed vs a year ago{stale ? ` · as of ${fmtShort(reportPoint)}` : ''}</p>
    </div>
  )
}

// The Price leg — live CBOT ZC=F settle. Raw-number direction (up/down), unlike Moisture.
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
      <p className={CHIP_VALUE}>{settlePrice.toFixed(2)}&cent;</p>
      {/* reuses HerdEstimatePanel's ▲/▼ + text-up/text-down delta grammar (raw number) */}
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

export default function MarketReadShell({ corn, moisture, crop, cycle }: { corn: CornResult; moisture: MoistureResult; crop: CropResult; cycle: CycleResult }) {
  return (
    <Card shadow="sm" className="p-6 sm:p-8">
      {/* Plain, neutral header — eyebrow only; the chips carry the story (A2: show-don't-preach). */}
      <p className={EYEBROW}>Market Read</p>

      {/* Evidence legs. Feed signals (Moisture / Crop / Price) + the cattle-cycle master-switch
          context. Four chips: 2×2 on a phone, one row on sm+ (wraps cleanly at chip width). */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MoistureChip moisture={moisture} />
        <CropChip crop={crop} />
        <PriceChip corn={corn} />
        <CycleChip cycle={cycle} />
      </div>

      <p className="mt-4 font-dm-sans text-xs leading-relaxed text-muted/55">
        A read on the market, not a recommendation &mdash; never a sell-or-hold call.
      </p>
    </Card>
  )
}
