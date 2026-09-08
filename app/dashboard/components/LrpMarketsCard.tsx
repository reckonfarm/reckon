'use client'

import { useState } from 'react'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { LrpResult, LrpHeadline, LrpLadderRung } from '@/lib/lrp-service'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

// Cattle markets card — USDA RMA Livestock Risk Protection (LRP) coverage-price floor.
// Every figure comes from the LrpResult (read from the snapshot table); nothing is
// fabricated. The BASIS-RISK line is mandatory and sits directly under the number — the
// price is a national CME index floor, never the producer's local cash, and the card
// must never show the number without that framing. The term picker below is built ONLY
// from the real endorsement ladder; it never interpolates or invents a date, and picking a
// term moves the hero with it (Block 2.6C) — the card never shows two different floors.


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

// The mandatory basis-risk framing, factored so it can never drift between the hero and
// the picked-rung detail. It governs EVERY price the card shows.
function BasisRiskLine() {
  return (
    <p className="mt-3 rounded-lg border border-forest-green/15 bg-forest-green/[0.03] px-3 py-2 font-dm-sans text-[16px] leading-relaxed text-ink">
      This is the CME national index floor, not your local cash price — your basis to
      the local market varies.
    </p>
  )
}

// Block 2.6C — the term picker. Built ONLY from the real ladder (no interpolation, no
// invented dates). Every chip is unambiguous: the endorsement's end DATE and its length,
// "Dec 3, 2026 · 13 wk" — two December rungs can no longer read the same. Picking a term
// moves the hero, the premium line, and the end date together; nothing below the hero
// ever shows a different floor from the one above it.
function TermPicker({ ladder, sel, onSel }: { ladder: LrpLadderRung[]; sel: number | null; onSel: (i: number | null) => void }) {
  // Block 6B: one labeled select in place of a row of equal-weight buttons. The
  // current choice is visible in the control; every option is the endorsement's
  // end DATE and its length, built only from the real ladder.
  return (
    <div className="mt-4 border-t border-forest-green/10 pt-3">
      <label htmlFor="lrp-term" className="block font-dm-sans text-[16px] font-medium text-ink">
        Endorsement — pick the one that ends nearest your sale date; the floor, premium, and end date above follow it.
      </label>
      <select
        id="lrp-term"
        value={sel ?? ''}
        onChange={e => onSel(e.target.value === '' ? null : Number(e.target.value))}
        className="mt-2 min-h-[48px] w-full rounded-lg border border-forest-green/20 bg-white px-3 font-dm-sans text-[16px] tabular-nums text-forest-green"
        data-audit="lrp-term-select"
      >
        <option value="">Showing the default endorsement</option>
        {ladder.map((r, i) => (
          <option key={`${r.endorsement_end_date}-${r.endorsement_length_weeks}`} value={i} data-audit="lrp-term" data-floor={r.coverage_price.toFixed(2)} data-weeks={r.endorsement_length_weeks}>
            {fmtDate(r.endorsement_end_date)} · {r.endorsement_length_weeks} wk
          </option>
        ))}
      </select>
    </div>
  )
}

function OkBody({ lrp, ladder }: { lrp: LrpHeadline; ladder: LrpLadderRung[] }) {
  const [sel, setSel] = useState<number | null>(null)
  const picked = sel != null ? ladder[sel] ?? null : null
  const commodity = stripCode(lrp.commodity) || 'feeder cattle'
  const type      = stripCode(lrp.lrp_type)
  const pct       = Math.round(lrp.coverage_level * 100)
  // The rung on show — the headline endorsement until a term is picked. One object feeds
  // the hero, the subline, and the premium line, so they can only ever agree.
  const shown = picked
    ? { floor: picked.coverage_price, premium: picked.producer_premium_per_cwt, weeks: picked.endorsement_length_weeks, ends: picked.endorsement_end_date }
    : { floor: lrp.coverage_price, premium: lrp.producer_premium_per_cwt, weeks: lrp.endorsement_length_weeks, ends: lrp.endorsement_end_date }

  return (
    <>
      <p className="type-main-number text-ink" data-audit="lrp-hero">
        ${shown.floor.toFixed(2)}
        <span className="ml-1 font-dm-sans text-lg font-medium text-ink"> /cwt</span>
      </p>

      <p className="mt-2 font-dm-sans text-[16px] text-ink" data-audit="lrp-subline">
        LRP price floor · {commodity}{type ? ` (${type})` : ''}
        {shown.weeks ? ` · ${shown.weeks}-wk endorsement` : ''}
        {pct ? ` · ${pct}% coverage` : ''}
      </p>

      {/* BASIS-RISK FRAMING — required, clear (not buried). Governs the hero AND the picker. */}
      <BasisRiskLine />

      {/* Real detail for the rung on show: producer premium + endorsement end date. */}
      <p className="mt-3 font-dm-sans text-[16px] text-ink" data-audit="lrp-detail">
        <>Coverage price ${shown.floor.toFixed(2)}/cwt · {commodity}{type ? ` (${type})` : ''}</>
        {shown.premium > 0 && <> · ${shown.premium.toFixed(2)}/cwt premium after subsidy</>}
        {shown.ends && <> · coverage ends {fmtDate(shown.ends)}</>}
        {picked
          ? <> · {picked.endorsement_length_weeks}-wk endorsement picked</>
          : lrp.endorsement_length_weeks ? <> · showing the {lrp.endorsement_length_weeks}-wk endorsement by default</> : null}
      </p>

      {/* Term picker — only when the ladder is real; otherwise the card is exactly the
          headline-only view (no empty/broken control). */}
      {ladder.length > 0 && <TermPicker ladder={ladder} sel={sel} onSel={setSel} />}

      {/* Stale note — show the data, but never as "today". */}
      {lrp.stale && (
        <p className="mt-3 font-dm-sans text-[16px] text-ink">
          Latest available — as of {fmtDate(lrp.effective_date)}.
        </p>
      )}

      <p className="mt-3 text-[16px] text-ink font-dm-sans">
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
        <p className="text-[16px] text-ink font-dm-sans">
          LRP data temporarily unavailable — check back shortly.
        </p>
      )}

      {result.status === 'none' && (
        <p className="text-[16px] text-ink font-dm-sans">
          LRP prices not loaded yet — check back shortly.
        </p>
      )}

      {result.status === 'ok' && <OkBody lrp={result.lrp} ladder={result.ladder} />}
    </Card>
  )
}
