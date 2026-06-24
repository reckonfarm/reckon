'use client'

import { Card } from '@/app/components/ui/Card'
import type { CornResult } from '@/lib/corn-service'
import type { MoistureResult } from '@/lib/moisture-service'

// Market Read — the interpretation layer that LEADS the operation zone: it sits ABOVE the
// herd value (read first, value beneath). This is the §4 feedlot-demand corn read, and per
// §3 it is a READ, never a calculator and never a sell-or-hold call — so the lead line is a
// sentence, never a number.
//
// Slice 2c-B: BOTH the Price (corn ZC=F) and Moisture (USDM footprint D1+) legs are live, so
// the lead line can finally compose a lean from the two. Crop is still a later leg.
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

// ─── The read (lead line) ────────────────────────────────────────────────────────────
// Composed ONLY when both legs are live AND fresh; otherwise the neutral fallback (one live
// leg is not a lean). Per §3: a READ of demand pressure, never a sell/hold call, never a
// number. Calf-demand sentiment: WETTER ground (+1) and a SOFTER corn board (+1, cheaper feed
// → feedlots can pay up) both SUPPORT calf demand; DRIER (−1) and a FIRMER board (−1) lean on
// it. Agreement → a confident lean; disagreement → an honest "crossed"; a flat leg → "mixed"
// or "quiet". Nothing here manufactures confidence the two legs don't jointly support.
const NEUTRAL_LEAD = 'Reading feeder demand…'

function composeLead(corn: CornResult, moisture: MoistureResult): { lead: string; composed: boolean } {
  const bothLiveFresh =
    corn.status === 'ok' && !corn.stale && moisture.status === 'ok' && !moisture.stale
  if (!bothLiveFresh) return { lead: NEUTRAL_LEAD, composed: false }

  const mSent = moisture.direction === 'wetter' ? 1 : moisture.direction === 'drier' ? -1 : 0
  const cSent = corn.direction === 'down' ? 1 : corn.direction === 'up' ? -1 : 0 // cheaper corn supports calves

  if (mSent === 1 && cSent === 1) {
    return { composed: true, lead: 'Feed’s getting cheaper in feeder country — wetter ground and a softer corn board, both support under calf demand.' }
  }
  if (mSent === -1 && cSent === -1) {
    return { composed: true, lead: 'Feed’s getting dearer in feeder country — drier ground and a firmer corn board, both lean on calf demand.' }
  }

  const mPhrase = moisture.direction === 'wetter' ? 'wetter ground' : moisture.direction === 'drier' ? 'drier ground' : 'steady ground'
  const cPhrase = corn.direction === 'down' ? 'a softer corn board' : corn.direction === 'up' ? 'a firmer corn board' : 'a steady corn board'

  if (mSent * cSent < 0) {
    // genuine cross — one leg supports calves, the other leans on them.
    return { composed: true, lead: `Feed signals are crossed this week — ${mPhrase} but ${cPhrase}.` }
  }
  if (mSent === 0 && cSent === 0) {
    return { composed: true, lead: 'Feed signals are quiet this week — little change in moisture or the corn board.' }
  }
  // exactly one leg flat — honest "mixed", no false confidence.
  return { composed: true, lead: `Feed signals are mixed this week — ${mPhrase} and ${cPhrase}.` }
}

// ─── Chips ─────────────────────────────────────────────────────────────────────────
// A leg whose data isn't wired yet (Crop): honest "warming up", never fake data.
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

export default function MarketReadShell({ corn, moisture }: { corn: CornResult; moisture: MoistureResult }) {
  const { lead, composed } = composeLead(corn, moisture)
  return (
    <Card shadow="sm" className="p-6 sm:p-8">
      <p className={EYEBROW}>Market Read</p>

      {/* The read — a sentence, never a number or a sell/hold call. Composed from the two live
          legs when both are fresh; neutral fallback otherwise (one live leg is not a lean). */}
      <p className="mt-2 font-fraunces text-2xl font-semibold leading-snug tracking-tight text-ink/80 sm:text-3xl">
        {lead}
      </p>
      <p className="mt-2 max-w-md font-dm-sans text-sm leading-relaxed text-muted/70">
        What corn and grass are doing to feedlot demand &mdash; the read behind this week&rsquo;s number.
        {!composed && ' Coming online.'}
      </p>

      {/* Evidence legs, in read order. Moisture + Price live (Slice 2c / 2b); Crop is a later leg. */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <MoistureChip moisture={moisture} />
        <PendingChip label="Crop" hint="corn condition" />
        <PriceChip corn={corn} />
      </div>

      <p className="mt-4 font-dm-sans text-xs leading-relaxed text-muted/55">
        A read on the market, not a recommendation &mdash; never a sell-or-hold call.
      </p>
    </Card>
  )
}
