import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { Card } from '@/app/components/ui/Card'
import InProgressBadge from '@/app/jobs/InProgressBadge'
import { isMinorJob, isInProgress } from '@/lib/jobs/display'
import { fetchAnnotations } from '@/lib/jobs/annotations'
import { fetchRunsForJobs } from '@/lib/detections/queries'
import { BALE_MACHINE } from '@/lib/detections/detect-bales'
import { computeFieldBoundaries, boundaryQualified } from '@/lib/jobs/boundary'
import { computeSweep } from '@/lib/jobs/sweep'
import { computeEta } from '@/lib/jobs/eta'
import { dayKey, todayKey, fmtDoneAt, fmtTime, fmtDuration, plural } from '@/lib/jobs/format'
import type { TrackPoint } from '@/lib/jobs/derive'

// ─── The ranch, right now — live and today's jobs on the home surface ──────────
// Two pieces, same doctrine as the LFP alert: LOUD when something is
// happening, silent when nothing is.
//
//   * LiveJobCard — a machine is working RIGHT NOW. Renders in the always-on
//     stack (every view), and carries the HEADLINE NUMBER for the job type:
//     the running bale count when baling, percent cut + ETA when cutting.
//     This is the demo surface — someone opens the app and reads "About 60%
//     cut · about 40 min left" without navigating anywhere.
//   * TodayJobs — today's completed sessions, top of the Today view. Gone at
//     midnight ranch time: at breakfast the slate is clean and history lives
//     one tap away in Jobs.
//
// Both are self-contained async server components behind Suspense with a null
// fallback — quiet content earns no skeleton, and the public dashboard's
// paint never waits on the private jobs query. Signed-out (or no ranch) the
// RLS-scoped query returns nothing and both render nothing: the dashboard
// stays public, and it never nags.

interface NowJobRow {
  id: string
  started_at: string
  ended_at: string
  duration_s: number
  event_count: number
  coverage: number
  multi_field: boolean
  devices: { name: string } | null
}

// The one number that matters for this job, by what the machine is doing.
// Bale count first (a detected run on a baler-or-unlabeled job); percent cut
// + ETA when a verified boundary exists (cutting); honest elapsed time when
// neither speaks. Guards mirror the job page exactly — the card never claims
// what the detail page wouldn't.
async function headlineFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  job: NowJobRow,
  machine: string | null,
  baleRun: { outcome: string; detection_count: number } | undefined
): Promise<string> {
  if (baleRun?.outcome === 'detected') {
    if (machine === BALE_MACHINE) return `${plural(baleRun.detection_count, 'bale')} so far`
    if (machine == null) return `${plural(baleRun.detection_count, 'gate slam')} — baling?`
  }
  // No bale story — try the field-cut story. The track fetch is deferred to
  // here so a baling day never pays for the jsonb column it won't use.
  // Grades mirror the job page (never more confident than the detail): the
  // estimate grade speaks its caveat and drops the ETA — a finish time built
  // on an unconfirmed boundary is not a glanceable promise. A multi-field
  // session segments (same machinery as the job page) and the card speaks for
  // the field the machine is IN — the one holding the track's last point —
  // named so the number can't be read as the whole session's.
  const { data } = await supabase.from('jobs').select('track').eq('id', job.id).maybeSingle()
  const track = (data?.track ?? []) as TrackPoint[]
  if (track.length >= 2) {
    const fields = computeFieldBoundaries(track, job.multi_field)
    const segmented = job.multi_field && fields.length >= 2
    const lastSeq = track[track.length - 1].seq
    const f = segmented
      ? fields.find(x => x.track.length > 0 && x.track[x.track.length - 1].seq === lastSeq) ?? null
      : fields[0] ?? null
    if (f != null && boundaryQualified(f.boundary.status)) {
      const sweep = computeSweep(f.track, f.boundary)
      if (sweep != null) {
        // Floor-honest: an undersampled sweep says "at least", never "about",
        // and gets no done-clock — an ETA built on an undercounted cut can
        // only ever read too long.
        const qual = sweep.sweepIsFloor ? 'at least' : 'about'
        const lead = segmented
          ? `Field ${f.index}: ${qual}`
          : qual.charAt(0).toUpperCase() + qual.slice(1)
        if (f.boundary.status === 'estimate') return `${lead} ${sweep.percentCut}% cut · unconfirmed boundary`
        const eta = sweep.sweepIsFloor ? null : computeEta(f.track, f.boundary).minutes
        return `${lead} ${sweep.percentCut}% cut${eta != null ? ` · done ~${fmtDoneAt(eta)}` : ''}`
      }
    }
  }
  return `${fmtDuration(job.duration_s)} in`
}

