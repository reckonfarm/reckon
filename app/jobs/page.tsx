import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Heading } from '@/app/components/ui/Heading'
import { Card } from '@/app/components/ui/Card'
import AutoRefresh from './AutoRefresh'
import InProgressBadge from './InProgressBadge'
import DeviceLiveness from './DeviceLiveness'
import RestoreButton from './RestoreButton'
import { isMinorJob, isInProgress } from '@/lib/jobs/display'
import { fetchAnnotations } from '@/lib/jobs/annotations'
import { fetchRunsForJobs } from '@/lib/detections/queries'
import { BALE_MACHINE } from '@/lib/detections/detect-bales'
import { dayKey, todayKey, fmtDay, fmtTime, fmtDuration, plural } from '@/lib/jobs/format'
import { computeFieldBoundaries } from '@/lib/jobs/boundary'
import type { TrackPoint } from '@/lib/jobs/derive'

// ─── /jobs — the work-session ledger (P1's face) ───────────────────────────────
// One card per derived job: when, how long, how many impacts, and — always —
// coverage. The seq counter tells us how many events the device generated, so
// a day where the queue ate 66% of them says so on its face. A low-coverage
// job must never look complete; that number is the product being honest.
//
// Minor sessions (short OR sparse — lib/jobs/display.ts) and user-dismissed
// sessions (job_annotations, 037) hide from the default list behind ?all=1.
// DISPLAY ONLY: the deriver emits them regardless, and the toggle says how
// many are hidden so nothing silently disappears. Dismiss ≠ delete — derived
// rows are rewritten every cron tick, so deletion is meaningless by design.
// Auth-gated like /devices; reads via the user-scoped SSR client so the jobs
// RLS policy (036) is exercised, not bypassed.

export const dynamic = 'force-dynamic'

