import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import type { UpcomingDeadlinesResult, UpcomingDeadline } from '@/lib/rma-deadline-service'

// Crop-insurance deadline countdown. Reads a discriminated result from
// lib/rma-deadline-service.ts and renders each state honestly — a real countdown only
// when there's an upcoming date; otherwise honest absence / unavailable copy. Never a
// zero or negative countdown, never a past date shown as upcoming.

const EYEBROW = 'text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide'

// Plain-language labels for the seeded slugs (fallback: de-underscore).
const TYPE_LABELS: Record<string, string> = {
  sales_closing:        'sales closing',
  acreage_reporting:    'acreage reporting',
  production_reporting: 'production reporting',
  premium_billing:      'premium billing',
}
const CROP_LABELS: Record<string, string> = {
  spring_wheat:     'spring wheat',
  perennial_forage: 'perennial forage',
  alfalfa:          'alfalfa',
  prf:              'PRF',
  lrp:              'LRP',
  // Program-level obligations (not real crops) — clean labels for the agency filings.
  fsa_acreage:      'seeded-acres report',
  rma_acreage:      'crop insurance acreage report',
}

// Program-level rows (state-wide filings every producer makes) read with the AGENCY up
// front and their own phrasing — NOT the "{verb} for {crop}" crop template. Presence in
// this map = "this is a program row"; the value is its short agency tag. Mirrors
// PROGRAM_LEVEL in lib/rma-deadline-service.ts (the always-show set).
const PROGRAM_AGENCY: Record<string, string> = {
  fsa_acreage: 'FSA',
  rma_acreage: 'RMA',
}
function agencyOf(cropOrProgram: string): string | null {
  return PROGRAM_AGENCY[cropOrProgram] ?? null
}

function deUnderscore(s: string): string {
  return s.replace(/_/g, ' ')
}
function typeLabel(s: string): string {
  return TYPE_LABELS[s] ?? deUnderscore(s)
}
function cropLabel(s: string): string {
  return CROP_LABELS[s] ?? deUnderscore(s)
}

// One deadline's title line. Program-level rows lead with the agency ("FSA · seeded-acres
// report"); real-crop rows keep the existing "{verb} for {crop}" phrasing
// ("sales closing for spring wheat"). `lead` prefixes the crop-row verb with "until" for
// the hero, and omits it for the compact list rows.
function DeadlineTitle({ d, lead }: { d: UpcomingDeadline; lead: boolean }) {
  const agency = agencyOf(d.crop_or_program)
  if (agency) {
    return (
      <>
        <span className="font-medium text-forest-green">{agency}</span>
        {' · '}{cropLabel(d.crop_or_program)}
      </>
    )
  }
  return (
    <>
      {lead ? 'until ' : ''}{typeLabel(d.deadline_type)} for {cropLabel(d.crop_or_program)}
    </>
  )
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function countdownText(daysUntil: number): string {
  if (daysUntil <= 0) return 'Today'
  return `${daysUntil} day${daysUntil !== 1 ? 's' : ''}`
}

// Defensive county label — append "County" only when the name doesn't already end with
// it (mirrors the guard in PrecipForecastSection so we never read "X County County").
function countyLabel(name: string): string {
  const n = name.trim()
  return /\bcounty$/i.test(n) ? n : `${n} County`
}

// Source/freshness line. as_of is the soonest row's verification date when present.
function FreshnessLine({ asOf }: { asOf: string | null }) {
  return (
    <p className="mt-3 text-xs text-forest-green/40 font-dm-sans">
      USDA RMA/FSA{asOf ? ` · as of ${fmtDate(asOf)}` : ''}
    </p>
  )
}

function Hero({ d }: { d: UpcomingDeadline }) {
  return (
    <div>
      <p className="font-fraunces text-3xl font-semibold leading-none tracking-tight tabular-nums text-forest-green sm:text-4xl">
        {countdownText(d.daysUntil)}
      </p>
      <p className="mt-2 font-dm-sans text-sm text-forest-green/60">
        <DeadlineTitle d={d} lead />
        <span className="text-forest-green/40"> · {fmtDate(d.deadline_date)}</span>
      </p>
    </div>
  )
}

export default function DeadlineCountdownCard({
  result,
  countyName,
}: {
  result: UpcomingDeadlinesResult
  countyName: string
}) {
  return (
    <Card shadow="soft" className="p-4 sm:p-6">
      <div className="mb-3">
        <p className={EYEBROW}>Crop insurance</p>
        <Heading level={5} className="mt-1">Insurance deadlines</Heading>
      </div>

      {result.status === 'data_unavailable' && (
        <p className="text-sm text-forest-green/50 font-dm-sans">
          Deadline data temporarily unavailable — check back shortly.
        </p>
      )}

      {result.status === 'none' && (
        <>
          <p className="font-fraunces text-base font-semibold leading-snug text-forest-green/50 sm:text-lg">
            No upcoming insurance deadlines listed for {countyLabel(countyName)}.
          </p>
          <FreshnessLine asOf={null} />
        </>
      )}

      {result.status === 'ok' && (
        <>
          <Hero d={result.deadlines[0]} />

          {result.deadlines.length > 1 && (
            <ul className="mt-4 space-y-2 border-t border-forest-green/[0.08] pt-3">
              {result.deadlines.slice(1).map((d, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 font-dm-sans text-sm">
                  <span className="text-forest-green/70">
                    <DeadlineTitle d={d} lead={false} />
                  </span>
                  <span className="shrink-0 text-forest-green/50 tabular-nums">
                    {fmtDate(d.deadline_date)} · {countdownText(d.daysUntil)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <FreshnessLine asOf={result.deadlines[0].as_of} />
        </>
      )}
    </Card>
  )
}
