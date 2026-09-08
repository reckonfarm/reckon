'use client'

import { Card } from '@/app/components/ui/Card'
import type { LotValuation } from '@/lib/herd-estimate'
import type { TrendData } from '@/lib/trend'
import type { OutlookData, OutlookLot } from '@/lib/outlook'
import { EYEBROW } from '@/app/components/ui/Eyebrow'
import ReportEvidence from '@/app/components/ReportEvidence'
import { matchLabel, scopeLabel, sensitivityLine, thinEvidence, THIN_HEAD_THRESHOLD } from '@/lib/market-scope'

// The HerdEstimate display — hero number (the one place boldness is spent: large Fraunces) +
// a Now/Trend/Outlook Segmented toggle. Everything but the hero is quiet DM Sans / tabular.
// Fed the server-computed estimate + trend bundle (both serializable); the toggle is the only
// interactive bit. Honest throughout: unpriced lots show "—" not $0; accruing Trend metrics
// show their honest "building" line, never a fake/zero delta.


function MatchChip({ label }: { label: string }) {
  const tone = label === 'Close match' ? 'bg-forest-green/[0.08] text-forest-green' : label === 'Broader reference' ? 'bg-forest-green/[0.05] text-ink' : 'bg-amber-50 text-amber-900 border border-amber-200'
  return <span className={`rounded-lg px-1.5 py-0.5 font-dm-sans text-[16px] font-semibold ${tone}`}>{label}</span>
}
function formatUSD(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}
function fmtThinRange(low: number, high: number): string {
  return Math.round(low) === Math.round(high) ? `~${formatUSD(low)}` : `${formatUSD(low)}–${formatUSD(high)}`
}

function fmtShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// raw 'MM/DD/YYYY' (LRP endorsement end date) → "Sep 16"
function fmtEndDate(mmddyyyy: string): string {
  const m = mmddyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return mmddyyyy
  const d = new Date(`${m[3]}-${m[1]}-${m[2]}T00:00:00`)
  return Number.isNaN(d.getTime()) ? mmddyyyy : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// 'YYYY-MM' (sale window) → "Sep"
function fmtMonth(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/)
  if (!m) return ym
  const d = new Date(`${m[1]}-${m[2]}-01T00:00:00`)
  return Number.isNaN(d.getTime()) ? ym : d.toLocaleDateString('en-US', { month: 'short' })
}

// "Billings cash · as of Jun 11 · 1 of 1 lot priced" — or, when nothing priced, the honest note.

// Every $1/cwt across the firm-priced per-cwt lots — exact arithmetic, or nothing.

export function LotCard({ l }: { l: LotValuation }) {
  const priced = l.value != null && l.source != null
  const src = l.source
  const label = src ? matchLabel({ exactBracket: src.exact_bracket, headCount: src.head_count }) : null
  const sens = src?.price_basis === 'cwt' ? sensitivityLine(l.head_count, l.avg_weight_lb) : null
  return (
    <Card shadow="sm" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-dm-sans text-[16px] font-semibold text-ink">{l.label}</p>
          {priced ? (
            <>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-dm-sans text-[16px] text-ink">
                <MatchChip label={label!} />
                {src!.cull && <span className="rounded-lg bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-900 border border-amber-200">Cull price — salvage, not breeding value</span>}
              </p>
              <p className="mt-1 font-dm-sans text-[16px] text-ink">
                {scopeLabel({ kind: 'nearby', town: src!.town.replace(/,\s*[A-Z]{2}$/, '') })} · <ReportEvidence barn={src!.barn_name} date={src!.report_date} head={src!.head_count} slug={src!.slug_id} />
              </p>
              <p className="font-dm-sans text-[16px] text-ink">
                {src!.mars_class ?? 'class'}{src!.exact_bracket ? ` · ${src!.matched.split(' / ').slice(-1)[0]}` : ' · class average, no exact bracket'} · {src!.head_count != null ? `${src!.head_count.toLocaleString('en-US')} head reported` : 'head count not reported'} ·{' '}
                {l.thin
                  ? (() => { const ev = thinEvidence(src!.avg_price_min, src!.avg_price_max, src!.avg_price, src!.head_count ?? 0, src!.price_basis === 'cwt' ? 'cwt' : 'hd'); return ev.single ? <>{ev.note}</> : <>{ev.figure}/{src!.price_basis === 'cwt' ? 'cwt' : 'hd'} reported range, not one price</> })()
                  : <><span className="tabular-price">${src!.avg_price}</span>/{src!.price_basis === 'cwt' ? 'cwt' : 'hd'}</>}
              </p>
              {sens && <p className="mt-1 font-dm-sans text-[16px] font-medium text-forest-green">{sens}</p>}
            </>
          ) : (
            <p className="mt-0.5 font-dm-sans text-[16px] text-ink">{l.reason}</p>
          )}
        </div>
        <p className="shrink-0 text-right font-dm-sans text-[17px] font-semibold tabular-price text-ink">
          {!priced ? '—' : l.thin
            ? <><span className="block text-[16px] font-medium text-ink">under {THIN_HEAD_THRESHOLD} head</span>{fmtThinRange(l.value_low!, l.value_high!)}</>
            : formatUSD(l.value!)}
        </p>
      </div>
    </Card>
  )
}

