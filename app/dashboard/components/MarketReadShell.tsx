'use client'

import { Card } from '@/app/components/ui/Card'

// Market Read — the interpretation layer that LEADS the operation zone: it sits ABOVE the
// herd value (read first, value beneath — the decision-forward order). This is the §4
// feedlot-demand corn read, and per §3 it is a READ, never a calculator and never a
// sell-or-hold call — so the lead line is a sentence, never a number.
//
// Slice 2a is the SHELL only: structure + honest "warming up" placeholders, NO data yet.
// The three evidence legs (Moisture / Crop / Price) each land in later commits; until a
// leg's fetch exists it shows an honest coming-online state, matching the dashboard's
// "temporarily unavailable" degradation tone — never a fabricated number or lean.

const EYEBROW = 'font-dm-sans text-xs font-medium uppercase tracking-wider text-muted/50'

// The three evidence legs, in read order. `hint` says what each leg will show once live —
// honest expectation-setting, not data.
const LEGS = [
  { key: 'moisture', label: 'Moisture', hint: 'feeding-region rain vs normal' },
  { key: 'crop',     label: 'Crop',     hint: 'corn condition' },
  { key: 'price',    label: 'Price',    hint: 'corn board' },
] as const

export default function MarketReadShell() {
  return (
    <Card shadow="sm" className="p-6 sm:p-8">
      <p className={EYEBROW}>Market Read</p>

      {/* The read — a sentence, never a number or a lean. Shell state: honestly warming up. */}
      <p className="mt-2 font-fraunces text-2xl font-semibold leading-snug tracking-tight text-ink/80 sm:text-3xl">
        Reading feeder demand&hellip;
      </p>
      <p className="mt-2 max-w-md font-dm-sans text-sm leading-relaxed text-muted/70">
        What corn and grass are doing to feedlot demand &mdash; the read behind this week&rsquo;s number. Coming online.
      </p>

      {/* Evidence legs — each honest until its data lands. The "—" is the same honest-absence
          mark the HerdEstimate panel uses for unpriced lots. */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        {LEGS.map(leg => (
          <div key={leg.key} className="rounded-lg border border-forest-green/10 bg-cream/40 px-3 py-3">
            <p className="font-dm-sans text-xs font-medium text-forest-green/60">{leg.label}</p>
            <p className="mt-1 font-fraunces text-xl font-semibold tabular-nums text-ink/25">&mdash;</p>
            <p className="mt-1 font-dm-sans text-[11px] leading-tight text-muted/55">warming up</p>
            <p className="mt-1 font-dm-sans text-[11px] leading-tight text-muted/40">{leg.hint}</p>
          </div>
        ))}
      </div>

      <p className="mt-4 font-dm-sans text-xs leading-relaxed text-muted/55">
        A read on the market, not a recommendation &mdash; never a sell-or-hold call.
      </p>
    </Card>
  )
}
