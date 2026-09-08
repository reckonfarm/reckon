import Link from 'next/link'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import ReportEvidence from '@/app/components/ReportEvidence'
import type { HerdEstimate, LotValuation } from '@/lib/herd-estimate'
import type { TrendData } from '@/lib/trend'
import type { Lot } from '@/lib/herd'
import { LOT_CLASS_LABELS, lotLabel } from '@/lib/herd'
import { dollarsPerCwtMove, THIN_HEAD_THRESHOLD } from '@/lib/market-scope'
import LotSelector from './LotSelector'
import { LotCard } from './HerdEstimatePanel'

// ─── Market comparisons for my cattle (Block 6B, commit 2) ────────────────────
// Replaces "Herd value" and its summed dollars. One qualified row per lot: the
// value, "Reference sale: N head" (· limited sample under the threshold), the
// report date, and the BASIS when the lot's purpose is replacements or
// breeding — a feeder or slaughter reference, never a breeding value. An
// "Illustrative gross total" renders only when every priced lot clears the
// sample threshold and shares purpose and price basis; rounded; its parts one
// tap away; labeled "Gross comparison at reported prices". A range is never
// invented from a thin sample: a thin lot shows the one reported price applied
// to it, flagged. "What changed" separates the comparable's price movement from
// the lot's own edits (two lines when both moved); with fewer than two report
// dates it says when history begins — no per-lot dollar history exists.

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const usdRounded = (n: number) => '$' + (Math.round(n / 100) * 100).toLocaleString('en-US')
const fmtShort = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const fmtStamp = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' })

// The basis line, keyed off lot.purpose (055). Unknown purpose → no claim.
export function basisLine(lot: Lot | undefined, v: LotValuation): string | null {
  if (!lot?.purpose || !v.source) return null
  if (lot.purpose !== 'replacements' && lot.purpose !== 'breeding') return null
  if (v.source.cull) return `${lot.class === 'bulls' ? 'Slaughter bull' : 'Slaughter cow'} reference — not a breeding value`
  const cls = lot.class === 'heifers' ? 'Feeder heifer' : lot.class === 'steers' || lot.class === 'yearlings' ? 'Feeder steer' : `${LOT_CLASS_LABELS[lot.class]} market`
  return `${cls} reference — not a breeding value`
}

export interface ReportDate { label: string; date: string }

