import DashboardAccordion from './DashboardAccordion'
import type { UpcomingDeadlinesResult } from '@/lib/rma-deadline-service'
import { cropLabel, typeLabel } from './DeadlineCountdownCard'

// Program status — the QUIET HOME (Block 2: silence is a feature). When a program card
// has nothing actionable (deadlines far out or none listed; LFP joins in the next
// commit), it folds into this single collapsed row instead of vanishing: affirmative
// silence — the dashboard says "checked, all is well" in one line, and the rancher who
// goes looking finds the full card one tap away, in the same slot it occupies when loud.
// The preview is DATA-DRIVEN, never a canned "all clear" — quiet must still be honest.

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Preview line for a QUIET LFP result. Only the clean no-trigger state is ever quiet
// (triggered / pending / building / unavailable are all loud — see isLfpLoud in
// LfpAlertCard.tsx), so one factual constant covers it; the expanded card names the
// county and carries the USDM as-of line.
export const LFP_QUIET_PREVIEW = 'LFP: no D2+ trigger'

// Preview line for a QUIET deadline result. Only quiet states reach here (loud results
// render the full card; data_unavailable is always loud), so this covers ok-but-far and
// none — both stated factually, with the real next date when one exists. "USDA", not
// "insurance": the table carries the LFP application alongside the RMA dates.
// Block 7.8 — a deadline names its program, everywhere it appears. This line
// used to read "Next USDA deadline Dec 1, 2026", sitting directly under the LFP
// card, which made a PRF sales-closing date read as an LFP one. lib/programDates
// is emphatic on the point: "December 1 is a PRF date and belongs ONLY on PRF;
// it is not an LFP deadline."
export function deadlineQuietPreview(result: UpcomingDeadlinesResult): string {
  if (result.status === 'ok') {
    const d = result.deadlines[0]
    return `${cropLabel(d.crop_or_program)} ${typeLabel(d.deadline_type)} · ${fmtDate(d.deadline_date)} · ${d.daysUntil} days`
  }
  return 'No upcoming USDA program deadlines listed'
}

export default function ProgramStatusRow({
  preview,
  children,
}: {
  preview: string
  children: React.ReactNode
}) {
  return (
    <DashboardAccordion title="Program status" preview={preview}>
      <div className="space-y-4">{children}</div>
    </DashboardAccordion>
  )
}
