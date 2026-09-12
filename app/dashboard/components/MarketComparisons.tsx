import Link from 'next/link'
import { Card } from '@/app/components/ui/Card'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import type { HerdEstimate, LotValuation } from '@/lib/herd-estimate'
import type { TrendData } from '@/lib/trend'
import type { Lot } from '@/lib/herd'
import { LOT_CLASS_LABELS, lotLabel } from '@/lib/herd'
import { sensitivityLine, STALE_MARKER, THIN_HEAD_THRESHOLD } from '@/lib/market-scope'
import LotSelector from './LotSelector'
import { LotCard } from './HerdEstimatePanel'

// ─── Your cattle · What changed (Block 6B, restructured in 7C) ────────────────
//
// TWO sections, rendered separately by `part`, because 7C's order puts them at
// opposite ends of the page: "Your cattle" is the top of Markets and "What
// changed" sits below the price history, merged with the since-you-last-checked
// lines.
//
// THE HERO IS THE LOT'S VALUE. It used to be $403/cwt for the 500-599 lb steer
// class, 1,700px above $397,564 for this rancher's actual steers — two framings
// of one question, two screens apart. The class price is a fact that exists
// whether or not he owns a cow; the ledger exists so the page can say the other
// one. So the lot value leads, its own $/cwt sits beneath it as its unit, and
// the class reference moved inside "How this is figured" — available, not
// competing.
//
// ONE LOT AT A TIME, with the select beneath it. Not three stacked heroes: a
// stack turns the page back into a list, and it edges toward the summed total
// the no-gross rule forbids. Every lot still appears in "What changed" with its
// own movement, so nothing is hidden — only unstacked.
//
// NO GROSS TOTAL, ever, in this layout. The "Illustrative gross total"
// disclosure is gone. The no-gross SENTENCE stays, beside the select, because
// that is where a reader learns there are other lots and might expect a sum.
//
// EVIDENCE ONCE. The per-row barn/date/head/Report line is ReportedSale's now.
// What survives here is 6I's exception: a lot priced at a barn OTHER than the
// page's names its own, because that is the case a reader must not miss.

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

const usdAbout = (n: number) => (Math.abs(n) >= 10_000 ? `$${Math.round(n / 1000)}k` : usdRounded(n))
const shortTown = (t: string) => t.replace(/,\s*[A-Z]{2}$/, '')