export default function MarketComparisons({ estimate, lots, trend, selectedLotId, area, reports, titled = true }: {
  estimate: HerdEstimate
  lots: Lot[]
  trend: TrendData | null
  selectedLotId: string | null
  area: string
  reports: ReportDate[]
  titled?: boolean
}) {
  const byId = new Map(lots.map(l => [l.id, l]))
  const priced = estimate.perLot.filter(l => l.value != null && l.source)
  const sel = (selectedLotId && estimate.perLot.find(l => l.lotId === selectedLotId)) || estimate.perLot[0] || null
  // The gross total: only when every priced lot clears the sample and they share purpose and basis.
  const clear = priced.length > 0 && priced.every(l => !l.thin)
  const purposes = new Set(priced.map(l => byId.get(l.lotId)?.purpose ?? 'unknown'))
  const bases = new Set(priced.map(l => l.source!.price_basis))
  const grossOk = clear && purposes.size === 1 && !purposes.has('unknown') && bases.size === 1
  const gross = grossOk ? priced.reduce((s, l) => s + (l.value ?? 0), 0) : null
  // Sensitivity across the lots that price by the hundredweight — arithmetic on head × weight.
  const cwtLots = priced.filter(l => l.source!.price_basis === 'cwt')
  const perDollar = cwtLots.reduce((s, l) => s + (dollarsPerCwtMove(l.head_count, l.avg_weight_lb) ?? 0), 0)
  const sensitivity = perDollar > 0 ? `Every $1/cwt move is $${perDollar.toLocaleString('en-US')} across ${cwtLots.length === 1 ? 'this lot' : `${cwtLots.length} lots`}.` : null
  const sources = [...new Map(priced.map(l => [l.source!.slug_id, l.source!])).values()]
  const latestReport = trend?.reportDate ?? estimate.as_of ?? null

  return (
    <>
      <div>
        {titled ? <h1 className="type-page-heading text-ink" data-audit="markets-title">Markets · {area}</h1> : <p className="type-page-heading text-ink" data-audit="markets-title">Markets · {area}</p>}
        {reports.length > 0 && (
          <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink" data-audit="markets-report-dates">
            Latest reports: {reports.map((r, i) => <span key={r.label}>{i > 0 && ' · '}{r.label} {fmtShort(r.date)}</span>)}
          </p>
        )}
      </div>

      {/* What changed for my cattle — the comparable's movement, and the lot's own edits, apart. */}
      {estimate.perLot.length > 0 && (
        <Card shadow="none" className="px-5 py-4" data-audit="what-changed">
          <p className={EYEBROW}>What changed for my cattle</p>
          <ul className="mt-2 divide-y divide-rule">
            {estimate.perLot.map(v => {
              const lot = byId.get(v.lotId)
              const delta = trend?.priceDeltas.find(d => d.label === v.label) ?? null
              const edited = lot && latestReport && lot.updated_at > `${latestReport}T23:59:59Z` ? fmtStamp(lot.updated_at) : null
              let market: React.ReactNode
              if (!v.source) market = <span>Not priced this week{v.reason ? ` — ${v.reason}` : ''}</span>
              else if (delta?.status === 'ready' && delta.cwt != null && delta.sinceDate) {
                const c = delta.cwt
                market = c === 0
                  ? <span>No change since {fmtShort(delta.sinceDate)}</span>
                  : <span><span aria-hidden>{c > 0 ? '▲' : '▼'}</span> {c > 0 ? 'Up' : 'Down'} ${Math.abs(c).toFixed(2)}/cwt at {v.source.barn_name} since {fmtShort(delta.sinceDate)}</span>
              } else if (trend?.historyFrom) market = <span>History begins {fmtShort(trend.historyFrom)}. New points appear when the reference changes.</span>
              else market = <span>One report so far. New points appear when the reference changes.</span>
              return (
                <li key={v.lotId} className="py-2 font-dm-sans text-[16px] text-ink" data-audit="changed-row">
                  <span className="font-semibold">{lot ? lotLabel(lot) : v.label}</span>
                  <span className="block" data-audit="changed-market">{market}</span>
                  {edited && <span className="block text-secondary-ink" data-audit="changed-edit">Head or weight edited {edited} — the comparison follows the edit, not the market.</span>}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {/* The comparisons — one qualified row per lot; a gross total only when it is honest. */}
      <Card shadow="none" className="px-5 py-4" data-audit="herd-value-card">
        <p className={EYEBROW}>Market comparisons for {estimate.lots_total} {estimate.lots_total === 1 ? 'lot' : 'lots'}</p>
        {priced.length === 0 ? (
          <p className="mt-1.5 font-dm-sans text-[17px] text-ink">{estimate.note}</p>
        ) : (
          <ul className="mt-2 divide-y divide-rule" data-audit="comparison-rows">
            {estimate.perLot.map(v => {
              const lot = byId.get(v.lotId)
              const src = v.source
              const basis = basisLine(lot, v)
              return (
                <li key={v.lotId} className="flex items-start justify-between gap-3 py-2" data-audit="comparison-row">
                  <div className="min-w-0 font-dm-sans text-[16px] text-ink">
                    <p className="font-semibold">{lot ? lotLabel(lot) : v.label}</p>
                    {src ? (
                      <>
                        <p className="text-secondary-ink">
                          <span data-audit="reference-sale">Reference sale: {src.head_count != null ? `${src.head_count.toLocaleString('en-US')} head` : 'head not reported'}{v.thin ? ' · limited sample' : ''}</span>
                          {' · '}<ReportEvidence barn={src.barn_name} date={src.report_date} head={src.head_count} slug={src.slug_id} />
                        </p>
                        {basis && <p className="font-medium text-amber-900" data-audit="basis-line">{basis}</p>}
                        {src.cull && !basis && <p className="font-medium text-amber-900">Cull price — salvage, not breeding value</p>}
                      </>
                    ) : (
                      <p className="text-secondary-ink">{v.reason ?? 'Not priced this week'}</p>
                    )}
                  </div>
                  <p className="shrink-0 text-right font-dm-sans text-[17px] font-semibold tabular-price text-ink" data-audit="comparison-value">
                    {v.value != null ? usd(v.value) : '—'}
                    {src && <span className="block text-[14px] font-normal text-secondary-ink">${src.avg_price}/{src.price_basis === 'cwt' ? 'cwt' : 'hd'} reported</span>}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
        {gross != null && (
          <details className="mt-3" data-audit="gross-total">
            <summary className="cursor-pointer font-dm-sans text-[17px] font-semibold text-ink">
              Illustrative gross total {usdRounded(gross)} <span className="font-normal text-secondary-ink">· Gross comparison at reported prices</span>
            </summary>
            <ul className="mt-2 font-dm-sans text-[15px] text-secondary-ink">
              {priced.map(l => <li key={l.lotId}>{byId.get(l.lotId) ? lotLabel(byId.get(l.lotId)!) : l.label}: {usd(l.value!)} at ${l.source!.avg_price}/{l.source!.price_basis === 'cwt' ? 'cwt' : 'hd'}, {l.source!.head_count ?? '?'} head reported</li>)}
              <li className="mt-1">Rounded to the nearest $100. Every lot here clears {THIN_HEAD_THRESHOLD} reported head and shares a purpose and a price basis; otherwise no total is shown.</li>
            </ul>
          </details>
        )}
        {gross == null && priced.length > 1 && (
          <p className="mt-3 font-dm-sans text-[15px] text-secondary-ink" data-audit="no-gross">No gross total: {!clear ? `a lot is priced off fewer than ${THIN_HEAD_THRESHOLD} reported head` : purposes.has('unknown') ? 'a lot has no purpose set' : purposes.size > 1 ? 'the lots serve different purposes' : 'the lots price on different bases'}.</p>
        )}
        {sensitivity && <p className="mt-2 font-dm-sans text-[16px] font-medium text-forest-green">{sensitivity}</p>}
        {sources.length > 0 && (
          <p className="mt-1 font-dm-sans text-[15px] text-secondary-ink">Priced at {sources.map((s, i) => <span key={s.slug_id}>{i > 0 && ' · '}<ReportEvidence barn={s.barn_name} date={s.report_date} head={s.head_count} slug={s.slug_id} /></span>)}</p>
        )}
        <p className="mt-2"><Link href="/ranch/cattle" className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">Edit lots under Ranch → Cattle</Link></p>
      </Card>

      {/* The selected lot's own comparison — the selector honors ?lot=. */}
      {sel && (
        <div data-audit="lot-comparison">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={EYEBROW}>Comparison for one lot</p>
            <LotSelector lots={estimate.perLot.map(l => ({ id: l.lotId, label: byId.get(l.lotId) ? lotLabel(byId.get(l.lotId)!) : l.label }))} selectedId={sel.lotId} />
          </div>
          <div className="mt-2">
            <LotCard l={sel} />
            {basisLine(byId.get(sel.lotId), sel) && <p className="mt-1 font-dm-sans text-[16px] font-medium text-amber-900" data-audit="basis-line-selected">{basisLine(byId.get(sel.lotId), sel)}</p>}
          </div>
        </div>
      )}
    </>
  )
}
