// ─── Program deadlines — THE single source of truth ───────────────────────────
//
// Every USDA program deadline Dryline renders (LFP application, PRF sales
// closing) reads from this file. No component, service, seed, or email may
// carry its own date string. The rma_deadlines table still holds the crop-
// insurance calendar (spring wheat, July 15 acreage reports), but its LFP and
// PRF rows are OVERRIDDEN from here in lib/rma-deadline-service.ts and SEEDED
// from here in scripts/seed-rma-deadlines.ts — one place to be wrong.
//
// Verified 2026-09-05 (Block 1 trust fixes):
//   • LFP — applications are due March 1 following the end of the calendar
//     year in which the grazing loss occurred (FSA). The loss year is the year
//     the drought happened, NOT the current year: on 2027-01-01 the 2026-loss
//     deadline is still 2027-03-01. Nothing here rolls forward — a new loss
//     year is a new row, added by hand when FSA publishes it.
//   • PRF — Dec 1 sales closing for the FOLLOWING coverage year (RMA bulletin
//     PM-21-051, "2022 and succeeding crop years"). December 1 is a PRF date
//     and belongs ONLY on PRF; it is not an LFP deadline.
//
// Urgency: a deadline is URGENT (banner-worthy) only inside URGENT_WINDOW_DAYS.
// Outside it the plain date renders with the month it was last verified.

export type Program = 'LFP' | 'PRF'

export interface ProgramDate {
  program: Program
  /** LFP: the calendar year the grazing loss occurred. */
  lossYear?: number
  /** PRF: the coverage (crop) year the sales-closing date buys. */
  coverageYear?: number
  /** ISO 'YYYY-MM-DD'. */
  deadline: string
  label: string
  source: string
  /** ISO 'YYYY-MM-DD' — when a person last checked this date against the agency. */
  verifiedAt: string
}

export const PROGRAM_DATES: readonly ProgramDate[] = [
  {
    program: 'LFP',
    lossYear: 2026,
    deadline: '2027-03-01',
    label: 'LFP application deadline (2026 losses)',
    source: 'https://www.fsa.usda.gov/resources/programs/livestock-forage-disaster-program-lfp',
    verifiedAt: '2026-09-05',
  },
  {
    program: 'PRF',
    coverageYear: 2027,
    deadline: '2026-12-01',
    label: 'PRF sales closing (2027 coverage)',
    source: 'https://www.rma.usda.gov/',
    verifiedAt: '2026-09-05',
  },
]

export const URGENT_WINDOW_DAYS = 60

/** The program year a row is keyed on: loss year for LFP, coverage year for PRF. */
export function programYearOf(d: ProgramDate): number {
  return (d.program === 'LFP' ? d.lossYear : d.coverageYear) ?? NaN
}

/**
 * The deadline for a program and its program year (LFP loss year / PRF coverage
 * year), or null when no verified row exists. Null means "we do not know" — the
 * caller renders honest absence, never a computed guess.
 */
export function deadlineFor(program: Program, year: number): ProgramDate | null {
  return PROGRAM_DATES.find(d => d.program === program && programYearOf(d) === year) ?? null
}

/** Today as ISO 'YYYY-MM-DD' in UTC (the same date-only convention the deadline service uses). */
export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** Whole days from `fromISO` to `toISO`, both at UTC midnight. Negative when past. */
export function daysUntil(toISO: string, fromISO: string = todayISO()): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`)
  const b = Date.parse(`${toISO}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * The next open deadline for a program as of `today`: the soonest row whose
 * deadline is today or later. This is how the year boundary is handled — on
 * 2027-01-01 the LFP row for 2026 losses (due 2027-03-01) is still the answer.
 * Once every listed deadline has passed this returns null (no invented dates).
 */
export function nextDeadline(program: Program, today: string = todayISO()): ProgramDate | null {
  const open = PROGRAM_DATES
    .filter(d => d.program === program && d.deadline >= today)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
  return open[0] ?? null
}

/** True only inside the urgency window (0..URGENT_WINDOW_DAYS days out). Past dates are never urgent. */
export function isUrgent(d: ProgramDate, today: string = todayISO()): boolean {
  const n = daysUntil(d.deadline, today)
  return n >= 0 && n <= URGENT_WINDOW_DAYS
}

/** "March 1, 2027" */
export function fmtDeadlineLong(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

/** "Mar 1, 2027" */
export function fmtDeadlineShort(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

/** "Sep 2026" — the month a date was last checked, for the calm (non-urgent) rendering. */
export function fmtVerifiedMonth(d: ProgramDate): string {
  return new Date(`${d.verifiedAt}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', year: 'numeric',
  })
}
