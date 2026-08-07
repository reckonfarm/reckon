import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Heading } from '@/app/components/ui/Heading'
import { Card } from '@/app/components/ui/Card'
import JobMapLoader from './JobMapLoader'
import AutoRefresh from '../AutoRefresh'
import InProgressBadge from '../InProgressBadge'
import AnnotationControls from './AnnotationControls'
import { isInProgress } from '@/lib/jobs/display'
import { fmtDay, fmtTime, fmtDuration, plural, RANCH_TZ } from '@/lib/jobs/format'
import type { TrackPoint, JobPause } from '@/lib/jobs/derive'

// ─── /jobs/[id] — one work session: the numbers, the pauses, the map ───────────
// The map draws only what the ledger actually holds: solid line = consecutive
// recorded impacts, dashed = a gap (evicted events or silence) — it never
// implies a path we didn't observe. Coverage and derivation provenance are on
// the page because a rebuilt artifact should say when and by what it was built.

export const dynamic = 'force-dynamic'

interface JobRow {
  id: string
  started_at: string
  ended_at: string
  duration_s: number
  seq_start: number
  seq_end: number
  event_count: number
  evicted_count: number
  coverage: number
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null
  track: TrackPoint[]
  pauses: JobPause[]
  multi_field: boolean
  stats: { positionedCount?: number; mgP50?: number | null; mgMax?: number | null }
  deriver_version: string
  derived_at: string
  devices: { name: string } | null
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className={`font-dm-sans text-lg font-semibold tabular-nums sm:text-xl ${warn ? 'text-warning' : 'text-forest-green'}`}>
        {value}
      </p>
      <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">{label}</p>
    </div>
  )
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/signin?next=/jobs/${id}`)

  const { data, error } = await supabase
    .from('jobs')
    .select('id, started_at, ended_at, duration_s, seq_start, seq_end, event_count, evicted_count, coverage, bbox, track, pauses, multi_field, stats, deriver_version, derived_at, devices(name)')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) notFound()
  const job = data as unknown as JobRow

  // Annotation is a separate query on purpose — no FK to jobs (037), user
  // intent survives every re-derivation.
  const { data: annotation } = await supabase
    .from('job_annotations')
    .select('name, dismissed_at')
    .eq('job_id', id)
    .maybeSingle()
  const name = annotation?.name ?? null
  const dismissed = annotation?.dismissed_at != null

  const covPct = Math.round(job.coverage * 100)
  const lowCoverage = job.coverage < 0.9
  const live = isInProgress(job)

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <AutoRefresh />
      <main className="mx-auto max-w-3xl px-4 py-10 pb-24 sm:px-6 md:pb-10">
        <Link href="/jobs" className="font-dm-sans text-sm text-forest-green/60 hover:text-forest-green">
          ← All jobs
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Heading level={1} className="!text-2xl sm:!text-3xl">
            {name ?? fmtDay(job.started_at, 'long')}
          </Heading>
          {live && <InProgressBadge />}
          {dismissed && (
            <span className="rounded-full bg-forest-green/10 px-2.5 py-1 font-dm-sans text-[11px] font-semibold uppercase tracking-wide text-forest-green/60">
              Dismissed
            </span>
          )}
        </div>
        <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
          {name && (
            <>
              {fmtDay(job.started_at)}
              <span className="text-forest-green/25"> · </span>
            </>
          )}
          {fmtTime(job.started_at)} – {fmtTime(job.ended_at)} MT
          <span className="text-forest-green/25"> · </span>
          {job.devices?.name ?? 'Unknown device'}
        </p>

        {job.multi_field && (
          <Card shadow="none" className="mt-4 border-warning/40 px-5 py-3">
            <p className="font-dm-sans text-sm text-warning">
              This track spans more than one work area. Acreage from its outline
              would include the road between them — treat area numbers with care.
            </p>
          </Card>
        )}

        <Card shadow="none" className="mt-5 px-5 py-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Working time" value={fmtDuration(job.duration_s)} />
            <Stat label="Impacts recorded" value={job.event_count.toLocaleString()} />
            <Stat label="Lost before sync" value={job.evicted_count.toLocaleString()} />
            <Stat label="Coverage" value={`${covPct}%`} warn={lowCoverage} />
          </div>
          {lowCoverage && (
            <p className="mt-3 font-dm-sans text-xs text-warning">
              The device generated {(job.event_count + job.evicted_count).toLocaleString()} events
              (seq {job.seq_start}–{job.seq_end}) but only {job.event_count.toLocaleString()} reached
              the ledger before the on-device queue overwrote the rest. Times and totals
              below are built from what survived.
            </p>
          )}
        </Card>

        {job.track.length >= 2 ? (
          <div className="mt-5">
            <JobMapLoader track={job.track} bbox={job.bbox} />
            <p className="mt-2 font-dm-sans text-xs text-forest-green/50">
              Solid line: consecutive recorded impacts. Dashed: a gap — lost events or
              silence — where the actual path was not observed.
            </p>
          </div>
        ) : (
          <Card shadow="none" className="mt-5 px-5 py-8 text-center">
            <p className="font-dm-sans text-sm text-forest-green/55">
              No GPS positions in this job — the device had no satellite fix.
            </p>
          </Card>
        )}

        {job.pauses.length > 0 && (
          <Card shadow="none" className="mt-5 px-5 py-4">
            <p className="font-fraunces text-base font-semibold text-forest-green">Stops</p>
            <ul className="mt-2 space-y-1.5">
              {job.pauses.map((p, i) => (
                <li key={i} className="font-dm-sans text-sm text-forest-green/70">
                  <span className="tabular-nums font-semibold text-forest-green">{fmtTime(p.atIso)}</span>
                  {' · '}
                  {p.kind === 'observed'
                    ? `stopped ${Math.round(p.durationS / 60)} min`
                    : `stopped ~${Math.round(p.durationS / 60)} min (estimated — ${plural(p.missing, 'event')} ${p.missing === 1 ? 'was' : 'were'} lost around this stop, so the exact timing is uncertain)`}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <AnnotationControls jobId={job.id} name={name} dismissed={dismissed} />

        <p className="mt-6 font-dm-sans text-xs text-forest-green/40">
          Derived {new Date(job.derived_at).toLocaleDateString('en-US', { timeZone: RANCH_TZ, month: 'short', day: 'numeric', year: 'numeric' })}
          {' · '}{job.deriver_version}
          {' · '}rebuilt from raw events any time the derivation improves
        </p>
      </main>
    </div>
  )
}