export async function LiveJobCard() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('jobs')
    .select('id, started_at, ended_at, duration_s, event_count, coverage, multi_field, devices(name)')
    .order('ended_at', { ascending: false })
    .limit(6)

  const live = ((data ?? []) as unknown as NowJobRow[]).filter(j => isInProgress(j))
  if (live.length === 0) return null

  const annotations = await fetchAnnotations(supabase, live.map(j => j.id))
  const runs = await fetchRunsForJobs(supabase, live.map(j => j.id))

  return (
    <>
      {await Promise.all(live.map(async j => {
        const machine = annotations.get(j.id)?.machine ?? null
        const name = annotations.get(j.id)?.name ?? null
        const baleRun = runs.get(j.id)?.find(r => r.detector === 'bale')
        const headline = await headlineFor(supabase, j, machine, baleRun)
        return (
          <Link key={j.id} href={`/jobs/${j.id}`} className="block">
            <Card shadow="sm" className="border-forest-green/20 px-5 py-4 transition-colors hover:bg-forest-green/[0.03]">
              <div className="flex items-center gap-2">
                <p className="font-dm-sans text-xs font-medium uppercase tracking-wider text-forest-green/50">
                  On the ranch now
                </p>
                <InProgressBadge />
              </div>
              <p className="mt-1.5 font-fraunces text-2xl font-semibold text-forest-green">
                {headline}
              </p>
              <p className="mt-1 font-dm-sans text-xs text-forest-green/55">
                {name && <>{name}<span className="text-forest-green/25"> · </span></>}
                since {fmtTime(j.started_at)} MT
                <span className="text-forest-green/25"> · </span>
                {j.devices?.name ?? 'Unknown device'}
                <span className="text-forest-green/25"> · </span>
                {fmtDuration(j.duration_s)} working
              </p>
            </Card>
          </Link>
        )
      }))}
    </>
  )
}

export async function TodayJobs() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('jobs')
    .select('id, started_at, ended_at, duration_s, event_count, coverage, multi_field, devices(name)')
    .order('started_at', { ascending: false })
    .limit(20)

  const jobs = (data ?? []) as unknown as NowJobRow[]
  const today = todayKey()
  const doneIds = jobs
    .filter(j => dayKey(j.ended_at) === today && !isInProgress(j))
    .map(j => j.id)
  if (doneIds.length === 0) return null

  const annotations = await fetchAnnotations(supabase, doneIds)
  const runs = await fetchRunsForJobs(supabase, doneIds)
  const done = jobs.filter(j =>
    doneIds.includes(j.id) &&
    annotations.get(j.id)?.dismissed_at == null &&
    !isMinorJob(j)
  )
  if (done.length === 0) return null

  const baleLine = (j: NowJobRow): string | null => {
    const run = runs.get(j.id)?.find(r => r.detector === 'bale')
    if (run?.outcome !== 'detected') return null
    const machine = annotations.get(j.id)?.machine ?? null
    if (machine === BALE_MACHINE) return plural(run.detection_count, 'bale')
    if (machine == null) return `${plural(run.detection_count, 'gate slam')} — baling?`
    return null
  }

  return (
    <div>
      <p className="mb-3 font-dm-sans text-xs font-medium uppercase tracking-wide text-forest-green/40">
        Today on the ranch
      </p>
      <div className="space-y-3">
        {done.map(j => {
          const name = annotations.get(j.id)?.name ?? null
          const bales = baleLine(j)
          return (
            <Link key={j.id} href={`/jobs/${j.id}`} className="block">
              <Card shadow="none" className="px-5 py-4 transition-colors hover:bg-forest-green/[0.03]">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-fraunces text-base font-semibold text-forest-green">
                      {name ?? <>{fmtTime(j.started_at)} – {fmtTime(j.ended_at)} MT</>}
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
    </div>
  )
}
