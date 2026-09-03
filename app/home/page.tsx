import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import SiteHeader from '@/app/components/SiteHeader'
import { Card } from '@/app/components/ui/Card'
import { Heading } from '@/app/components/ui/Heading'
import { LiveJobCard, TodayJobs } from '@/app/dashboard/components/RanchNow'
import SeasonTotals from './SeasonTotals'
import LogIt from './LogIt'
import RecentlyLogged from './RecentlyLogged'
import HerdValueCard from './HerdValueCard'
import ConditionsStrip from '@/app/dashboard/components/ConditionsStrip'
import LfpAlertCard, { LfpAlertSkeleton, isLfpLoud } from '@/app/dashboard/components/LfpAlertCard'
import DeadlineCountdownCard from '@/app/dashboard/components/DeadlineCountdownCard'
import ProgramStatusRow, { deadlineQuietPreview, LFP_QUIET_PREVIEW } from '@/app/dashboard/components/ProgramStatusRow'
import { computeLfpEligibility, type LfpEligibilityResult } from '@/lib/lfp-eligibility'
import { resolveDefaultGrazingWindow } from '@/lib/grazing-window'
import { getUpcomingDeadlines, isDeadlineLoud, type UpcomingDeadlinesResult } from '@/lib/rma-deadline-service'
import { getOperationProfile } from '@/lib/operation-profile-service'
import { getHomeCountyFips } from '@/lib/concierge-service'
import { getHerdAnchor, type HerdAnchor } from '@/lib/herd-anchor'
import { getLocalForecast, type LocalForecast } from '@/lib/nws'
import type { Lot } from '@/lib/herd'

// ─── /home — the signed-in ranch home (the 2026-08-09 repositioning) ───────────
// The app leads with the data only this operation has, and public feeds become
// context below it. Hierarchy, top to bottom:
//   what's happening NOW (live job) → today's sessions → season totals →
//   herd value → weather + money that demands action → markets, one tap away.
//
// The county-tool identity stays on /dashboard — selector, share, watchlist,
// FIPS codes, news hook all live THERE, on the public lead-gen surface, not
// here. This page never asks where the ranch is: the county resolves silently
// from the operation's home county, and a missing one degrades to a single
// quiet setup link, not a selector.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Home' }

interface DroughtReading {
  week_date: string
  d0: number | null
  d1: number | null
  d2: number | null
  d3: number | null
  d4: number | null
}

type LfpFetchOutcome = { ok: true; result: LfpEligibilityResult | null } | { ok: false }

// Same streamed-behind-Suspense assemblers as the dashboard (page-local there
// too): the slow USDM eligibility fetch never blocks the ranch sections above.
async function LfpAlertAsync({ dataPromise, countyName }: {
  dataPromise: Promise<LfpFetchOutcome>
  countyName: string
}) {
  const res = await dataPromise
  const eligibility = res.ok ? res.result : null
  const unavailable = !res.ok
  if (!isLfpLoud(unavailable, eligibility)) return null
  return <LfpAlertCard eligibility={eligibility} unavailable={unavailable} countyName={countyName} />
}

async function ProgramStatusRowAsync({ dataPromise, countyName, quietDeadline }: {
  dataPromise: Promise<LfpFetchOutcome>
  countyName: string
  quietDeadline: UpcomingDeadlinesResult | null
}) {
  const res = await dataPromise
  const eligibility = res.ok ? res.result : null
  const unavailable = !res.ok
  const lfpQuiet = !isLfpLoud(unavailable, eligibility)

  const segments: string[] = []
  if (lfpQuiet) segments.push(LFP_QUIET_PREVIEW)
  if (quietDeadline) segments.push(deadlineQuietPreview(quietDeadline))
  if (segments.length === 0) return null

  return (
    <ProgramStatusRow preview={segments.join(' — ')}>
      {lfpQuiet && (
        <LfpAlertCard eligibility={eligibility} unavailable={unavailable} countyName={countyName} embedded />
      )}
      {quietDeadline && <DeadlineCountdownCard result={quietDeadline} countyName={countyName} embedded />}
    </ProgramStatusRow>
  )
}