function Stub({ line }: { line: string }) {
  return (
    <Card shadow="sm" className="px-6 py-8 text-center">
      <p className="font-dm-sans text-[16px] font-semibold text-ink">We&rsquo;re building this</p>
      <p className="mx-auto mt-1 max-w-xs font-dm-sans text-[16px] text-secondary-ink">{line}</p>
    </Card>
  )
}

// ─── Trend ───────────────────────────────────────────────────────────────────────────────
// Restrained — this is data, not a hero: DM Sans, tabular-price, up/down tokens. Volume + spread
// are LIVE; herd-value + price Δ render their honest "building" line until history accrues.
// Delta coloring here follows the app-wide rule (lib/market-direction.ts): arrow = direction,
// color = good/bad for a cow-calf operator. Herd value and cattle prices up are good, so raw
// direction and meaning coincide — these local helpers already satisfy the rule.

function DeltaUSD({ abs }: { abs: number }) {
  if (abs === 0) return <span className="font-medium text-secondary-ink">unchanged</span>
  const up = abs > 0
  return <span className={`font-semibold tabular-price ${up ? 'text-up' : 'text-down'}`}>{up ? '▲' : '▼'} {formatUSD(Math.abs(abs))}</span>
}

function DeltaCwt({ cwt }: { cwt: number }) {
  if (cwt === 0) return <span className="font-medium text-secondary-ink">unchanged</span>
  const up = cwt > 0
  return <span className={`font-semibold tabular-price ${up ? 'text-up' : 'text-down'}`}>{up ? '▲' : '▼'} ${Math.abs(cwt)}</span>
}


