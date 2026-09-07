import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { LocalAuctionResult, BandRead, CullRead } from '@/lib/local-auction-service'
import { marketDelta } from '@/lib/market-direction'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { isThin, scopeLabel, thinEvidence } from '@/lib/market-scope'
import { DISCOVERY_RADIUS_MI, DISTANCE_BASIS } from '@/lib/barn-geo'
import ReportEvidence from '@/app/components/ReportEvidence'

// ─── Nearby auction reference (Block 2.5, Part A) ─────────────────────────────
// Every figure here is an AUCTION result with its scope named — the barn, never
// the county the person happens to live in. Every line carries its evidence:
// head reported, sale date, class, and the MARS report id. A band backed by
// fewer than THIN_HEAD_THRESHOLD head shows its reported range and the thin
// label, never a cents-precise figure. Cull cows and bulls are kept distinct
// by grade and never blended with feeders; a slaughter-bull price is a
// salvage figure and is labeled so.

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function bandLabel(band: string): string {
  const lo = parseInt(band, 10)
  return `${lo}–${lo + 99} lb`
}
const fmtInt = (n: number) => n.toLocaleString('en-US')
const shortTown = (town: string) => town.replace(/,\s*[A-Z]{2}$/, '')
// The one no-local sentence, shared by the no-coverage state and the regional-reference state.
const NO_LOCAL_LINE = `No reporting auction within ${DISCOVERY_RADIUS_MI} ${DISTANCE_BASIS} of the county center`


// One band line (A5): class and weight left, price and unit right, the sample beneath
// at meta. "4 head · limited sample" replaces the chip and the sentence; a real range
// stays a range and says so. The heading carries the unit and the sale date once.
function BandLine({ cls, b }: { cls: string; b: BandRead }) {
  const thin = isThin(b.head)
  const ev = thin ? thinEvidence(b.priceLow, b.priceHigh, b.avgPrice, b.head) : null
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3 font-dm-sans text-[17px]">
        <span className="text-ink">{cls} {bandLabel(b.band)}</span>
        <span className="shrink-0 tabular-nums">
          <span className="font-semibold text-ink">{ev ? ev.figure : `$${b.avgPrice.toFixed(2)}`}</span>
          <span className="text-secondary-ink">/cwt</span>
          {!thin && b.wowPct != null && b.wowPct !== 0 && (() => {
            const d = marketDelta(b.wowPct! > 0, true)
            return <span className={`ml-2 text-[16px] font-semibold ${d.cls}`}>{d.arrow} {Math.abs(b.wowPct!).toFixed(1)}%</span>
          })()}
        </span>
      </div>
      <p className="mt-0.5 font-dm-sans text-[14px] text-secondary-ink">
        {fmtInt(b.head)} head{thin ? ' · limited sample' : ''}{ev && !ev.single ? ' · a range, not one price' : ''}
      </p>
    </li>
  )
}

function CullLine({ c, kind }: { c: CullRead; kind: 'cows' | 'bulls' }) {
  const thin = isThin(c.head)
  const ev = thin ? thinEvidence(c.priceLow, c.priceHigh, c.avgPrice, c.head) : null
  const name = kind === 'cows'
    ? (c.gradeKnown ? `${c.grade} cows` : 'Cull cows (grade not captured)')
    : (c.gradeKnown && c.grade !== 'All' ? `Slaughter bulls · yield ${c.grade}` : 'Slaughter bulls')
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3 font-dm-sans text-[17px]">
        <span className="text-ink">{name}</span>
        <span className="shrink-0 tabular-nums">
          <span className="font-semibold text-ink">{ev ? ev.figure : `$${c.avgPrice.toFixed(2)}`}</span>
          <span className="text-secondary-ink">/cwt</span>
        </span>
      </div>
      <p className="mt-0.5 font-dm-sans text-[14px] text-secondary-ink">
        {fmtInt(c.head)} head · {c.rows} {c.rows === 1 ? 'lot' : 'lots'}
        {c.avgWeight != null ? ` · ~${fmtInt(c.avgWeight)} lb live` : ''}
        {c.dressing ? ` · ${c.dressing.toLowerCase()} dressing` : ''}
        {thin ? ' · limited sample' : ''}{ev && !ev.single ? ' · a range, not one price' : ''}
      </p>
    </li>
  )
}

export default function LocalAuctionCard({ result }: { result: LocalAuctionResult }) {
  return (
    <Card shadow="soft" className="p-4 sm:p-6" data-audit="auction-card">
      <div className="mb-3">
        <p className={EYEBROW}>Cattle markets</p>
        <Heading level={5} className="mt-1">Auction prices · $/cwt</Heading>
      </div>

      {result.status === 'data_unavailable' && (
        <p className="font-dm-sans text-[16px] text-ink">Auction data temporarily unavailable — check back shortly.</p>
      )}
      {result.status === 'no_coverage' && (
        <p className="font-dm-sans text-[16px] text-ink">{NO_LOCAL_LINE} — Montana barns today, expanding.</p>
      )}
      {result.status === 'no_recent_sale' && (
        <p className="font-dm-sans text-[16px] text-ink">
          No recent sale reported at {result.barnName} ({result.town}) — last sale {fmtDate(result.lastSale)}. Montana barns run lighter summer schedules.
        </p>
      )}

      {result.status === 'ok' && (
        <>
          {/* Block 2.6A — beyond the discovery radius the card says so FIRST, then offers
              the barn as a regional reference with its state and straight-line miles. */}
          {result.beyondHaul && !result.pinned && (
            <p className="mb-2 font-dm-sans text-[16px] text-ink">{NO_LOCAL_LINE}.</p>
          )}
          {/* Scope — the barn, never a county. */}
          <p className="font-dm-sans text-[16px] font-semibold text-forest-green">
            {scopeLabel(
              result.pinned ? { kind: 'pinned', town: shortTown(result.town) }
              : result.beyondHaul ? { kind: 'reference', town: result.town, miles: result.miles }
              : { kind: 'nearby', town: shortTown(result.town) },
            )}
          </p>
          <p className="mt-0.5 font-dm-sans text-[16px] text-ink">
            <ReportEvidence barn={result.barnName} date={result.saleDate} head={result.receipts} slug={result.slugId} /> · ~{result.miles} mi ({DISTANCE_BASIS})
          </p>

          <ul className="mt-3 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">
            {result.bands.map(b => <BandLine key={`steers-${b.band}`} cls="Steers" b={b} />)}
            {result.classes.map(c => c.bands.map(b => <BandLine key={`${c.label}-${b.band}`} cls={c.label} b={b} />))}
          </ul>

          {(result.cullCows.length > 0 || result.slaughterBulls.length > 0) && (
            <div className="mt-4">
              <p className={EYEBROW}>Culls · slaughter prices, not breeding value · $/cwt</p>
              <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">
                {result.cullCows.map(c => <CullLine key={`cow-${c.grade}`} c={c} kind="cows" />)}
                {result.slaughterBulls.map(c => <CullLine key={`bull-${c.grade}`} c={c} kind="bulls" />)}
              </ul>
            </div>
          )}

          {result.receipts != null && (
            <p className="mt-3 font-dm-sans text-[16px] tabular-nums text-ink">
              {fmtInt(result.receipts)} receipts
              {result.receiptsWeekAgo != null && ` · wk ago ${fmtInt(result.receiptsWeekAgo)}`}
              {result.receiptsYearAgo != null && ` · yr ago ${fmtInt(result.receiptsYearAgo)}`}
            </p>
          )}
        </>
      )}
    </Card>
  )
}