interface JobListRow {
  id: string
  started_at: string
  ended_at: string
  duration_s: number
  event_count: number
  evicted_count: number
  coverage: number
  multi_field: boolean
  devices: { name: string } | null
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>
}) {
  const { all } = await searchParams
  const showAll = all === '1'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/jobs')

  const { data, error } = await supabase
    .from('jobs')
    .select('id, started_at, ended_at, duration_s, event_count, evicted_count, coverage, multi_field, devices(name)')
    .order('started_at', { ascending: false })
    .limit(100)

  const jobs = (data ?? []) as unknown as JobListRow[]

  // Annotations are a separate query, merged here — no FK to jobs (037), so
  // PostgREST can't embed, and that's by design: re-derivation never touches
  // user intent.
  const annotations = await fetchAnnotations(supabase, jobs.map(j => j.id))
  const isDismissed = (j: JobListRow) => annotations.get(j.id)?.dismissed_at != null

  // Detection runs, same no-FK merge shape. On the list a bale count speaks
  // only when it exists: confirmed jobs say "N bales", unconfirmed detected
  // jobs pose the question the detail page answers.
  const detectionRuns = await fetchRunsForJobs(supabase, jobs.map(j => j.id))
  const baleLine = (j: JobListRow): string | null => {
    const run = detectionRuns.get(j.id)?.find(r => r.detector === 'bale')
    if (run?.outcome !== 'detected') return null
    const machine = annotations.get(j.id)?.machine ?? null
    if (machine === BALE_MACHINE) return plural(run.detection_count, 'bale')
    if (machine == null) return `${plural(run.detection_count, 'gate slam')} — baling?`
    return null // labeled as another machine: the label wins on the list
  }

  // Multi-field rows say what their fields earned ("3 fields · 2 confirmed"),
  // not just that a road was crossed. That needs the track jsonb — fetched in
  // a second query for ONLY the multi-field rows (rare), so the list never
  // pays for the column it mostly doesn't use. Grades come from the same
  // segmenter the detail page runs; the count speaks only CONFIRMED fields —
  // an estimate keeps its caveat on the detail page, never in a summary.
  const multiIds = jobs.filter(j => j.multi_field).map(j => j.id)
  const fieldSummaries = new Map<string, string>()
  if (multiIds.length > 0) {
    const { data: trackRows } = await supabase
      .from('jobs')
      .select('id, track')
      .in('id', multiIds)
    for (const row of trackRows ?? []) {
      const track = (row.track ?? []) as TrackPoint[]
      if (track.length < 2) continue
      const fields = computeFieldBoundaries(track, true)
      if (fields.length < 2) continue
      const confirmed = fields.filter(f => f.boundary.status === 'confirmed').length
      fieldSummaries.set(
        row.id as string,
        `${fields.length} fields${confirmed > 0 ? ` · ${confirmed} confirmed` : ''}`
      )
    }
  }

  // Liveness: real devices only (bench convention: 'bench-' prefix stays out
  // of rancher-facing surfaces).
  const { data: deviceRows } = await supabase
    .from('devices')
    .select('name, last_seen, hardware_id')
    .order('last_seen', { ascending: false, nullsFirst: false })
  const liveDevices = (deviceRows ?? [])
    .filter(d => !d.hardware_id?.startsWith('bench-'))
    .map(d => ({ name: d.name as string | null, lastSeen: d.last_seen as string | null }))

  // Hidden = dismissed by the user, or below the minor floor. In-progress
  // jobs are exempt from the minor floor (a live job's first minutes are
  // short and sparse by definition — hiding the one session someone is
  // actively watching would be the worst possible miss), but an explicit
  // dismissal always wins.
  const hiddenCount = jobs.filter(j => isDismissed(j) || (isMinorJob(j) && !isInProgress(j))).length
  const visible = showAll
    ? jobs
    : jobs.filter(j => !isDismissed(j) && (!isMinorJob(j) || isInProgress(j)))

  // Group by ranch day (input is started_at desc, so days come out newest
  // first). An empty "Today" section still renders when older jobs exist —
  // on a work morning the page should read as watching, not as done.
  const today = todayKey()
  const groups: { key: string; jobs: JobListRow[] }[] = []
  for (const j of visible) {
    const k = dayKey(j.started_at)
    const last = groups[groups.length - 1]
    if (last && last.key === k) last.jobs.push(j)
    else groups.push({ key: k, jobs: [j] })
  }
  const showEmptyToday = visible.length > 0 && groups[0]?.key !== today

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <AutoRefresh />
      <main className="mx-auto max-w-2xl px-4 py-10 pb-24 sm:px-6 md:pb-10">
        <Heading level={1} className="!text-2xl sm:!text-3xl">Jobs</Heading>
        <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
          Work sessions, read straight off the machine. Nobody wrote anything down.
        </p>
        <DeviceLiveness devices={liveDevices} />

        <div className="mt-6 space-y-5">
          {error && (
            <Card shadow="none" className="px-5 py-6 text-center">
              <p className="font-dm-sans text-sm text-forest-green/55">
                Jobs are temporarily unavailable.
              </p>
            </Card>
          )}

          {!error && visible.length === 0 && (
            <Card shadow="none" className="px-5 py-8 text-center">
              <p className="font-dm-sans text-sm text-forest-green/55">
                {jobs.length === 0
                  ? 'No jobs yet. Put a Scout on a machine and go to work.'
                  : 'Nothing to show — every session is minor or dismissed. Show all below.'}
              </p>
            </Card>
          )}

          {showEmptyToday && (
            <section>
              <h2 className="px-1 font-dm-sans text-xs font-semibold uppercase tracking-wide text-forest-green/45">
                Today
              </h2>
              <p className="mt-2 px-1 pb-1 font-dm-sans text-sm text-forest-green/45">
                No sessions yet today.
              </p>
            </section>
          )}

          {groups.map(g => (
            <section key={g.key}>
              <h2 className="px-1 pt-2 font-dm-sans text-xs font-semibold uppercase tracking-wide text-forest-green/45">
                {g.key === today ? 'Today' : fmtDay(g.jobs[0].started_at)}
                <span className="font-normal normal-case text-forest-green/40">
                  {' · '}{plural(g.jobs.length, 'session')}{' · '}{fmtDuration(g.jobs.reduce((s, j) => s + j.duration_s, 0))}
                </span>
              </h2>
              <div className="mt-2 space-y-3">
                {g.jobs.map(j => {
                  const covPct = Math.round(j.coverage * 100)
                  const lowCoverage = j.coverage < 0.9
                  const live = isInProgress(j)
                  const name = annotations.get(j.id)?.name ?? null
                  const dismissed = isDismissed(j)
                  return (
                    <Link key={j.id} href={`/jobs/${j.id}`} className="block">
                      <Card shadow="none" className={`px-5 py-4 transition-colors hover:bg-forest-green/[0.03] ${dismissed ? 'opacity-70' : ''}`}>
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate font-fraunces text-base font-semibold text-forest-green sm:text-lg">
                              {name ?? <>{fmtTime(j.started_at)} – {fmtTime(j.ended_at)} MT</>}
                              {live && <InProgressBadge />}
                            </p>
                            <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">
                              {name && (
                                <>
                                  {fmtTime(j.started_at)} – {fmtTime(j.ended_at)} MT
                                  <span className="text-forest-green/25"> · </span>
                                </>
                              )}
                              {j.devices?.name ?? 'Unknown device'}
                              {j.multi_field && (
                                <>
                                  <span className="text-forest-green/25"> · </span>
                                  <span className="font-semibold text-forest-green/70">
                                    {fieldSummaries.get(j.id) ?? 'Multi-field'}
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-dm-sans text-sm font-semibold tabular-nums text-forest-green">
                              {fmtDuration(j.duration_s)}
                            </p>
                            {/* Data received is spoken only when it's a problem —
                                near-100% days say nothing (silence = normal). Named
                                "data received", never "coverage": field percent-cut
                                owns the coverage-shaped idea on the detail page. */}
                            {lowCoverage && (
                              <p className="mt-0.5 font-dm-sans text-xs font-semibold tabular-nums text-warning">
                                {covPct}% data received
                              </p>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 font-dm-sans text-xs tabular-nums text-forest-green/50">
                          {plural(j.event_count, 'impact')} recorded
                          {baleLine(j) && (
                            <>
                              {' · '}
                              <span className="font-semibold text-forest-green/80">{baleLine(j)}</span>
                            </>
                          )}
                          {j.evicted_count > 0 && (
                            <> · {j.evicted_count.toLocaleString()} lost before sync</>
                          )}
                        </p>
                        {dismissed && (
                          <div className="mt-3 flex items-center justify-between gap-3 border-t border-forest-green/10 pt-3">
                            <p className="font-dm-sans text-xs text-forest-green/50">
                              Dismissed — hidden from the default list.
                            </p>
                            <RestoreButton jobId={j.id} />
                          </div>
                        )}
                      </Card>
                    </Link>
                  )
                })}
              </div>
            </section>
          ))}

          {!error && hiddenCount > 0 && (
            <div className="pt-1 text-center">
              <Link
                href={showAll ? '/jobs' : '/jobs?all=1'}
                className="inline-block rounded-lg px-4 py-2 font-dm-sans text-sm text-forest-green/60 hover:text-forest-green"
              >
                {showAll
                  ? 'Back to the working list'
                  : `Show all sessions (${plural(hiddenCount, 'session')} hidden)`}
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
