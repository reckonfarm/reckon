import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { LocalAuctionResult, BandRead, CullRead } from '@/lib/local-auction-service'
import { marketDelta } from '@/lib/market-direction'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { isThin, thinEvidence } from '@/lib/market-scope'

// ─── Other cattle markets — the boards (Block 2.5 Part A, reduced in 7C) ──────
// The classes a rancher opens the page to check: feeder steers, feeder
// heifers, feeder bulls, cull cows, slaughter bulls. A band backed by fewer
// than THIN_HEAD_THRESHOLD head shows its reported range and the thin label,
// never a cents-precise figure. Cull cows and bulls are kept distinct by grade
// and never blended with feeders; a slaughter-bull price is a salvage figure
// and is labeled so.
//
// The barn, the sale date, the receipts, the scope fallback and the Report
// link left this file in 7C — they are ReportedSale's now, stated once under
// the hero instead of a seventh time down here.

function bandLabel(band: string): string {
  const lo = parseInt(band, 10)
  return `${lo}–${lo + 99} lb`
}
const fmtInt = (n: number) => n.toLocaleString('en-US')


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
    ? (c.gradeKnown ? `${c.grade} cows` : 'Cull cows · Grade unavailable')
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
  // Block 7C — THE BOARDS, and nothing else. The barn, the sale date, the
  // receipts, the scope fallback and the Report link all moved up into
  // ReportedSale, which states them once directly under the hero. This card
  // used to restate the barn in its own title and carry a "Sale detail ▾"
  // disclosure holding a seventh copy of the same evidence — with the feeder
  // bulls board hidden inside it, for no reason anyone could name.
  //
  // So the disclosure is gone and feeder bulls joins the other four boards in
  // the open. Small-sample and slaughter-not-breeding labels stay on their own
  // rows, where they always were: those qualify a number and travel with it.
  if (result.status !== 'ok') return null   // ReportedSale carries the honest states

  const otherClasses = result.classes.filter(c => c.bands.length > 0 && c.label !== 'Heifers')
  const heifers = result.classes.filter(c => c.bands.length > 0 && c.label === 'Heifers')

  return (
    <Card shadow="soft" className="p-4 sm:p-6" data-audit="auction-card">
      <div className="mb-3">
        <p className={EYEBROW}>Other cattle markets</p>
        <Heading level={3} visual={5} className="mt-1">Other cattle markets · $/cwt</Heading>
      </div>

      {result.bands.length > 0 && (
        <div data-audit="board-feeder-steers">
          <p className={EYEBROW}>Feeder steers · $/cwt</p>
          <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">
            {result.bands.map(b => <BandLine key={`steers-${b.band}`} cls="Steers" b={b} />)}
          </ul>
        </div>
      )}
      {heifers.map(c => (
        <div key={c.label} className="mt-4" data-audit="board-heifers">
          <p className={EYEBROW}>Feeder heifers · $/cwt</p>
          <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">
            {c.bands.map(b => <BandLine key={`${c.label}-${b.band}`} cls="Heifers" b={b} />)}
          </ul>
        </div>
      ))}
      {otherClasses.map(c => (
        <div key={c.label} className="mt-4" data-audit={`board-${c.label.toLowerCase().replace(/\s+/g, '-')}`}>
          <p className={EYEBROW}>{c.label} · $/cwt</p>
          <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">
            {c.bands.map(b => <BandLine key={`${c.label}-${b.band}`} cls={c.label} b={b} />)}
          </ul>
        </div>
      ))}
      {result.cullCows.length > 0 && (
        <div className="mt-4" data-audit="board-cull-cows">
          <p className={EYEBROW}>Cull cows · slaughter prices, not breeding value · $/cwt</p>
          <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">
            {result.cullCows.map(c => <CullLine key={`cow-${c.grade}`} c={c} kind="cows" />)}
          </ul>
        </div>
      )}
      {result.slaughterBulls.length > 0 && (
        <div className="mt-4" data-audit="board-slaughter-bulls">
          <p className={EYEBROW}>Slaughter bulls · slaughter prices, not breeding value · $/cwt</p>
          <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">
            {result.slaughterBulls.map(c => <CullLine key={`bull-${c.grade}`} c={c} kind="bulls" />)}
          </ul>
        </div>
      )}
    </Card>
  )
}
