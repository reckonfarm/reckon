import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import { Heading } from '@/app/components/ui/Heading'
import { Card } from '@/app/components/ui/Card'
import AutoRefresh from './AutoRefresh'
import { isMinorJob } from '@/lib/jobs/display'
import { fmtDay, fmtTime, fmtDuration, plural } from '@/lib/jobs/format'

// ─── /jobs — the work-session ledger (P1's face) ───────────────────────────────
// One card per derived job: when, how long, how many impacts, and — always —
// coverage. The seq counter tells us how many events the device generated, so
// a day where the queue ate 66% of them says so on its face. A low-coverage
// job must never look complete; that number is the product being honest.
//
// Minor sessions (short OR sparse — lib/jobs/display.ts) hide from the default
// list behind ?all=1. DISPLAY ONLY: the deriver emits them regardless, and
// the toggle says how many are hidden so nothing silently disappears.
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
  const minorCount = jobs.filter(isMinorJob).length
  const visible = showAll ? jobs : jobs.filter(j => !isMinorJob(j))

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <AutoRefresh />
      <main className="mx-auto max-w-2xl px-4 py-10 pb-24 sm:px-6 md:pb-10">
        <Heading level={1} className="!text-2xl sm:!text-3xl">Jobs</Heading>
        <p className="mt-1 font-dm-sans text-sm text-forest-green/60">
          Work sessions, read straight off the machine. Nobody wrote anything down.
        </p>

        <div className="mt-6 space-y-3">
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
                  : 'Only minor sessions so far — show all below.'}
              </p>
            </Card>
          )}

          {visible.map(j => {
            const covPct = Math.round(j.coverage * 100)
            const lowCoverage = j.coverage < 0.9
            return (
              <Link key={j.id} href={`/jobs/${j.id}`} className="block">
                <Card shadow="none" className="px-5 py-4 transition-colors hover:bg-forest-green/[0.03]">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-fraunces text-base font-semibold text-forest-green sm:text-lg">
                        {fmtDay(j.started_at)}
                      </p>
                      <p className="mt-0.5 font-dm-sans text-xs text-forest-green/50">
                        {fmtTime(j.started_at)} – {fmtTime(j.ended_at)} MT
                        <span className="text-forest-green/25"> · </span>
                        {j.devices?.name ?? 'Unknown device'}
                        {j.multi_field && (
                          <>
                            <span className="text-forest-green/25"> · </span>
                            <span className="font-semibold text-warning">Multi-field</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-dm-sans text-sm font-semibold tabular-nums text-forest-green">
                        {fmtDuration(j.duration_s)}
                      </p>
                      <p className={`mt-0.5 font-dm-sans text-xs tabular-nums ${lowCoverage ? 'font-semibold text-warning' : 'text-forest-green/50'}`}>
                        {covPct}% coverage
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 font-dm-sans text-xs tabular-nums text-forest-green/50">
                    {plural(j.event_count, 'impact')} recorded
                    {j.evicted_count > 0 && (
                      <> · {j.evicted_count.toLocaleString()} lost before sync</>
                    )}
                  </p>
                </Card>
              </Link>
            )
          })}

          {!error && minorCount > 0 && (
            <div className="pt-1 text-center">
              <Link
                href={showAll ? '/jobs' : '/jobs?all=1'}
                className="inline-block rounded-lg px-4 py-2 font-dm-sans text-sm text-forest-green/60 hover:text-forest-green"
              >
                {showAll
                  ? 'Hide minor sessions'
                  : `Show all sessions (${plural(minorCount, 'minor session')} hidden)`}
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
