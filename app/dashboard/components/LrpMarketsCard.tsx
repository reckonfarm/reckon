'use client'

import { useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { LrpResult, LrpHeadline, LrpLadderRung } from '@/lib/lrp-service'

// Cattle markets card — USDA RMA Livestock Risk Protection (LRP) coverage-price floor.
// Every figure comes from the LrpResult (read from the snapshot table); nothing is
// fabricated. The BASIS-RISK line is mandatory and sits directly under the number — the
// price is a national CME index floor, never the producer's local cash, and the card
// must never show the number without that framing. The sale-window picker below is built
// ONLY from the real endorsement ladder; it never interpolates or invents a month, and
// the basis-risk framing travels with every endorsement it shows.

const EYEBROW = 'text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide'

// Strip the leading RMA numeric code from a label, e.g. '810 Steers Weight 2' →
// 'Steers Weight 2', '0801 Feeder Cattle' → 'Feeder Cattle'.
function stripCode(s: string): string {
  return s.replace(/^\d+\s+/, '').trim()
}

// Accepts ISO 'YYYY-MM-DD' (effective_date) or US 'MM/DD/YYYY' (endorsement_end_date).
function fmtDate(s: string): string {
  const us = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  const iso = us ? `${us[3]}-${us[1]}-${us[2]}` : s
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// The sale month derived from a rung's end date (same MM/DD/YYYY parse as fmtDate). `chip`
// is the compact picker label (e.g. "Oct ’26"); `long` is the prose month ("October").
// A producer selling around then picks the endorsement that ENDS in that month.
function endMonth(raw: string): { chip: string; long: string } {
  const us = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  const iso = us ? `${us[3]}-${us[1]}-${us[2]}` : raw
  const d = new Date(`${iso}T00:00:00`)
  const mon = d.toLocaleDateString('en-US', { month: 'short' })
  const yy = d.toLocaleDateString('en-US', { year: '2-digit' })
  return { chip: `${mon} ’${yy}`, long: d.toLocaleDateString('en-US', { month: 'long' }) }
}

// The mandatory basis-risk framing, factored so it can never drift between the hero and
// the picked-rung detail. It governs EVERY price the card shows.
function BasisRiskLine() {
  return (
    <p className="mt-3 rounded-lg border border-forest-green/15 bg-forest-green/[0.03] px-3 py-2 font-dm-sans text-sm leading-relaxed text-forest-green/75">
      This is the CME national index floor, not your local cash price — your basis to
      the local market varies.
    </p>
  )
}

// Sale-window picker — built ONLY from the real ladder. No interpolation, no fabricated
// months; default (nothing picked) leaves the hero on the headline endorsement.
function SaleWindowPicker({ headlineWeeks, ladder }: { headlineWeeks: number; ladder: LrpLadderRung[] }) {
  const [sel, setSel] = useState<number | null>(null)
  const picked = sel != null ? ladder[sel] : null

  return (
    <div className="mt-4 border-t border-forest-green/10 pt-3">
      <p className="font-dm-sans text-xs font-medium text-forest-green/55">
        Selling later? Pick your sale month — the floor shifts with the endorsement window.
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {ladder.map((r, i) => (
          <button
            key={r.endorsement_end_date}
            type="button"
            onClick={() => setSel(sel === i ? null : i)}
            aria-pressed={sel === i}
            className={`rounded-md border px-2 py-1 font-dm-sans text-xs font-medium tabular-nums transition-colors ${
              sel === i
                ? 'border-forest-green bg-forest-green text-cream'
                : 'border-forest-green/15 text-forest-green/65 hover:bg-forest-green/5'
            }`}
          >
            {endMonth(r.endorsement_end_date).chip}
          </button>
        ))}
      </div>

      {/* Honest tradeoff — always shown with the picker, never lost when a month is picked. */}
      <p className="mt-2 font-dm-sans text-xs text-forest-green/45">
        Longer coverage = lower floor, higher premium.
      </p>

      {picked && (
        <div className="mt-2.5 rounded-lg border border-forest-green/15 bg-forest-green/[0.03] px-3 py-2">
          <p className="font-dm-sans text-sm leading-relaxed text-forest-green">
            Selling in {endMonth(picked.endorsement_end_date).long}? {picked.endorsement_length_weeks}-wk
            endorsement —{' '}
            <span className="font-semibold tabular-nums">${picked.coverage_price.toFixed(2)}/cwt</span> floor
            {picked.producer_premium_per_cwt > 0 && (
              <>, <span className="tabular-nums">${picked.producer_premium_per_cwt.toFixed(2)}/cwt</span> premium</>
            )}
            , ends {fmtDate(picked.endorsement_end_date)}.
          </p>
          {/* Basis-risk travels with the picked rung — a different endorsement is STILL the
              national index floor, never local cash. */}
          <p className="mt-1.5 font-dm-sans text-xs text-forest-green/55">
            Still the CME national index floor — not your local cash price.
          </p>
        </div>
      )}

      {!picked && (
        <p className="mt-2 font-dm-sans text-xs text-forest-green/45">
          Showing the {headlineWeeks}-wk floor by default.
        </p>
      )}
    </div>
  )
}

function OkBody({ lrp, ladder }: { lrp: LrpHeadline; ladder: LrpLadderRung[] }) {
  const commodity = stripCode(lrp.commodity) || 'feeder cattle'
  const type      = stripCode(lrp.lrp_type)
  const pct       = Math.round(lrp.coverage_level * 100)

  return (
    <>
      {/* Hero: the real headline coverage price — unchanged by the picker below. */}
      <p className="font-fraunces text-4xl font-semibold leading-none tracking-tight tabular-nums text-forest-green sm:text-5xl">
        ${lrp.coverage_price.toFixed(2)}
        <span className="ml-1 font-dm-sans text-lg font-medium text-forest-green/50"> /cwt</span>
      </p>

      <p className="mt-2 font-dm-sans text-sm text-forest-green/60">
        LRP price floor · {commodity}{type ? ` (${type})` : ''}
        {lrp.endorsement_length_weeks ? ` · ${lrp.endorsement_length_weeks}-wk endorsement` : ''}
        {pct ? ` · ${pct}% coverage` : ''}
      </p>

      {/* BASIS-RISK FRAMING — required, clear (not buried). Governs the hero AND the picker. */}
      <BasisRiskLine />

      {/* Compact real detail: producer premium + endorsement end date. */}
      <p className="mt-3 font-dm-sans text-sm text-forest-green/60">
        {lrp.producer_premium_per_cwt > 0 && (
          <>${lrp.producer_premium_per_cwt.toFixed(2)}/cwt premium after subsidy</>
        )}
        {lrp.producer_premium_per_cwt > 0 && lrp.endorsement_end_date ? ' · ' : ''}
        {lrp.endorsement_end_date && <>coverage ends {fmtDate(lrp.endorsement_end_date)}</>}
      </p>

      {/* Sale-window picker — only when the ladder is real; otherwise the card is exactly
          today's headline-only view (no empty/broken control). */}
      {ladder.length > 0 && (
        <SaleWindowPicker headlineWeeks={lrp.endorsement_length_weeks} ladder={ladder} />
      )}

      {/* Stale note — show the data, but never as "today". */}
      {lrp.stale && (
        <p className="mt-3 font-dm-sans text-xs text-forest-green/45">
          Latest available — as of {fmtDate(lrp.effective_date)}.
        </p>
      )}

      <p className="mt-3 text-xs text-forest-green/40 font-dm-sans">
        {lrp.source} · LRP · effective {fmtDate(lrp.effective_date)}
      </p>
    </>
  )
}

export default function LrpMarketsCard({ result }: { result: LrpResult }) {
  return (
    <Card shadow="soft" className="p-4 sm:p-6">
      <div className="mb-3">
        <p className={EYEBROW}>Cattle markets</p>
        <Heading level={5} className="mt-1">Livestock Risk Protection</Heading>
      </div>

      {result.status === 'data_unavailable' && (
        <p className="text-sm text-forest-green/50 font-dm-sans">
          LRP data temporarily unavailable — check back shortly.
        </p>
      )}

      {result.status === 'none' && (
        <p className="text-sm text-forest-green/50 font-dm-sans">
          LRP prices not loaded yet — check back shortly.
        </p>
      )}

      {result.status === 'ok' && <OkBody lrp={result.lrp} ladder={result.ladder} />}
    </Card>
  )
}
