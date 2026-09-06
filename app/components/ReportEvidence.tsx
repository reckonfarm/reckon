import { reportUrl } from '@/lib/market-scope'

// ─── Block 2.6I — THE evidence line under every price ─────────────────────────
// "Billings · Sep 3 · 42 head · Report ↗". One shared component, so no price
// surface can drift back to "USDA AMS report 1777" as bare text: the barn, the
// sale date, the head behind the figure, and a link to the actual USDA AMS
// report. The link box is 48 px tall for the thumb without changing the line's
// height (negative vertical margins cancel the padding).

const fmtShort = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ReportEvidence({ barn, date, head, slug, revision, className = '' }: {
  barn: string
  date: string            // ISO sale / report date
  head?: number | null    // head reported behind the figure; omitted when the source has none
  slug: string            // the MARS report slug, e.g. '1777'
  revision?: number | null
  className?: string
}) {
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-1 ${className}`} data-audit="report-evidence">
      <span>{barn} · {fmtShort(date)}{head != null ? ` · ${head.toLocaleString('en-US')} head` : ''}{revision && revision > 1 ? ` · rev ${revision}` : ''} ·</span>
      <a href={reportUrl(slug)} target="_blank" rel="noopener noreferrer" data-audit="report-link"
        aria-label={`USDA AMS report ${slug} — opens in a new tab`}
        className="-my-3 inline-flex min-h-[48px] items-center px-1 font-semibold text-forest-green underline underline-offset-2">
        Report ↗
      </a>
    </span>
  )
}