export function PriceHistoryPanel({ trend }: { trend: TrendData | null }) {
  if (!trend) return <Stub line="Price history is temporarily unavailable — check back shortly." />
  return (
    <section className="space-y-4" data-audit="price-history" aria-labelledby="price-history-h">
      <h2 id="price-history-h" className={`${EYEBROW} !text-ink`}>Price history{trend.barnName ? ` · ${trend.barnName.replace(/,.*$/, '')}` : ''}</h2>
      {/* THIS WEEK'S RANGE — one price is one price, never "$X–$X" */}
      {trend.spread.length > 0 && (
        <div>
          <p className="font-dm-sans text-[14px] font-medium uppercase tracking-wide text-secondary-ink">This week&rsquo;s range</p>
          <div className="mt-1 space-y-1">
            {trend.spread.map((s, i) => (
              <p key={i} className="font-dm-sans text-[16px] text-ink" data-audit="spread-row">
                {s.label}:{' '}
                {Math.round(s.min * 100) === Math.round(s.max * 100)
                  ? <><span className="tabular-price text-ink">${s.min.toFixed(2)}</span>/{s.basis === 'cwt' ? 'cwt' : 'hd'} reported price</>
                  : <><span className="tabular-price text-ink">${s.min}–{s.max}</span>/{s.basis === 'cwt' ? 'cwt' : 'hd'} reported range</>}
              </p>
            ))}
          </div>
        </div>
      )}
      {/* HERD COMPARISON Δ — one ranch total per day is all the history holds */}
      <div>
        <p className="font-dm-sans text-[14px] font-medium uppercase tracking-wide text-secondary-ink">Your comparison over time</p>
        {trend.herd.status === 'ready' ? (
          <p className="mt-1 font-dm-sans text-[16px]">
            <DeltaUSD abs={trend.herd.abs} />{' '}
            <span className="text-secondary-ink">
              since {fmtShort(trend.herd.sinceDate)}
              {trend.herd.pct != null && ` (${trend.herd.pct >= 0 ? '+' : ''}${trend.herd.pct.toFixed(1)}%)`}
            </span>
          </p>
        ) : trend.herd.status === 'accruing' ? (
          <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink" data-audit="history-begins">{trend.historyFrom ? `History begins ${fmtShort(trend.historyFrom)}. New points appear when the reference changes.` : 'No snapshot on record yet. New points appear when the reference changes.'}</p>
        ) : (
          <p className="mt-1 font-dm-sans text-[16px] text-secondary-ink">Temporarily unavailable.</p>
        )}
      </div>
      {/* PER-CLASS PRICE Δ */}
      {trend.priceDeltas.length > 0 && (
        <div>
          <p className="font-dm-sans text-[14px] font-medium uppercase tracking-wide text-secondary-ink">Price movement</p>
          <div className="mt-1 space-y-1">
            {trend.priceDeltas.map((p, i) => (
              <p key={i} className="font-dm-sans text-[16px]">
                <span className="text-ink">{p.label}:</span>{' '}
                {p.status === 'ready' && p.cwt != null ? (
                  <>
                    <DeltaCwt cwt={p.cwt} />/cwt <span className="text-secondary-ink">vs last sale ({fmtShort(p.sinceDate ?? null)})</span>
                  </>
                ) : p.status === 'accruing' ? (
                  <span className="text-secondary-ink">one sale so far — a movement needs two</span>
                ) : (
                  <span className="text-secondary-ink">temporarily unavailable</span>
                )}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
// ─── Outlook ───────────────────────────────────────────────────────────────────────────────
// Per-lot forward floor (USDA LRP). Restrained like Trend — DM Sans, tabular-price, no hero. The
// floor is a per-cwt REFERENCE off the national CME index; the caveat (panel footer) carries the
// insurance honesty, and NO dollar total is shown (multiplying a national index into a herd total
// would read as false basis precision). Honest states: priced / stale / unavailable / not-eligible.

function OutlookCard({ l }: { l: OutlookLot }) {
  const f = l.floor
  return (
    <Card shadow="sm" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-dm-sans text-[16px] font-semibold text-ink">{l.label}</p>

          {l.state === 'priced' && f ? (
            <>
              <p className="mt-0.5 font-dm-sans text-[14px] text-secondary-ink">
                {l.lrpType} · <span className="text-secondary-ink">reference floor · a product exists for this class; eligibility is RMA&rsquo;s determination</span>
              </p>
              <p className="mt-1 font-dm-sans text-[14px] text-secondary-ink">
                {f.endorsement_length_weeks}-wk · ends {fmtEndDate(f.endorsement_end_date)}
                {f.matchedWindow
                  ? <> · matched to your {fmtMonth(f.matchedWindow)} window</>
                  : <> · set a sale window to match your sell date</>}
                {f.producer_premium_per_cwt > 0 && <> · ≈${f.producer_premium_per_cwt.toFixed(2)}/cwt premium</>}
              </p>
            </>
          ) : l.state === 'stale' ? (
            <p className="mt-0.5 font-dm-sans text-[14px] text-secondary-ink">
              {l.lrpType} · floor temporarily unavailable
              {l.effective_date ? ` — last priced ${fmtShort(l.effective_date)}` : ''}
            </p>
          ) : l.state === 'unavailable' ? (
            <p className="mt-0.5 font-dm-sans text-[14px] text-secondary-ink">
              {l.lrpType ? `${l.lrpType} · ` : ''}floor temporarily unavailable
            </p>
          ) : (
            <p className="mt-0.5 font-dm-sans text-[14px] text-secondary-ink">{l.reason}</p>
          )}
        </div>

        <p className="shrink-0 font-dm-sans text-base font-semibold tabular-price text-ink">
          {l.state === 'priced' && f
            ? <>${f.coverage_price.toFixed(2)}<span className="text-[14px] font-normal text-secondary-ink">/cwt</span></>
            : '—'}
        </p>
      </div>
    </Card>
  )
}

export function PriceProtectionPanel({ outlook }: { outlook: OutlookData | null }) {
  if (!outlook || outlook.status === 'unavailable') {
    return <Stub line="Forward floors temporarily unavailable — check back shortly." />
  }
  return (
    <div className="space-y-2">
      {outlook.as_of && (
        <p className="font-dm-sans text-[14px] text-secondary-ink">Forward floors as of {fmtShort(outlook.as_of)}</p>
      )}
      {outlook.lots.map(l => <OutlookCard key={l.lotId} l={l} />)}
      <p className="px-1 pt-1 font-dm-sans text-[15px] text-ink" data-audit="lrp-products-line">LRP feeder products exist for feeder classes; eligibility is RMA&rsquo;s determination.</p>
      <p className="px-1 pt-2 font-dm-sans text-[14px] leading-relaxed text-secondary-ink">
        Reference floor from USDA&nbsp;LRP (CME national index) — not a quote, not your local cash; basis varies.
        LRP is insurance bought through an RMA agent in set windows at daily-changing premiums; your agent&nbsp;/&nbsp;RMA sets the actual price.
      </p>
    </div>
  )
}

// The hero (a summed figure) and the Now · Trend · Outlook toggle are gone (Block 6B, commit 3):
// Now is the comparisons block, Trend is Price history, Outlook is Price protection.
