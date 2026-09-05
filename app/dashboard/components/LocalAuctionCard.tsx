import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { LocalAuctionResult, BandRead, CullRead } from '@/lib/local-auction-service'
import { marketDelta } from '@/lib/market-direction'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import { fmtRange, isThin, matchLabel, scopeLabel, THIN_HEAD_THRESHOLD } from '@/lib/market-scope'

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

function MatchChip({ label }: { label: string }) {
  const tone = label === 'Close match' ? 'bg-forest-green/[0.08] text-forest-green' : label === 'Broader reference' ? 'bg-forest-green/[0.05] text-forest-green/80' : 'bg-amber-50 text-amber-900 ring-1 ring-amber-200'
  return <span className={`rounded px-1.5 py-0.5 font-dm-sans text-[12px] font-semibold ${tone}`}>{label}</span>
}

// One band line: precise $/cwt only when the head count clears the floor.
function BandLine({ cls, b, saleDate }: { cls: string; b: BandRead; saleDate: string }) {
  const thin = isThin(b.head)
  const label = matchLabel({ exactBracket: true, headCount: b.head })
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3 font-dm-sans text-[16px]">
        <span className="text-forest-green">{cls} {bandLabel(b.band)}</span>
        <span className="shrink-0 tabular-nums">
          {thin ? (
            <span className="font-semibold text-forest-green/80">{fmtRange(b.priceLow, b.priceHigh, b.avgPrice)}</span>
          ) : (
            <span className="font-semibold text-ink">${b.avgPrice.toFixed(2)}</span>
          )}
          {!thin && b.wowPct != null && b.wowPct !== 0 && (() => {
            const d = marketDelta(b.wowPct! > 0, true)
            return <span className={`ml-2 text-[13px] font-semibold ${d.cls}`}>{d.arrow} {Math.abs(b.wowPct!).toFixed(1)}%</span>
          })()}
        </span>
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-dm-sans text-[13px] text-forest-green/80">
        <MatchChip label={label} />
        <span>{fmtInt(b.head)} head reported · sale {fmtDate(saleDate)}</span>
        {thin && <span>· under {THIN_HEAD_THRESHOLD} head, range shown</span>}
      </p>
    </li>
  )
}

function CullLine({ c, kind, saleDate }: { c: CullRead; kind: 'cows' | 'bulls'; saleDate: string }) {
  const thin = isThin(c.head)
  const name = kind === 'cows'
    ? (c.gradeKnown ? `${c.grade} cows` : 'Cull cows (grade not captured)')
    : (c.gradeKnown && c.grade !== 'All' ? `Slaughter bulls · yield ${c.grade}` : 'Slaughter bulls')
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3 font-dm-sans text-[16px]">
        <span className="text-forest-green">{name}</span>
        <span className="shrink-0 tabular-nums font-semibold">
          {thin ? <span className="text-forest-green/80">{fmtRange(c.priceLow, c.priceHigh, c.avgPrice)}</span> : <span className="text-ink">${c.avgPrice.toFixed(2)}</span>}
        </span>
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-dm-sans text-[13px] text-forest-green/80">
        <MatchChip label={matchLabel({ exactBracket: c.gradeKnown, headCount: c.head })} />
        <span>
          {fmtInt(c.head)} head · {c.rows} {c.rows === 1 ? 'lot' : 'lots'}
          {c.avgWeight != null ? ` · ~${fmtInt(c.avgWeight)} lb live` : ''}
          {c.dressing ? ` · ${c.dressing.toLowerCase()} dressing` : ''}
          {' · '}sale {fmtDate(saleDate)}
        </span>
        {thin && <span>· under {THIN_HEAD_THRESHOLD} head, range shown</span>}
      </p>
    </li>
  )
}

export default function LocalAuctionCard({ result }: { result: LocalAuctionResult }) {
  return (
    <Card shadow="soft" className="p-4 sm:p-6">
      <div className="mb-3">
        <p className={EYEBROW}>Cattle markets</p>
        <Heading level={5} className="mt-1">Auction reference</Heading>
      </div>

      {result.status === 'data_unavailable' && (
        <p className="font-dm-sans text-[16px] text-forest-green/80">Auction data temporarily unavailable — check back shortly.</p>
      )}
      {result.status === 'no_coverage' && (
        <p className="font-dm-sans text-[16px] text-forest-green/80">No reporting auction within haul distance — Montana barns today, expanding.</p>
      )}
      {result.status === 'no_recent_sale' && (
        <p className="font-dm-sans text-[16px] text-forest-green/80">
          No recent sale reported at {result.barnName} ({result.town}) — last sale {fmtDate(result.lastSale)}. Montana barns run lighter summer schedules.
        </p>
      )}

      {result.status === 'ok' && (
        <>
          {/* Scope — the barn, never a county. */}
          <p className="font-dm-sans text-[15px] font-semibold text-forest-green">
            {scopeLabel(result.pinned ? { kind: 'pinned', town: result.town.replace(/,\s*[A-Z]{2}$/, '') } : { kind: 'nearby', town: result.town.replace(/,\s*[A-Z]{2}$/, '') })}
          </p>
          <p className="mt-0.5 font-dm-sans text-[14px] text-forest-green/80">
            {result.barnName} · {result.miles} mi · sale of {fmtDate(result.saleDate)} · USDA AMS report {result.slugId}
            {result.beyondHaul && !result.pinned && ' · beyond typical haul, shown for reference'}
          </p>

          <ul className="mt-3 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">
            {result.bands.map(b => <BandLine key={`steers-${b.band}`} cls="Steers" b={b} saleDate={result.saleDate} />)}
            {result.classes.map(c => c.bands.map(b => <BandLine key={`${c.label}-${b.band}`} cls={c.label} b={b} saleDate={result.saleDate} />))}
          </ul>

          {(result.cullCows.length > 0 || result.slaughterBulls.length > 0) && (
            <div className="mt-4">
              <p className={EYEBROW}>Culls · slaughter prices, not breeding value</p>
              <ul className="mt-1 divide-y divide-forest-green/[0.08] border-t border-forest-green/[0.08]">
                {result.cullCows.map(c => <CullLine key={`cow-${c.grade}`} c={c} kind="cows" saleDate={result.saleDate} />)}
                {result.slaughterBulls.map(c => <CullLine key={`bull-${c.grade}`} c={c} kind="bulls" saleDate={result.saleDate} />)}
              </ul>
            </div>
          )}

          {result.receipts != null && (
            <p className="mt-3 font-dm-sans text-[13px] tabular-nums text-forest-green/80">
              {fmtInt(result.receipts)} receipts
              {result.receiptsWeekAgo != null && ` · wk ago ${fmtInt(result.receiptsWeekAgo)}`}
              {result.receiptsYearAgo != null && ` · yr ago ${fmtInt(result.receiptsYearAgo)}`}
            </p>
          )}
          <p className="mt-2 font-dm-sans text-[13px] text-forest-green/80">
            $/cwt, head-weighted within each 100-lb band · Close match = same class and weight bracket with {THIN_HEAD_THRESHOLD}+ head · Limited evidence = fewer than {THIN_HEAD_THRESHOLD} head reported.
          </p>
        </>
      )}
    </Card>
  )
}