async function ConditionsStripAsync({ reading, forecastPromise, fips }: {
  reading: ({ week_date: string } & DroughtReading) | null
  forecastPromise: Promise<LocalForecast | null>
  fips: string
}) {
  const forecast = await forecastPromise
  return <ConditionsStrip reading={reading} forecast={forecast} fips={fips} />
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin?next=/home')

  // County context resolves silently — never a selector on this page.
  const homeFips = await getHomeCountyFips(user.id).catch(() => null)

  const db = createServiceClient()
  interface CountyRow {
    id: number
    fips: string
    name: string
    state: string
    lat: number | null
    lon: number | null
  }
  let county: CountyRow | null = null
  if (homeFips) {
    const { data } = await db
      .from('counties')
      .select('id, fips, name, state, lat, lon')
      .eq('fips', homeFips)
      .maybeSingle()
    county = (data as CountyRow | null) ?? null
  }

  // Latest drought reading for the conditions strip (cheap, service-role).
  let latest: DroughtReading | null = null
  if (county) {
    const { data } = await db
      .from('drought_data')
      .select('week_date, d0, d1, d2, d3, d4')
      .eq('county_id', county.id)
      .order('week_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    latest = data as DroughtReading | null
  }

  const forecastPromise: Promise<LocalForecast | null> =
    county && county.lat != null && county.lon != null
      ? getLocalForecast(county.lat, county.lon).catch(() => null)
      : Promise.resolve(null)

  const lfpPromise: Promise<LfpFetchOutcome> = county
    ? computeLfpEligibility(county.fips, { grazingPeriod: resolveDefaultGrazingWindow(county.fips) })
        .then(result => ({ ok: true as const, result }))
        .catch(() => ({ ok: false as const }))
    : Promise.resolve({ ok: false as const })

  // Profile → deadlines (crop-filtered) + the herd anchor. Same derivation the
  // dashboard used; failures degrade to absent cards, never a blocked page.
  const profileResult = await getOperationProfile()
  const crops = profileResult.status === 'ok' && Array.isArray(profileResult.profile.crops)
    ? (profileResult.profile.crops as unknown[]).filter((c): c is string => typeof c === 'string')
    : null
  const deadlineResult: UpcomingDeadlinesResult = county
    ? await getUpcomingDeadlines(county.fips, crops && crops.length > 0 ? crops : null)
    : { status: 'none' }

  let herdAnchor: HerdAnchor | null = null
  if (profileResult.status === 'ok' && homeFips) {
    const herd = profileResult.profile.herd as { lots?: Lot[] } | null
    const lots = Array.isArray(herd?.lots) ? herd!.lots : []
    if (lots.length > 0) {
      try {
        herdAnchor = await getHerdAnchor({ lots, homeFips, supabase })
      } catch {
        herdAnchor = null
      }
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader center={county ? `${county.name}, ${county.state}` : undefined} />
      <main className="mx-auto max-w-2xl px-4 py-6 pb-24 sm:px-6 md:pb-10">
        <div className="space-y-4">

          {/* ── Log it — the operator's own line in the ledger ── */}
          <LogIt />

          {/* ── What's happening now ── */}
          <Suspense fallback={null}>
            <LiveJobCard />
          </Suspense>

          {/* ── Today's sessions ── */}
          <Suspense fallback={null}>
            <TodayJobs />
          </Suspense>

          {/* ── Season totals ── */}
          <Suspense fallback={null}>
            <SeasonTotals />
          </Suspense>

          {/* ── Recently logged — the operator's own lines; absent when none ── */}
          <Suspense fallback={null}>
            <RecentlyLogged />
          </Suspense>

          {/* ── Herd value — a card, not the hero ── */}
          {herdAnchor && <HerdValueCard anchor={herdAnchor} />}

          {/* ── Weather + money that demands action ── */}
          {county ? (
            <>
              <Suspense
                fallback={<ConditionsStrip reading={latest} forecast={null} fips={county.fips} />}
              >
                <ConditionsStripAsync
                  reading={latest}
                  forecastPromise={forecastPromise}
                  fips={county.fips}
                />
              </Suspense>

              <Suspense fallback={<LfpAlertSkeleton />}>
                <LfpAlertAsync dataPromise={lfpPromise} countyName={county.name} />
              </Suspense>

              {isDeadlineLoud(deadlineResult) && (
                <DeadlineCountdownCard result={deadlineResult} countyName={county.name} />
              )}

              <Suspense fallback={null}>
                <ProgramStatusRowAsync
                  dataPromise={lfpPromise}
                  countyName={county.name}
                  quietDeadline={isDeadlineLoud(deadlineResult) ? null : deadlineResult}
                />
              </Suspense>
            </>
          ) : (
            <Card shadow="none" className="px-5 py-4">
              <p className="font-dm-sans text-sm text-forest-green/60">
                Set a home county to see weather, drought, and program status here.
              </p>
              <Link
                href="/dashboard"
                className="mt-2 inline-block font-dm-sans text-sm font-semibold text-forest-green/70 hover:text-forest-green"
              >
                Find your county →
              </Link>
            </Card>
          )}

          {/* ── Markets — context, one tap away, never on the page ── */}
          {county && (
            <div className="flex gap-3">
              <Link
                href={`/dashboard?fips=${county.fips}&view=markets`}
                className="flex-1 rounded-lg border border-forest-green/15 bg-white px-4 py-3 text-center font-dm-sans text-sm font-medium text-forest-green transition-colors hover:bg-forest-green/5"
              >
                Markets →
              </Link>
              <Link
                href={`/dashboard?fips=${county.fips}&view=drought`}
                className="flex-1 rounded-lg border border-forest-green/15 bg-white px-4 py-3 text-center font-dm-sans text-sm font-medium text-forest-green transition-colors hover:bg-forest-green/5"
              >
                County detail →
              </Link>
            </div>
          )}

          {/* A truly empty ranch (no jobs, no herd) still says what this page is. */}
          {!herdAnchor && (
            <EmptyRanchHint />
          )}
        </div>
      </main>
    </div>
  )
}

// Quiet, only meaningful for a brand-new operation: the ranch sections above
// render nothing until a machine works or a herd exists, and an empty page
// should say why instead of showing three headers over nothing.
async function EmptyRanchHint() {
  const supabase = await createClient()
  const { count } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
  if ((count ?? 0) > 0) return null
  return (
    <Card shadow="none" className="px-5 py-6 text-center">
      <Heading level={4}>Your ranch, written down</Heading>
      <p className="mx-auto mt-2 max-w-sm font-dm-sans text-sm text-forest-green/60">
        Work sessions land here when a Scout rides a machine. Your herd&rsquo;s value
        lands here when you add lots.
      </p>
      <div className="mt-3 flex justify-center gap-4 font-dm-sans text-sm font-semibold text-forest-green/70">
        <Link href="/devices" className="hover:text-forest-green">Devices →</Link>
        <Link href="/herd" className="hover:text-forest-green">My herd →</Link>
      </div>
    </Card>
  )
}
