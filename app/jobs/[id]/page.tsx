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
import ActualsCard from './ActualsCard'
import MachineConfirm from './MachineConfirm'
import { isInProgress } from '@/lib/jobs/display'
import { computeFieldBoundary, boundaryQualified, ACRE_M2 } from '@/lib/jobs/boundary'
import { computeSweep } from '@/lib/jobs/sweep'
import { computeEta } from '@/lib/jobs/eta'
import { fmtAcres, fmtDay, fmtDoneAt, fmtEtaMin, fmtTime, fmtDuration, plural, RANCH_TZ } from '@/lib/jobs/format'
import { MACHINE_SUGGESTIONS } from '@/lib/jobs/annotations'
import { fetchRunsForJobs, fetchDetectionsForJob } from '@/lib/detections/queries'
import { BALE_MACHINE, BALE_VERIFY_BELOW } from '@/lib/detections/detect-bales'
import type { TrackPoint } from '@/lib/jobs/derive'

// ─── /jobs/[id] — one work session: the numbers, the map ───────────────────────
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
  multi_field: boolean
  stats: { positionedCount?: number; mgP50?: number | null; mgMax?: number | null }
  deriver_version: string
  derived_at: string
  devices: { name: string } | null
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/signin?next=/jobs/${id}`)

  const { data, error } = await supabase
    .from('jobs')
    .select('id, started_at, ended_at, duration_s, seq_start, seq_end, event_count, evicted_count, coverage, bbox, track, multi_field, stats, deriver_version, derived_at, devices(name)')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) notFound()
  const job = data as unknown as JobRow

  // Annotation is a separate query on purpose — no FK to jobs (037), user
  // intent survives every re-derivation.
  const { data: annotation } = await supabase
    .from('job_annotations')
    .select('name, machine, dismissed_at, actual_bale_count, actual_acres')
    .eq('job_id', id)
    .maybeSingle()
  const name = annotation?.name ?? null
  const machine = (annotation?.machine as string | null) ?? null
  const dismissed = annotation?.dismissed_at != null
  const actualBaleCount = (annotation?.actual_bale_count as number | null) ?? null
  const actualAcres = (annotation?.actual_acres as number | null) ?? null

  // Detections — same two-query, no-FK shape as annotations. baleRun may be
  // undefined either because detection hasn't run or because 038 isn't
  // applied yet; both degrade to "no detection chrome", and a baler-labeled
  // job says so out loud below.
  const runs = (await fetchRunsForJobs(supabase, [id])).get(id) ?? []
  const baleRun = runs.find(r => r.detector === 'bale')
  const detections = baleRun?.outcome === 'detected' ? await fetchDetectionsForJob(supabase, id) : []
  const isBaler = machine === BALE_MACHINE
  const machineLabel = machine == null
    ? null
    : MACHINE_SUGGESTIONS.find(m => m.value === machine)?.label ?? machine
  const weakCount = detections.filter(d => d.confidence < BALE_VERIFY_BELOW).length
  // Pins go on the map only while the label doesn't contradict the detector.
  const balePins = (machine == null || isBaler)
    ? detections
        .filter(d => d.lat != null && d.lng != null)
        .map(d => ({ lat: d.lat!, lng: d.lng!, ts: d.ts, confidence: d.confidence }))
    : []

  const covPct = Math.round(job.coverage * 100)
  const lowCoverage = job.coverage < 0.9
  const live = isInProgress(job)

  // Field boundary + sweep — computed at read time, per job, nothing stored.
  // Grades, not gates: 'confirmed' and 'estimate' both speak (estimate with
  // its caveat on screen); below the gates, silence. ETA rides both grades —
  // remaining ÷ rate come from the same buffered sweep, so a buffer error
  // cancels there exactly as it does in the percentage.
  const boundary = job.track.length >= 2 ? computeFieldBoundary(job.track, job.multi_field) : null
  const qualified = boundary != null && boundaryQualified(boundary.status)
  const isEstimate = boundary?.status === 'estimate'
  const sweep = qualified ? computeSweep(job.track, boundary!, undefined, true) : null
  const etaMinutes = sweep != null ? computeEta(job.track, boundary!).minutes : null
  const cutAcres = sweep != null ? sweep.sweptInsideM2 / ACRE_M2 : null
  const fieldAcres = sweep != null ? sweep.boundaryInsideM2 / ACRE_M2 : null
  // "Mapping the field…" is only for a LIVE machine that hasn't tied off its
  // outside rounds yet. A finished job with no boundary just shows its track,
  // and a mosaic day (unexplained/multi-field) claims nothing at all.
  const mapping =
    live && !qualified && boundary != null &&
    (boundary.status === 'no_loop' || boundary.status === 'too_few_points')

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

        {/* The bale count — a derived fact with provenance. The system
            proposes, the operator confirms; a label that contradicts the
            detector (or exists without a run) degrades loudly, never silently. */}
        {baleRun?.outcome === 'detected' && (machine == null || isBaler) && (
          <Card shadow="none" className="mt-5 px-5 py-4">
            <div className="flex items-baseline gap-3">
              <p className="font-fraunces text-2xl font-semibold text-forest-green">
                {isBaler ? plural(detections.length, 'bale') : `${plural(detections.length, 'gate slam')}`}
              </p>
              {!isBaler && (
                <span className="rounded-full bg-forest-green/10 px-2.5 py-1 font-dm-sans text-[11px] font-semibold uppercase tracking-wide text-forest-green/60">
                  Unconfirmed
                </span>
              )}
            </div>
            <p className="mt-1 font-dm-sans text-xs text-forest-green/55">
              {weakCount > 0 && (
                <>{weakCount} of them unverified — dashed {weakCount === 1 ? 'pin' : 'pins'} on
                the map, worth a look on the ground.{' '}</>
              )}
              Counted from tailgate closes — threshold found in this session&apos;s own data
              ({baleRun.metrics.cut?.toLocaleString()} mg).
            </p>
            {baleRun.coverage < 0.9 && (
              <p className="mt-2 font-dm-sans text-xs font-semibold text-warning">
                Only {Math.round(baleRun.coverage * 100)}% of this session&apos;s events reached the
                ledger — the true count may be higher than what survived.
              </p>
            )}
            {/* Ground truth vs detector — stated side by side, never blended.
                The detector's number stays the detector's number. */}
            {isBaler && actualBaleCount != null && (
              <p className="mt-2 font-dm-sans text-xs text-forest-green/70">
                You counted <span className="font-semibold tabular-nums">{actualBaleCount.toLocaleString()}</span>
                {' — '}the detector found <span className="font-semibold tabular-nums">{detections.length}</span>
                {actualBaleCount === detections.length
                  ? '. Dead on.'
                  : ` (${detections.length > actualBaleCount ? '+' : ''}${detections.length - actualBaleCount}).`}
              </p>
            )}
            <MachineConfirm
              jobId={job.id}
              name={name}
              machine={machine}
              proposedCount={detections.length}
            />
          </Card>
        )}

        {baleRun?.outcome === 'detected' && machine != null && !isBaler && (
          <Card shadow="none" className="mt-5 px-5 py-4">
            <p className="font-dm-sans text-sm text-forest-green/70">
              A gate-slam pattern ({plural(baleRun.detection_count, 'slam')}) was detected here, but
              this session is labeled <span className="font-semibold">{machineLabel}</span> — bales
              aren&apos;t counted.
            </p>
            <MachineConfirm jobId={job.id} name={name} machine={machine} proposedCount={null} />
          </Card>
        )}

        {isBaler && baleRun?.outcome !== 'detected' && (
          <Card shadow="none" className="mt-5 border-warning/40 px-5 py-4">
            <p className="font-dm-sans text-sm text-warning">
              {baleRun == null
                ? 'This session is labeled Baler, but bale detection has not run for it — machine effectively unknown.'
                : baleRun.outcome === 'insufficient_evidence'
                  ? 'This session is labeled Baler, but it holds too little data to count bales.'
                  : 'This session is labeled Baler, but no bale signature was found in its data.'}
            </p>
            <MachineConfirm jobId={job.id} name={name} machine={machine} proposedCount={null} />
          </Card>
        )}

        {/* THE headline card — the one question this page answers: how far
            along is this field. In progress leads with the percent; complete
            leads with what came off. "Cut" never "coverage" — data received
            (the honesty stat) lives in quiet prose below the map. */}
        {sweep != null && (
          <Card shadow="none" className="mt-5 px-5 py-4">
            <p className="font-fraunces text-3xl font-semibold text-forest-green">
              {live
                ? `About ${sweep.percentCut}% cut`
                : `About ${fmtAcres(cutAcres!)} acres cut`}
            </p>
            {live && etaMinutes != null && (
              <p className="mt-0.5 font-fraunces text-xl font-semibold text-forest-green/80">
                About {fmtEtaMin(etaMinutes)} left · done ~{fmtDoneAt(etaMinutes)}
              </p>
            )}
            <p className="mt-1.5 font-dm-sans text-sm text-forest-green/70">
              {live
                ? <>{fmtAcres(cutAcres!)} of about {fmtAcres(fieldAcres!)} acres</>
                : <>of about {fmtAcres(fieldAcres!)} — field traced from your outside rounds</>}
              {actualAcres != null && <> · you call the field {actualAcres}</>}
            </p>
            {isEstimate && (
              <p className="mt-1 font-dm-sans text-xs text-forest-green/55">
                Boundary unconfirmed — one pass around; a second round (or finishing
                the field) confirms it.
              </p>
            )}
          </Card>
        )}
        {mapping && (
          <Card shadow="none" className="mt-5 px-5 py-4">
            <p className="font-fraunces text-3xl font-semibold text-forest-green/70">
              Mapping the field…
            </p>
            <p className="mt-1.5 font-dm-sans text-sm text-forest-green/55">
              The boundary draws itself as the outside rounds tie off. Percent cut
              starts once the loop closes.
            </p>
          </Card>
        )}

        {job.track.length >= 2 ? (
          <div className="mt-5">
            <JobMapLoader
              track={job.track}
              bbox={job.bbox}
              mode={sweep != null ? 'working' : mapping ? 'mapping' : 'plain'}
              bales={balePins}
              boundary={qualified ? boundary!.polygon : null}
              cells={sweep?.cells}
            />
            <p className="mt-2 font-dm-sans text-xs text-forest-green/50">
              {balePins.length > 0
                ? 'Each pin is a detected bale, where it dropped. Tap Track to see the machine’s path underneath.'
                : sweep != null
                  ? 'The outline is the field edge, traced from your outside rounds. Tinted ground is cut.'
                  : 'The line is where the machine worked. Dashed stretches are gaps in the data.'}
            </p>
            {/* The honesty numbers, demoted to a quiet line — loud only when
                something was actually lost. "Data received", never "coverage":
                that word would collide with the field percent above. */}
            <p className="mt-2 font-dm-sans text-xs text-forest-green/50">
              {fmtDuration(job.duration_s)} working
              <span className="text-forest-green/25"> · </span>
              <span className={lowCoverage ? 'font-semibold text-warning' : ''}>{covPct}% data received</span>
            </p>
            {job.evicted_count > 0 && (
              <p className={`mt-1 font-dm-sans text-xs ${lowCoverage ? 'text-warning' : 'text-forest-green/50'}`}>
                The device generated {(job.event_count + job.evicted_count).toLocaleString()} events
                (seq {job.seq_start}–{job.seq_end}) but only {job.event_count.toLocaleString()} reached
                the ledger before the on-device queue overwrote the rest. Everything here
                is built from what survived.
              </p>
            )}
          </div>
        ) : (
          <Card shadow="none" className="mt-5 px-5 py-8 text-center">
            <p className="font-dm-sans text-sm text-forest-green/55">
              No GPS positions in this job — the device had no satellite fix.
            </p>
            <p className="mt-2 font-dm-sans text-xs text-forest-green/50">
              {fmtDuration(job.duration_s)} working
              <span className="text-forest-green/25"> · </span>
              <span className={lowCoverage ? 'font-semibold text-warning' : ''}>{covPct}% data received</span>
            </p>
          </Card>
        )}

        <ActualsCard jobId={job.id} actualBaleCount={actualBaleCount} actualAcres={actualAcres} />

        {/* The Stops card was removed 2026-08-09 (engineering-facing) — but the
            pause DATA is untouched: the deriver still emits jobs.pauses and the
            ETA's rate window still discounts stopped time (lib/jobs/eta.ts reads
            the track's own gaps). Only the card went. */}
        <AnnotationControls jobId={job.id} name={name} dismissed={dismissed} />

        <p className="mt-6 font-dm-sans text-xs text-forest-green/40">
          Derived {new Date(job.derived_at).toLocaleDateString('en-US', { timeZone: RANCH_TZ, month: 'short', day: 'numeric', year: 'numeric' })}
          {' · '}{job.deriver_version}
          {baleRun && <>{' · '}{baleRun.detector_version}</>}
          {' · '}rebuilt from raw events any time the derivation improves
        </p>
      </main>
    </div>
  )
}
