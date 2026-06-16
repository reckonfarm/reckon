'use client'

import { useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import { Segmented } from '@/app/components/ui/Segmented'
import type { HerdEstimate, LotValuation } from '@/lib/herd-estimate'

// The HerdEstimate display — hero number (the one place boldness is spent: large Fraunces) +
// a Now/Trend/Outlook Segmented toggle. Everything but the hero is quiet DM Sans / tabular.
// Fed the server-computed estimate (serializable); the toggle is the only interactive bit.
// Honest throughout: an unpriced lot shows its reason and "—", never $0; a herd with nothing
// priced shows the reason, not a fake number.

const EYEBROW = 'font-dm-sans text-xs font-medium uppercase tracking-wider text-muted/50'

function formatUSD(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

function fmtShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

export default function HerdEstimatePanel({ estimate }: { estimate: HerdEstimate }) {
  const [view, setView] = useState<'now' | 'trend' | 'outlook'>('now')
  const priced = estimate.lots_priced > 0

  return (
    <section className="space-y-5">
      {/* HERO — the one bold number (Fraunces). Honest headline + sub-line when nothing priced. */}
      <div>
        <p className={EYEBROW}>HerdEstimate</p>
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
      {view === 'trend' && <Stub line="Weekly price history for your lots — how this number is moving — is coming." />}
      {view === 'outlook' && <Stub line="Price protection for each lot (USDA LRP) lands here soon." />}
    </section>
  )
}
