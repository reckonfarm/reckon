'use client'

import { useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import { Segmented } from '@/app/components/ui/Segmented'
import type { HerdEstimate, LotValuation } from '@/lib/herd-estimate'
import type { TrendData, VolumeRow } from '@/lib/trend'
import type { OutlookData, OutlookLot } from '@/lib/outlook'

// The HerdEstimate display — hero number (the one place boldness is spent: large Fraunces) +
// a Now/Trend/Outlook Segmented toggle. Everything but the hero is quiet DM Sans / tabular.
// Fed the server-computed estimate + trend bundle (both serializable); the toggle is the only
// interactive bit. Honest throughout: unpriced lots show "—" not $0; accruing Trend metrics
// show their honest "building" line, never a fake/zero delta.

const EYEBROW = 'font-dm-sans text-xs font-medium uppercase tracking-wider text-muted/50'

function formatUSD(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
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
function heroSubline(e: HerdEstimate): string {
  if (e.lots_priced === 0) return e.note
  const towns = [...new Set(e.perLot.filter(l => l.source).map(l => l.source!.town.replace(/,\s*[A-Z]{2}$/, '')))].join(' / ')
  const lots = `${e.lots_priced} of ${e.lots_total} lot${e.lots_total === 1 ? '' : 's'} priced`
  return `${towns} cash · as of ${fmtShort(e.as_of)} · ${lots}`
}

function heroHeadline(e: HerdEstimate): string {
  if (e.lots_priced > 0) return formatUSD(e.total_priced)
  return e.tier === 'local' ? 'No matching prices this week' : 'No nearby auction this week'
}

function LotCard({ l }: { l: LotValuation }) {
  const priced = l.value != null && l.source != null
  return (
    <Card shadow="sm" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-dm-sans text-sm font-semibold text-ink">{l.label}</p>
          {priced ? (
            <p className="mt-0.5 font-dm-sans text-xs text-muted/70">
              {l.source!.barn_name} · {fmtShort(l.source!.report_date)} ·{' '}
              <span className="tabular-price">${l.source!.avg_price}</span>/{l.source!.price_basis === 'cwt' ? 'cwt' : 'hd'}
              {!l.source!.exact_bracket && <span className="text-muted/55"> · class avg</span>}
            </p>
          ) : (
            <p className="mt-0.5 font-dm-sans text-xs text-muted/60">{l.reason}</p>
          )}
        </div>
        <p className="shrink-0 font-dm-sans text-base font-semibold tabular-price text-ink">
          {priced ? formatUSD(l.value!) : '—'}
        </p>
      </div>
    </Card>
  )
}

function Stub({ line }: { line: string }) {
  return (
    <Card shadow="sm" className="px-6 py-8 text-center">
      <p className="font-dm-sans text-sm font-semibold text-ink">We&rsquo;re building this</p>
      <p className="mx-auto mt-1 max-w-xs font-dm-sans text-sm text-muted/60">{line}</p>
    </Card>
  )
}

// ─── Trend ───────────────────────────────────────────────────────────────────────────────
// Restrained — this is data, not a hero: DM Sans, tabular-price, up/down tokens. Volume + spread
// are LIVE; herd-value + price Δ render their honest "building" line until history accrues.

function DeltaUSD({ abs }: { abs: number }) {
  if (abs === 0) return <span className="font-medium text-muted/70">unchanged</span>
  const up = abs > 0
  return <span className={`font-semibold tabular-price ${up ? 'text-up' : 'text-down'}`}>{up ? '▲' : '▼'} {formatUSD(Math.abs(abs))}</span>
}

function DeltaCwt({ cwt }: { cwt: number }) {
  if (cwt === 0) return <span className="font-medium text-muted/70">unchanged</span>
  const up = cwt > 0
  return <span className={`font-semibold tabular-price ${up ? 'text-up' : 'text-down'}`}>{up ? '▲' : '▼'} ${Math.abs(cwt)}</span>
}

function VolumeCard({ v }: { v: VolumeRow }) {
  const wk = v.receipts != null && v.weekAgo != null ? v.receipts - v.weekAgo : null
  return (
    <Card shadow="sm" className="p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-dm-sans text-sm font-medium text-ink">{v.commodity}</p>
        <p className="font-dm-sans text-sm">
          <span className="tabular-price font-semibold text-ink">{v.receipts ?? '—'}</span>
          <span className="text-muted/60"> head</span>
          {wk != null && (
            <span className={`ml-2 tabular-price font-medium ${wk >= 0 ? 'text-up' : 'text-down'}`}>
              {wk >= 0 ? '▲' : '▼'} {Math.abs(wk)}
            </span>
          )}
        </p>
      </div>
      <p className="mt-0.5 font-dm-sans text-xs text-muted/55">
        {v.weekAgo != null ? <>vs <span className="tabular-price">{v.weekAgo}</span> last week</> : 'no week-ago figure'}
        {v.yearAgo != null && <> · <span className="tabular-price">{v.yearAgo}</span> a year ago</>}
      </p>
    </Card>
  )
}

function TrendPanel({ trend }: { trend: TrendData | null }) {
  if (!trend) return <Stub line="Trend is temporarily unavailable — check back shortly." />
  return (
    <div className="space-y-5">
      {/* VOLUME — live, the day-one signal */}
      <div>
        <p className={EYEBROW}>Volume{trend.barnName ? ` · ${trend.barnName.replace(/,.*$/, '')}` : ''}</p>
        {trend.volume.length > 0 ? (
          <div className="mt-2 space-y-2">
            {trend.volume.map(v => <VolumeCard key={v.commodity} v={v} />)}
          </div>
        ) : (
          <p className="mt-1 font-dm-sans text-sm text-muted/60">No nearby auction this week — volume shows once a local barn reports.</p>
        )}
      </div>

      {/* SPREAD — live */}
      {trend.spread.length > 0 && (
        <div>
          <p className={EYEBROW}>This week&rsquo;s range</p>
          <div className="mt-2 space-y-1">
            {trend.spread.map((s, i) => (
              <p key={i} className="font-dm-sans text-sm text-body/80">
                {s.label}: <span className="tabular-price text-ink">${s.min}–{s.max}</span>/{s.basis === 'cwt' ? 'cwt' : 'hd'}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* HERD VALUE Δ — accruing */}
      <div>
        <p className={EYEBROW}>Your herd value</p>
        {trend.herd.status === 'ready' ? (
          <p className="mt-1 font-dm-sans text-sm">
            <DeltaUSD abs={trend.herd.abs} />{' '}
            <span className="text-muted/70">
              since {fmtShort(trend.herd.sinceDate)}
              {trend.herd.pct != null && ` (${trend.herd.pct >= 0 ? '+' : ''}${trend.herd.pct.toFixed(1)}%)`}
            </span>
          </p>
        ) : trend.herd.status === 'accruing' ? (
          <p className="mt-1 font-dm-sans text-sm text-muted/60">Tracking daily — your week-over-week change appears here in a couple days.</p>
        ) : (
          <p className="mt-1 font-dm-sans text-sm text-muted/60">Temporarily unavailable.</p>
        )}
      </div>

      {/* PER-CLASS PRICE Δ — accruing */}
      {trend.priceDeltas.length > 0 && (
        <div>
          <p className={EYEBROW}>Price movement</p>
          <div className="mt-1 space-y-1">
            {trend.priceDeltas.map((p, i) => (
              <p key={i} className="font-dm-sans text-sm">
                <span className="text-body/80">{p.label}:</span>{' '}
                {p.status === 'ready' && p.cwt != null ? (
                  <>
                    <DeltaCwt cwt={p.cwt} />/cwt <span className="text-muted/60">vs last sale ({fmtShort(p.sinceDate ?? null)})</span>
                  </>
                ) : p.status === 'accruing' ? (
                  <span className="text-muted/60">builds over the next sale or two</span>
                ) : (
                  <span className="text-muted/60">temporarily unavailable</span>
                )}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
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
          <p className="font-dm-sans text-sm font-semibold text-ink">{l.label}</p>

          {l.state === 'priced' && f ? (
            <>
              <p className="mt-0.5 font-dm-sans text-xs text-muted/70">
                {l.lrpType} · <span className="text-muted/55">ref. floor</span>
              </p>
              <p className="mt-1 font-dm-sans text-xs text-muted/60">
                {f.endorsement_length_weeks}-wk · ends {fmtEndDate(f.endorsement_end_date)}
                {f.matchedWindow
                  ? <> · matched to your {fmtMonth(f.matchedWindow)} window</>
                  : <> · set a sale window to match your sell date</>}
                {f.producer_premium_per_cwt > 0 && <> · ≈${f.producer_premium_per_cwt.toFixed(2)}/cwt premium</>}
              </p>
            </>
          ) : l.state === 'stale' ? (
            <p className="mt-0.5 font-dm-sans text-xs text-muted/60">
              {l.lrpType} · floor temporarily unavailable
              {l.effective_date ? ` — last priced ${fmtShort(l.effective_date)}` : ''}
            </p>
          ) : l.state === 'unavailable' ? (
            <p className="mt-0.5 font-dm-sans text-xs text-muted/60">
              {l.lrpType ? `${l.lrpType} · ` : ''}floor temporarily unavailable
            </p>
          ) : (
            <p className="mt-0.5 font-dm-sans text-xs text-muted/60">{l.reason}</p>
          )}
        </div>

        <p className="shrink-0 font-dm-sans text-base font-semibold tabular-price text-ink">
          {l.state === 'priced' && f
            ? <>${f.coverage_price.toFixed(2)}<span className="text-xs font-normal text-muted/55">/cwt</span></>
            : '—'}
        </p>
      </div>
    </Card>
  )
}

function OutlookPanel({ outlook }: { outlook: OutlookData | null }) {
  if (!outlook || outlook.status === 'unavailable') {
    return <Stub line="Forward floors temporarily unavailable — check back shortly." />
  }
  return (
    <div className="space-y-2">
      {outlook.as_of && (
        <p className="font-dm-sans text-xs text-muted/55">Forward floors as of {fmtShort(outlook.as_of)}</p>
      )}
      {outlook.lots.map(l => <OutlookCard key={l.lotId} l={l} />)}
      <p className="px-1 pt-2 font-dm-sans text-xs leading-relaxed text-muted/55">
        Reference floor from USDA&nbsp;LRP (CME national index) — not a quote, not your local cash; basis varies.
        LRP is insurance bought through an RMA agent in set windows at daily-changing premiums; your agent&nbsp;/&nbsp;RMA sets the actual price.
      </p>
    </div>
  )
}

export default function HerdEstimatePanel({ estimate, trend, outlook }: { estimate: HerdEstimate; trend: TrendData | null; outlook: OutlookData | null }) {
  const [view, setView] = useState<'now' | 'trend' | 'outlook'>('now')
  const priced = estimate.lots_priced > 0

  return (
    <section className="space-y-5">
      {/* HERO — the one bold number (Fraunces). Honest headline + sub-line when nothing priced. */}
      <div>
        {/* Two words so the uppercase eyebrow reads "HERD ESTIMATE", not "HERDESTIMATE". */}
        <p className={EYEBROW}>Herd estimate</p>
        <p
          className={
            priced
              ? 'mt-1 font-fraunces text-5xl font-semibold leading-none tracking-tight text-ink tabular-nums sm:text-6xl'
              : 'mt-1 font-fraunces text-2xl font-semibold tracking-tight text-ink/80 sm:text-3xl'
          }
        >
          {heroHeadline(estimate)}
        </p>
        <p className="mt-2 font-dm-sans text-sm text-muted/70">{heroSubline(estimate)}</p>
      </div>

      <Segmented<'now' | 'trend' | 'outlook'>
        ariaLabel="HerdEstimate view"
        value={view}
        onChange={setView}
        options={[
          { value: 'now', label: 'Now' },
          { value: 'trend', label: 'Trend' },
          { value: 'outlook', label: 'Outlook' },
        ]}
      />

      {view === 'now' && (
        <div className="space-y-2">
          {estimate.perLot.map(l => <LotCard key={l.lotId} l={l} />)}
        </div>
      )}
      {view === 'trend' && <TrendPanel trend={trend} />}
      {view === 'outlook' && <OutlookPanel outlook={outlook} />}
    </section>
  )
}
