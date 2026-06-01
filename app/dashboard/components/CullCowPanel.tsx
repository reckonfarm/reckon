import type { CattleMarket } from '@/lib/cattle-market-service'

// ─── Pillar 3: Cull cow panel ────────────────────────────────────────────────────
//
// The under-served, high-value data. Cull cows are 15–30% of cow-calf revenue, yet
// most price tools ignore them. Current cull-cow (and slaughter-bull) $/cwt with an
// HONEST seasonal note: prices are typically lowest in fall (when most people sell)
// and firmer in summer. Context — NOT a "sell now" call, NOT a prediction.

function fmtCwt(n: number): string {
  return `$${n.toFixed(2)}`
}

export default function CullCowPanel({ data }: { data: CattleMarket }) {
  const { cullCows, slaughterBulls } = data
  const haveAny = cullCows != null || slaughterBulls != null

  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10 bg-white shadow-[0_2px_12px_rgba(27,67,50,0.08)]">
      <div className="border-b border-forest-green/10 px-4 py-3 sm:px-6">
        <h2 className="font-fraunces text-base font-semibold text-forest-green">Cull cows &amp; slaughter bulls</h2>
        <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">
          Often 15–30% of cow-calf revenue — and usually overlooked
        </p>
      </div>

      <div className="space-y-4 p-4 sm:p-6">
        {!haveAny ? (
          <p className="rounded-md bg-forest-green/5 px-3 py-4 text-center font-dm-sans text-sm text-forest-green/50">
            No cull cow or slaughter bull sales reported this week.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {cullCows && (
              <div className="rounded-lg bg-forest-green/5 px-4 py-3">
                <p className="font-dm-sans text-[11px] font-medium uppercase tracking-wide text-forest-green/40">Cull cows</p>
                <p className="mt-0.5 font-fraunces text-2xl font-semibold tabular-nums text-forest-green">
                  {fmtCwt(cullCows.avgCwt)}<span className="font-dm-sans text-sm font-normal text-forest-green/50">/cwt</span>
                </p>
                <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">
                  {fmtCwt(cullCows.priceLow)}–{fmtCwt(cullCows.priceHigh)} · {cullCows.head.toLocaleString()} head
                </p>
              </div>
            )}
            {slaughterBulls && (
              <div className="rounded-lg bg-forest-green/5 px-4 py-3">
                <p className="font-dm-sans text-[11px] font-medium uppercase tracking-wide text-forest-green/40">Slaughter bulls</p>
                <p className="mt-0.5 font-fraunces text-2xl font-semibold tabular-nums text-forest-green">
                  {fmtCwt(slaughterBulls.avgCwt)}<span className="font-dm-sans text-sm font-normal text-forest-green/50">/cwt</span>
                </p>
                <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">
                  {fmtCwt(slaughterBulls.priceLow)}–{fmtCwt(slaughterBulls.priceHigh)} · {slaughterBulls.head.toLocaleString()} head
                </p>
              </div>
            )}
          </div>
        )}

        <div className="rounded-md bg-rust/5 px-3 py-2.5">
          <p className="font-dm-sans text-[11px] font-medium uppercase tracking-wide text-rust/60">Seasonal context</p>
          <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/70">
            Cull cow prices are generally lowest in fall, when most ranchers cull and sell at once, and
            tend to be firmer in summer on lighter supply. That&apos;s a typical seasonal tendency for planning
            context — not a forecast, and not a recommendation to sell or hold.
          </p>
        </div>
      </div>
    </div>
  )
}
