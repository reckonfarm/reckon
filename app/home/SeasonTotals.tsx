import { createClient } from '@/lib/supabase-server'
import { Card } from '@/app/components/ui/Card'
import { isMinorJob, isInProgress } from '@/lib/jobs/display'
import { fetchAnnotations } from '@/lib/jobs/annotations'
import { fetchRunsForJobs } from '@/lib/detections/queries'
import { BALE_MACHINE } from '@/lib/detections/detect-bales'
import { computeFieldBoundary } from '@/lib/jobs/boundary'
import { fmtAcres, fmtDay, fmtDuration } from '@/lib/jobs/format'
import type { TrackPoint } from '@/lib/jobs/derive'

// ─── Season totals — what the machines did, added up ───────────────────────────
// Bales, acres, hours across the working list (dismissed sessions and minor
// noise excluded, same rules as /jobs — a mount bang is not a season). Every
// number keeps the honesty rules of the page it came from:
//   * Bales count only from CONFIRMED baler jobs (machine label = baler) —
//     unconfirmed gate-slam detections stay a question, never a total.
//   * Acres sum only CONFIRMED boundaries — deliberately stricter than the
//     job page, which shows an estimate grade with its caveat on screen. A
//     total has no room for a caveat: summing estimates would be a confident
//     claim built on qualified ones. A field the boundary couldn't confirm
//     contributes hours, never acres; the label says so out loud
//     ("measured on N fields").
//   * Hours are working time (the deriver's duration), every included job.
// A stat with nothing behind it doesn't render as a zero — it doesn't render.
// Per-job boundary recompute is fine at today's job counts; if this ever gets
// slow the acres move into the deriver as a stored column.

interface SeasonJobRow {
  id: string
  started_at: string
  ended_at: string
  duration_s: number
  event_count: number
  multi_field: boolean
  track: TrackPoint[]
}

export default async function SeasonTotals() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('jobs')
    .select('id, started_at, ended_at, duration_s, event_count, multi_field, track')
    .order('started_at', { ascending: true })

  const jobs = (data ?? []) as unknown as SeasonJobRow[]
  if (jobs.length === 0) return null

  const annotations = await fetchAnnotations(supabase, jobs.map(j => j.id))
  const runs = await fetchRunsForJobs(supabase, jobs.map(j => j.id))

  const included = jobs.filter(j =>
    annotations.get(j.id)?.dismissed_at == null && (!isMinorJob(j) || isInProgress(j))
  )
  if (included.length === 0) return null

  let bales = 0
  let acres = 0
  let fields = 0
  let seconds = 0
  for (const j of included) {
    seconds += j.duration_s
    const run = runs.get(j.id)?.find(r => r.detector === 'bale')
    if (run?.outcome === 'detected' && annotations.get(j.id)?.machine === BALE_MACHINE) {
      bales += run.detection_count
    }
    if (j.track.length >= 2) {
      const boundary = computeFieldBoundary(j.track, j.multi_field)
      if (boundary.status === 'confirmed' && boundary.acres != null) {
        acres += boundary.acres
        fields++
      }
    }
  }

  const stats: { value: string; label: string; sub?: string }[] = []
  if (bales > 0) stats.push({ value: bales.toLocaleString(), label: bales === 1 ? 'bale' : 'bales' })
  if (fields > 0) stats.push({ value: fmtAcres(acres), label: 'acres cut', sub: `measured on ${fields} field${fields === 1 ? '' : 's'}` })
  stats.push({ value: fmtDuration(seconds), label: 'working time' })

  return (
    <Card shadow="none" className="px-5 py-4">
      <p className="font-dm-sans text-xs font-medium uppercase tracking-wide text-forest-green/40">
        This season
      </p>
      <div className={`mt-3 grid gap-4 ${stats.length === 3 ? 'grid-cols-3' : stats.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {stats.map(s => (
          <div key={s.label}>
            <p className="font-fraunces text-2xl font-semibold tabular-nums text-forest-green">{s.value}</p>
            <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">{s.label}</p>
            {s.sub && <p className="font-dm-sans text-[11px] text-forest-green/40">{s.sub}</p>}
          </div>
        ))}
      </div>
      <p className="mt-3 font-dm-sans text-xs text-forest-green/40">
        Since {fmtDay(included[0].started_at)} · read straight off the machine.
      </p>
    </Card>
  )
}
