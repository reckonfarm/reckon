import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { LocalAuctionResult, BandRead, CullRead } from '@/lib/local-auction-service'
import { marketDelta } from '@/lib/market-direction'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { isThin, thinEvidence } from '@/lib/market-scope'
import Disclosure from '@/app/components/ui/Disclosure'
import type { ReactNode } from 'react'
import type { LotClass } from '@/lib/herd'

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

interface BoardDef { key: string; audit: string; heading: string; body: ReactNode; forClass: LotClass[] }

function Board({ b }: { b: BoardDef }) {
  return (
    <div data-audit={b.audit}>
      <p className={EYEBROW}>{b.heading}</p>
      {b.body}
    </div>
  )
}

export default function LocalAuctionCard({ result, lotClass = null }: { result: LocalAuctionResult; lotClass?: LotClass | null }) {
  // Block 7C — THE BOARDS, and nothing else. The barn, the sale date, the
  // receipts, the scope fallback and the Report link all moved up into
  // ReportedSale, which states them once directly under the hero.
  //
  // COLLAPSED TO THE CLASS IN VIEW. At 1,451px on a 5,389px page these boards
  // were the single largest object on Markets — 27% at 390 and 31% at 320 —
  // and four of the five were classes this rancher had not selected. The board
  // matching the selected lot stays open; the rest sit behind one tap that
  // SAYS HOW MANY ("5 more classes"), so what is hidden is counted rather than
  // merely absent.
  //
  // NO BAND IS EVER DROPPED. A band with no reported head is information — it
  // says that class did not sell here this week — and removing it silently is
  // the false-zero problem 7.2 just fixed in the snapshot writer, wearing
  // different clothes. Collapsing moves boards behind a tap; it removes none,
  // and no row inside any board is filtered.
  if (result.status !== 'ok') return null   // ReportedSale carries the honest states

  const heifers = result.classes.filter(c => c.bands.length > 0 && c.label === 'Heifers')
  const others = result.classes.filter(c => c.bands.length > 0 && c.label !== 'Heifers')

  // Every board, in the order they read, each tagged with the lot class it answers.
  const boards: BoardDef[] = [
    ...(result.bands.length > 0 ? [{
      key: 'steers', audit: 'board-feeder-steers', heading: 'Feeder steers · $/cwt',
      forClass: ['steers', 'yearlings'] as LotClass[],
      body: <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">{result.bands.map(b => <BandLine key={`steers-${b.band}`} cls="Steers" b={b} />)}</ul>,
    }] : []),
    ...heifers.map(c => ({
      key: `h-${c.label}`, audit: 'board-heifers', heading: 'Feeder heifers · $/cwt',
      forClass: ['heifers'] as LotClass[],
      body: <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">{c.bands.map(b => <BandLine key={`${c.label}-${b.band}`} cls="Heifers" b={b} />)}</ul>,
    })),
    ...others.map(c => ({
      key: `o-${c.label}`, audit: `board-${c.label.toLowerCase().replace(/\s+/g, '-')}`, heading: `${c.label} · $/cwt`,
      forClass: (/bull/i.test(c.label) ? ['bulls'] : []) as LotClass[],
      body: <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">{c.bands.map(b => <BandLine key={`${c.label}-${b.band}`} cls={c.label} b={b} />)}</ul>,
    })),
    ...(result.cullCows.length > 0 ? [{
      key: 'cull', audit: 'board-cull-cows', heading: 'Cull cows · slaughter prices, not breeding value · $/cwt',
      forClass: ['cows', 'old_cows'] as LotClass[],
      body: <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">{result.cullCows.map(c => <CullLine key={`cow-${c.grade}`} c={c} kind="cows" />)}</ul>,
    }] : []),
    ...(result.slaughterBulls.length > 0 ? [{
      key: 'bulls', audit: 'board-slaughter-bulls', heading: 'Slaughter bulls · slaughter prices, not breeding value · $/cwt',
      forClass: ['bulls'] as LotClass[],
      body: <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">{result.slaughterBulls.map(c => <CullLine key={`bull-${c.grade}`} c={c} kind="bulls" />)}</ul>,
    }] : []),
  ]

  // The lead is the board answering the selected lot's class. With no lot, or a
  // class no board covers, the first board leads — the page never opens with
  // everything hidden behind a tap.
  const leadIdx = Math.max(0, boards.findIndex(b => lotClass != null && b.forClass.includes(lotClass)))
  const lead = boards[leadIdx]
  const rest = boards.filter((_, i) => i !== leadIdx)

  return (
    <Card shadow="soft" className="p-4 sm:p-6" data-audit="auction-card">
      <div className="mb-3">
        <p className={EYEBROW}>Other cattle markets</p>
        <Heading level={3} visual={5} className="mt-1">Other cattle markets · $/cwt</Heading>
      </div>
      {lead && <Board b={lead} />}
      {rest.length > 0 && (
        <Disclosure
          className="mt-4"
          title={`${rest.length} more ${rest.length === 1 ? 'class' : 'classes'}`}
          audit="more-classes"
          remember="more-classes"
          summary={rest.map(b => b.heading.split(' · ')[0]).join(' · ')}
        >
          <div className="space-y-4">
            {rest.map(b => <Board key={b.key} b={b} />)}
          </div>
        </Disclosure>
      )}
    </Card>
  )
}
