import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { LrpResult, LrpHeadline } from '@/lib/lrp-service'

// Cattle markets card — USDA RMA Livestock Risk Protection (LRP) coverage-price floor.
// Every figure comes from the LrpResult (read from the snapshot table); nothing is
// fabricated. The BASIS-RISK line is mandatory and sits directly under the number — the
// price is a national CME index floor, never the producer's local cash, and the card
// must never show the number without that framing.

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

function OkBody({ lrp }: { lrp: LrpHeadline }) {
  const commodity = stripCode(lrp.commodity) || 'feeder cattle'
  const type      = stripCode(lrp.lrp_type)
  const pct       = Math.round(lrp.coverage_level * 100)

  return (
    <>
      {/* Hero: the real coverage price. */}
      <p className="font-fraunces text-4xl font-semibold leading-none tracking-tight tabular-nums text-forest-green sm:text-5xl">
        ${lrp.coverage_price.toFixed(2)}
        <span className="ml-1 font-dm-sans text-lg font-medium text-forest-green/50"> /cwt</span>
      </p>

      <p className="mt-2 font-dm-sans text-sm text-forest-green/60">
        LRP price floor · {commodity}{type ? ` (${type})` : ''}
        {lrp.endorsement_length_weeks ? ` · ${lrp.endorsement_length_weeks}-wk endorsement` : ''}
        {pct ? ` · ${pct}% coverage` : ''}
      </p>

      {/* BASIS-RISK FRAMING — required, clear (not buried). The number must never stand
          alone: it's a national index floor, not the producer's local cash. */}
      <p className="mt-3 rounded-lg border border-forest-green/15 bg-forest-green/[0.03] px-3 py-2 font-dm-sans text-sm leading-relaxed text-forest-green/75">
        This is the CME national index floor, not your local cash price — your basis to
        the local market varies.
      </p>

      {/* Compact real detail: producer premium + endorsement end date. */}
      <p className="mt-3 font-dm-sans text-sm text-forest-green/60">
        {lrp.producer_premium_per_cwt > 0 && (
          <>${lrp.producer_premium_per_cwt.toFixed(2)}/cwt premium after subsidy</>
        )}
        {lrp.producer_premium_per_cwt > 0 && lrp.endorsement_end_date ? ' · ' : ''}
        {lrp.endorsement_end_date && <>coverage ends {fmtDate(lrp.endorsement_end_date)}</>}
      </p>

      {/* Stale note — show the data, but never as "today". */}
      {lrp.stale && (
        <p className="mt-2 font-dm-sans text-xs text-forest-green/45">
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

      {result.status === 'ok' && <OkBody lrp={result.lrp} />}
    </Card>
  )
}
