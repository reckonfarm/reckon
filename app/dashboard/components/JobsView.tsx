import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Card } from '@/app/components/ui/Card'
import InProgressBadge from '@/app/jobs/InProgressBadge'
import { isMinorJob, isInProgress } from '@/lib/jobs/display'
import { fetchAnnotations } from '@/lib/jobs/annotations'
import { fetchRunsForJobs } from '@/lib/detections/queries'
import { BALE_MACHINE } from '@/lib/detections/detect-bales'
import { dayKey, todayKey, fmtDay, fmtTime, fmtDuration, plural } from '@/lib/jobs/format'

// ─── Jobs — the dashboard view that replaced Activity (2026-08-09) ─────────────
// Activity was a flat list of raw ledger events — a debug view. Jobs is the
// product: derived work sessions, day-grouped, newest first, each row one tap
// from its detail page. This is the COMPACT read (recent days, capped);
// /jobs remains the full ledger with show-all, restore, and liveness.
//
// Same shape rules as /jobs: minor sessions hide unless in progress, an
// explicit dismissal always wins, bale counts speak only when they exist.
// Same privacy rules as the old ActivityFeed: the dashboard is public, the
// ranch ledger is not — signed-out gets the honest gate, never fake-empty.

const ROW_CAP = 12

interface JobRow {
  id: string
  started_at: string
  ended_at: string
  duration_s: number
  event_count: number
  coverage: number
  devices: { name: string } | null
}

export function JobsViewSkeleton() {
  return (
    <Card shadow="none" className="px-5 py-2">
      <style>{`@keyframes dlJobsPulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
      {[0, 1, 2].map(i => (
        <div key={i} className="py-3" style={{ animation: 'dlJobsPulse 1.6s ease-in-out infinite' }}>
          <div className="h-4 w-2/5 rounded bg-forest-green/10" />
          <div className="mt-2 h-3 w-3/5 rounded bg-forest-green/10" />
        </div>
      ))}
    </Card>
  )
}

export default async function JobsView() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <Card shadow="none" className="px-5 py-8 text-center">
        <p className="font-dm-sans text-sm text-forest-green/70">
          The ranch ledger is private.
        </p>
        <Link
          href="/signin"
          className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-forest-green px-5 font-dm-sans text-sm font-medium text-cream transition-colors hover:bg-forest-green/90"
        >
          Sign in to see your jobs
        </Link>
      </Card>
    )
  }

  const { data, error } = await supabase
    .from('jobs')
    .select('id, started_at, ended_at, duration_s, event_count, coverage, devices(name)')
    .order('started_at', { ascending: false })
    .limit(40)

  if (error) {
    return (
      <Card shadow="none" className="px-5 py-8 text-center">
        <p className="font-dm-sans text-sm text-forest-green/55">
          Jobs are temporarily unavailable.
        </p>
      </Card>
    )
  }

  const jobs = (data ?? []) as unknown as JobRow[]
  const annotations = await fetchAnnotations(supabase, jobs.map(j => j.id))
  const detectionRuns = await fetchRunsForJobs(supabase, jobs.map(j => j.id))

  const baleLine = (j: JobRow): string | null => {
    const run = detectionRuns.get(j.id)?.find(r => r.detector === 'bale')
    if (run?.outcome !== 'detected') return null
    const machine = annotations.get(j.id)?.machine ?? null
    if (machine === BALE_MACHINE) return plural(run.detection_count, 'bale')
    if (machine == null) return `${plural(run.detection_count, 'gate slam')} — baling?`
    return null
  }

  const visible = jobs
    .filter(j => annotations.get(j.id)?.dismissed_at == null && (!isMinorJob(j) || isInProgress(j)))
    .slice(0, ROW_CAP)

  if (visible.length === 0) {
    return (
      <Card shadow="none" className="px-5 py-8 text-center">
        <p className="font-dm-sans text-sm text-forest-green/55">
          {jobs.length === 0
            ? 'No jobs yet. Put a Scout on a machine and go to work.'
            : 'Nothing recent to show — the full list lives under All sessions.'}
        </p>
        <Link href="/jobs" className="mt-2 inline-block font-dm-sans text-sm font-semibold text-forest-green/70 hover:text-forest-green">
          All sessions →
        </Link>
      </Card>
    )
  }

  const today = todayKey()
  const groups: { key: string; jobs: JobRow[] }[] = []
  for (const j of visible) {
    const k = dayKey(j.started_at)
    const last = groups[groups.length - 1]
    if (last && last.key === k) last.jobs.push(j)
    else groups.push({ key: k, jobs: [j] })
  }

  return (
    <div className="space-y-5">
      {groups.map(g => (
        <section key={g.key}>
          <h2 className="px-1 font-dm-sans text-xs font-semibold uppercase tracking-wide text-forest-green/45">
            {g.key === today ? 'Today' : fmtDay(g.jobs[0].started_at)}
            <span className="font-normal normal-case text-forest-green/40">
              {' · '}{plural(g.jobs.length, 'session')}{' · '}{fmtDuration(g.jobs.reduce((s, j) => s + j.duration_s, 0))}
            </span>
          </h2>
          <div className="mt-2 space-y-3">
            {g.jobs.map(j => {
              const live = isInProgress(j)
              const name = annotations.get(j.id)?.name ?? null
              const bales = baleLine(j)
              return (
                <Link key={j.id} href={`/jobs/${j.id}`} className="block">
                  <Card shadow="none" className="px-5 py-4 transition-colors hover:bg-forest-green/[0.03]">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate font-fraunces text-base font-semibold text-forest-green">
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
                          {bales && (
                            <>
                              <span className="text-forest-green/25"> · </span>
                              <span className="font-semibold text-forest-green/80">{bales}</span>
                            </>
                          )}
                        </p>
                      </div>
                      <p className="shrink-0 font-dm-sans text-sm font-semibold tabular-nums text-forest-green">
                        {fmtDuration(j.duration_s)}
                      </p>
                    </div>
                  </Card>
                </Link>
              )
            })}
          </div>
        </section>
      ))}
      <p className="text-center">
        <Link href="/jobs" className="inline-block rounded-lg px-4 py-2 font-dm-sans text-sm text-forest-green/60 hover:text-forest-green">
          All sessions →
        </Link>
      </p>
    </div>
  )
}