export default function MarketComparisons({ estimate, lots, trend, selectedLotId, area, localSlug = null, part = 'cattle', stale = false }: {
  estimate: HerdEstimate
  lots: Lot[]
  trend: TrendData | null
  selectedLotId: string | null
  area: string
  localSlug?: string | null   // 6I: the barn the page is scoped to — a lot priced elsewhere says so
  part?: 'cattle' | 'changed' // 7C: the two halves sit at opposite ends of the page
  stale?: boolean             // 7C: the page's reference is past FRESH_DAYS — the hero says so
}) {
  const byId = new Map(lots.map(l => [l.id, l]))
  const priced = estimate.perLot.filter(l => l.value != null && l.source)
  const sel = (selectedLotId && estimate.perLot.find(l => l.lotId === selectedLotId)) || estimate.perLot[0] || null
  // The gross total: only when every priced lot clears the sample and they share purpose and basis.
  const clear = priced.length > 0 && priced.every(l => !l.thin)
  const purposes = new Set(priced.map(l => byId.get(l.lotId)?.purpose ?? 'unknown'))
  const bases = new Set(priced.map(l => l.source!.price_basis))
  const latestReport = trend?.reportDate ?? estimate.as_of ?? null

  const selLot = sel ? byId.get(sel.lotId) : undefined
  const selSrc = sel?.source ?? null
  const selDelta = sel ? (trend?.priceDeltas.find(d => d.label === sel.label) ?? null) : null
  // The note explains why a total would have been DISHONEST. When the lots
  // would in fact have qualified, there is no reason to state — this layout
  // simply does not offer a total, which is a choice about the page, not a
  // claim about the data. Saying "No gross total: the lots price on different
  // bases" when they share one would be a false reason, so the note is gated
  // on the same test that used to gate the total itself.
  const grossOk = clear && purposes.size === 1 && !purposes.has('unknown') && bases.size === 1
  const noGross = priced.length > 1 && !grossOk
    ? `No gross total: ${!clear ? `a lot is priced off fewer than ${THIN_HEAD_THRESHOLD} reported head` : purposes.has('unknown') ? 'a lot has no purpose set' : purposes.size > 1 ? 'the lots serve different purposes' : 'the lots price on different bases'}.`
    : null

  // ── What changed ───────────────────────────────────────────────────────────
  // Every lot, with the reference's movement and the lot's own edits kept apart
  // (6I). Unchanged in substance; it is only rendered somewhere else now, and
  // it drops the barn name when that barn is the page's — the same rule Price
  // history follows.
  if (part === 'changed') {
    if (estimate.perLot.length === 0) return null
    return (
      <ul className="divide-y divide-rule" data-audit="changed-rows">
        {estimate.perLot.map(v => {
          const lot = byId.get(v.lotId)
          const delta = trend?.priceDeltas.find(d => d.label === v.label) ?? null
          const edited = lot && latestReport && lot.updated_at > `${latestReport}T23:59:59Z` ? fmtStamp(lot.updated_at) : null
          const at = v.source && localSlug && v.source.slug_id !== localSlug ? ` at ${shortTown(v.source.town)}` : ''
          let market: React.ReactNode
          if (!v.source) market = <span>Not priced this week{v.reason ? ` — ${v.reason}` : ''}</span>
          else if (delta?.status === 'ready' && delta.cwt != null && delta.sinceDate) {
            const c = delta.cwt
            market = c === 0
              ? <span>No change since {fmtShort(delta.sinceDate)}</span>
              : <span><span aria-hidden>{c > 0 ? '▲' : '▼'}</span> {c > 0 ? 'Up' : 'Down'} ${Math.abs(c).toFixed(2)}/cwt{at} since {fmtShort(delta.sinceDate)}</span>
          } else if (trend?.historyFrom) market = <span>History begins {fmtShort(trend.historyFrom)}. New points appear when the reference changes.</span>
          else market = <span>One report so far. New points appear when the reference changes.</span>
          return (
            <li key={v.lotId} className="py-2 font-dm-sans text-[16px] text-ink" data-audit="changed-row">
              <span className="font-semibold">{lot ? lotLabel(lot) : v.label}</span>
              <span className="block" data-audit="changed-market"><span className="font-medium text-secondary-ink">Market reference: </span>{market}</span>
              {edited && <span className="block text-secondary-ink" data-audit="changed-edit"><span className="font-medium">Your lot changed: </span>head or weight edited {edited} — this comparison reflects the edit.</span>}
            </li>
          )
        })}
      </ul>
    )
  }

  // ── Your cattle — the hero ─────────────────────────────────────────────────
  return (
    <section aria-labelledby="your-cattle-h" data-audit="your-cattle">
      <h2 id="your-cattle-h" className={`${EYEBROW} !text-ink`}>Your cattle</h2>
      <Card shadow="none" className="mt-2 px-5 py-4" data-audit="herd-value-card">
        {!sel || priced.length === 0 ? (
          <p className="font-dm-sans text-[17px] text-ink">{estimate.note}</p>
        ) : (
          <>
            <p className="font-dm-sans text-[17px] font-semibold text-ink" data-audit="lot-subject">
              {selLot ? lotLabel(selLot) : sel.label}
              {sel.head_count ? ` · ${sel.head_count.toLocaleString('en-US')} head` : ''}
              {sel.avg_weight_lb ? ` · ${sel.avg_weight_lb.toLocaleString('en-US')} lb` : ''}
            </p>

            {/* THE number this page exists to say. */}
            <p className="type-main-number text-ink" data-audit="lot-value">
              {sel.value != null ? (sel.thin ? <span data-audit="thin-about">about {usdAbout(sel.value)}</span> : usd(sel.value)) : '—'}
            </p>

            {selSrc && (
              <p className="mt-0.5 font-dm-sans text-[16px] text-secondary-ink" data-audit="lot-unit">
                ${selSrc.avg_price}/{selSrc.price_basis === 'cwt' ? 'cwt' : 'hd'} reported
                {/* The reference is past FRESH_DAYS — the number must never read as today's. */}
                {stale && <span className="ml-2 font-semibold text-amber-900" data-audit="lot-stale">· {STALE_MARKER}</span>}
                {/* 6I's exception, and the only barn named outside ReportedSale. */}
                {localSlug && selSrc.slug_id !== localSlug && <span data-audit="own-source"> · priced at {shortTown(selSrc.town)}, not {area}</span>}
              </p>
            )}

            {selDelta?.status === 'ready' && selDelta.cwt != null && selDelta.sinceDate && (
              <p className="mt-0.5 font-dm-sans text-[16px] text-ink" data-audit="lot-change">
                {selDelta.cwt === 0
                  ? <>No change since {fmtShort(selDelta.sinceDate)}</>
                  : <><span aria-hidden>{selDelta.cwt > 0 ? '▲' : '▼'}</span> {selDelta.cwt > 0 ? 'Up' : 'Down'} ${Math.abs(selDelta.cwt).toFixed(2)}/cwt since {fmtShort(selDelta.sinceDate)}{sel.thin ? ' · a limited sample' : ''}</>}
              </p>
            )}

            {selSrc?.price_basis === 'cwt' && sensitivityLine(sel.head_count, sel.avg_weight_lb) && (
              <p className="mt-1 font-dm-sans text-[16px] font-medium text-forest-green" data-audit="sensitivity-line">{sensitivityLine(sel.head_count, sel.avg_weight_lb)}</p>
            )}

            {(() => { const b = basisLine(selLot, sel); return b ? <p className="mt-1 font-dm-sans text-[16px] font-medium text-amber-900" data-audit="basis-line">{b}</p> : selSrc?.cull ? <p className="mt-1 font-dm-sans text-[16px] font-medium text-amber-900">Cull price — salvage, not breeding value</p> : null })()}

            {/* The select, directly under the number it changes. */}
            <div className="mt-3">
              <LotSelector lots={estimate.perLot.map(l => ({ id: l.lotId, label: byId.get(l.lotId) ? lotLabel(byId.get(l.lotId)!) : l.label }))} selectedId={sel.lotId} />
            </div>
            {noGross && <p className="mt-1.5 font-dm-sans text-[15px] text-secondary-ink" data-audit="no-gross">{noGross}</p>}

            <details className="mt-3 font-dm-sans text-[16px] text-secondary-ink" data-audit="lot-calculation">
              <summary className="inline-flex min-h-[44px] cursor-pointer items-center underline underline-offset-2">How this is figured</summary>
              <div className="mt-1 space-y-2">
                {/* Ruling 1: the class price lives here now — the reference the
                    lot math starts from, stated as such, no longer a headline
                    competing with the lot's own value. */}
                {selSrc && (
                  <p data-audit="class-reference">
                    Class reference · {selSrc.mars_class ?? 'class'}{selSrc.exact_bracket ? ` · ${selSrc.matched.split(' / ').slice(-1)[0]}` : ' · class average, no exact bracket'} · <span className="tabular-price">${selSrc.avg_price}</span>/{selSrc.price_basis === 'cwt' ? 'cwt' : 'hd'} — the reported price this lot&rsquo;s value starts from.
                  </p>
                )}
                <LotCard l={sel} />
                {sel.thin && sel.value != null && selSrc && (
                  <p data-audit="thin-exact">{usd(sel.value)} = {sel.head_count.toLocaleString('en-US')} head × {selSrc.price_basis === 'cwt' ? `${sel.avg_weight_lb.toLocaleString('en-US')} lb ÷ 100 × $${selSrc.avg_price}/cwt` : `$${selSrc.avg_price}/head`} — one reported price off {selSrc.head_count ?? '?'} head, applied to this lot.</p>
                )}
              </div>
            </details>

            <p className="mt-2"><Link href="/ranch/cattle" className="inline-flex min-h-[48px] items-center font-dm-sans text-[16px] font-semibold text-brand underline underline-offset-2">Edit lots under Ranch → Cattle</Link></p>
          </>
        )}
      </Card>
    </section>
  )
}
