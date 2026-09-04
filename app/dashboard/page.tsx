import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase'
import SiteHeader from '@/app/components/SiteHeader'
import { computeLfpEligibility } from '@/lib/lfp-eligibility'
import { resolveDefaultGrazingWindow } from '@/lib/grazing-window'
import CountySelector from './components/CountySelector'
import DroughtCattleToggle from '@/app/components/DroughtCattleToggle'
import { DashboardViewProvider, DashboardViewPanels, VIEW_ORDER, type ViewParams } from './components/DashboardViews'
import {
  WeatherViewBody, HayViewBody, MarketsViewBody,
  ForecastPanelAsync, ForecastPanelSkeleton, RainfallPanelSkeleton,
  type CountyRow, type DroughtReading, type LfpFetchOutcome,
} from './components/ViewBodies'
import ShareButton from '@/app/components/ShareButton'
import { droughtSeverity } from '@/lib/drought-severity'
import WatchlistButton from './components/WatchlistButton'
// Lazy client islands (perf block, commit 4): the grazing-table picker and the
// recharts rainfall graph load in their own chunks on first mount — see the two
// loaders. Same pattern as HerdAnchorLoader / RegionalMapLoader.
import { type OfficialMapRecord } from './components/OfficialMap'
import { getPrecipNormal, type PrecipNormalResult } from '@/lib/precip-normal'
import { getLocalForecast, type LocalForecast } from '@/lib/nws'
import ConditionsStrip from './components/ConditionsStrip'
import { getOperationProfile } from '@/lib/operation-profile-service'
import { getUpcomingDeadlines, isDeadlineLoud, type UpcomingDeadlinesResult } from '@/lib/rma-deadline-service'
import DeadlineCountdownCard from './components/DeadlineCountdownCard'
import ProgramStatusRow, { deadlineQuietPreview, LFP_QUIET_PREVIEW } from './components/ProgramStatusRow'
import LfpAlertCard, { LfpAlertSkeleton, isLfpLoud } from './components/LfpAlertCard'
import { Heading } from '@/app/components/ui/Heading'
import ScrollToTop from './components/ScrollToTop'
import HomeCountyButton from './components/HomeCountyButton'
import NewsHookCard from '@/app/components/NewsHookCard'
import JobsView, { JobsViewSkeleton } from './components/JobsView'
import { LiveJobCard, TodayJobs } from './components/RanchNow'
import { createClient } from '@/lib/supabase-server'
import { getHomeCountyFips } from '@/lib/concierge-service'
import { getHerdAnchor, type HerdAnchor } from '@/lib/herd-anchor'
import HerdAnchorLoader from './components/HerdAnchorLoader'
import type { Lot } from '@/lib/herd'
import { flagEnabled } from '@/lib/flags'

export const dynamic = 'force-dynamic'

// Opening the dashboard to a logged-in user's Home (or most-recent saved) county
// when the URL has no ?fips is handled in middleware.ts — the middleware holds the
// authoritative, refreshed session, so it can redirect the document request
// reliably (a Server Component can't refresh the rotating auth cookie, so a
// redirect() here would miss the document render). Brand-new users with neither
// fall through to the EmptyState below.

// Coerce the operation-profile `crops` jsonb into a clean string[] for deadline
// filtering. Only a plain array of strings is trusted; any other shape (object array,
// null, etc.) → null, which the deadline service reads as "show all". Never throws on
// an unexpected jsonb shape.
function cropsToStringArray(crops: unknown): string[] | null {
  if (!Array.isArray(crops)) return null
  const strings = crops.filter((c): c is string => typeof c === 'string')
  return strings.length > 0 ? strings : null
}

async function LfpAlertAsync({
  dataPromise,
  countyName,
}: {
  dataPromise: Promise<LfpFetchOutcome>
  countyName: string
}) {
  const res = await dataPromise
  const eligibility = res.ok ? res.result : null
  const unavailable = !res.ok
  // Quiet (the clean no-trigger state) renders NOTHING here — the Program status row
  // below (ProgramStatusRowAsync, same promise) carries the line instead. Everything
  // else — triggered / pending / building / unavailable — stays loud in this slot.
  if (!isLfpLoud(unavailable, eligibility)) return null
  return (
    <LfpAlertCard
      eligibility={eligibility}
      unavailable={unavailable}
      countyName={countyName}
    />
  )
}

// The quiet home's assembler — awaits the SAME lfpPromise (computed once, shared with
// the alert slot and the Weather view) to learn whether LFP is quiet, then renders ONE
// collapsed Program status row for everything quiet: the LFP no-trigger line and/or
// far-out deadlines (quietDeadline is null when the deadline card is loud above).
// Everything loud ⇒ renders nothing at all — a fully loud dashboard has no quiet row.
async function ProgramStatusRowAsync({
  dataPromise,
  countyName,
  quietDeadline,
}: {
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
        <LfpAlertCard
          eligibility={eligibility}
          unavailable={unavailable}
          countyName={countyName}
          embedded
        />
      )}
      {quietDeadline && (
        <DeadlineCountdownCard result={quietDeadline} countyName={countyName} embedded />
      )}
    </ProgramStatusRow>
  )
}

// Conditions strip (B2′) — awaits the SAME always-started NWS forecast promise the
// drought view consumes (computed once, no new fetch) inside a Suspense boundary whose
// fallback is the chip-only strip (real USDM data, no placeholder), so the weather half
// streams in without ever blocking the news/page paint.
async function ConditionsStripAsync({
  reading,
  forecastPromise,
  fips,
}: {
  reading: ({ week_date: string } & DroughtReading) | null
  forecastPromise: Promise<LocalForecast | null>
  fips: string
}) {
  const forecast = await forecastPromise
  return <ConditionsStrip reading={reading} forecast={forecast} fips={fips} />
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ fips?: string }>
}): Promise<Metadata> {
  const { fips } = await searchParams
  if (!fips) return { title: 'County Dashboard' }

  const db = createServiceClient()
  const { data } = await db
    .from('counties')
    .select('name, state')
    .eq('fips', fips)
    .single()

  if (!data) return { title: 'County Dashboard' }

  const place = `${data.name}, ${data.state}`
  const title = `${place} — Drought & LFP Eligibility`
  const description = `Current drought conditions, LFP tier status, and estimated FSA payments for ${place}. Updated weekly from the U.S. Drought Monitor.`
  const ogImageUrl = `/dashboard/opengraph-image?fips=${fips}`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: `${place} drought and LFP status` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ fips?: string; gs?: string; ge?: string; pt?: string; view?: string }>
}) {
  const { fips, gs, ge, pt, view: viewParam } = await searchParams
  // My Operation defaults to the TODAY view (internal key 'news' — kept so deep
  // links, the heavy-fetch gates, and the middleware redirect stay untouched; same
  // deliberate label↔key mismatch as 'drought'/"Weather"). Jobs via &view=jobs
  // (replaced Activity 2026-08-09 — stale ?view=activity deep links parse here
  // too, its successor view), Weather via &view=drought, Markets via
  // &view=markets. With the marketplace flagged off, ?view=hay (stale deep
  // links, share cards) falls back to Today.
  const view: 'news' | 'jobs' | 'drought' | 'hay' | 'markets' =
    viewParam === 'jobs' || viewParam === 'activity' ? 'jobs'
      : viewParam === 'drought' ? 'drought'
        : viewParam === 'hay' && flagEnabled('marketplace') ? 'hay'
          : viewParam === 'markets' ? 'markets'
            : 'news'
  const db = createServiceClient()
  // ONE cookie-bound client and ONE auth.getUser() for the whole request. Every
  // consumer below (operation profile, herd anchor's RLS read, own-ground places,
  // the Jobs view gate, rain by place) takes this client/user instead of minting
  // its own and paying the auth round-trip again. Signed out → user null → each
  // of them degrades exactly as before. The session itself is refreshed by
  // middleware; this is a read.
  const supabase = await createClient()

  // ── Head reads, in parallel: national map · county · session+profile ────────
  // These are independent of one another. The profile is chained on the user
  // (it can't start before getUser resolves) but runs alongside the two
  // service-role reads. Auth is only resolved when a county is in play — a bare
  // /dashboard never needed it and still doesn't.
  const [{ data: nationalMapRow }, countyRes, session] = await Promise.all([
    db
      .from('official_maps')
      .select('id, map_type, scope, release_date, image_url, source_url')
      .eq('map_type', 'usdm_national')
      .is('scope', null)
      .order('release_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    fips
      ? db.from('counties').select('id, fips, name, state, lat, lon').eq('fips', fips).single()
      : Promise.resolve(null),
    fips
      ? (async () => {
          const { data: { user } } = await supabase.auth.getUser()
          const profileResult = await getOperationProfile({ supabase, user })
          return { user, profileResult }
        })().catch(() => ({ user: null, profileResult: { status: 'unauthenticated' as const } }))
      : Promise.resolve({ user: null, profileResult: { status: 'unauthenticated' as const } }),
  ])

  const nationalMap = nationalMapRow as OfficialMapRecord | null
  const user = session.user
  const profileResult = session.profileResult

  // ── County lookup ────────────────────────────────────────────────────────────
  const selectedCounty: CountyRow | null = countyRes ? (countyRes.data as CountyRow | null) : null

  // ── Ranch view data (only when a county is selected) ─────────────────────────
  let latest: DroughtReading | null                 = null

  // Rainfall (ACIS) is held as a PROMISE and resolved behind a <Suspense> boundary in
  // the chrome (RainfallPanelAsync below) so it NEVER blocks the page's server render —
  // the feed and Latest Reading paint immediately; the rainfall panel streams in. The
  // call still starts here (concurrent with the cheap `latest` query). A rejection
  // degrades to the honest 'data_unavailable' state — never a crash, never a false
  // deficit. getPrecipNormal owns its own 9s deadline / 24h cache / honest-failure.
  const precipPromise: Promise<PrecipNormalResult> = selectedCounty
    ? getPrecipNormal(selectedCounty.fips, selectedCounty.lat, selectedCounty.lon)
        .catch(() => 'data_unavailable' as const)
    : Promise.resolve(null)

  // 7-day NWS forecast — same streamed-behind-Suspense pattern. Started here (concurrent
  // with the cheap reads); resolved in ForecastPanelAsync. A rejection degrades to null →
  // honest "temporarily unavailable". Needs the county centroid for the gridpoint lookup.
  const forecastPromise: Promise<LocalForecast | null> =
    selectedCounty && selectedCounty.lat != null && selectedCounty.lon != null
      ? getLocalForecast(selectedCounty.lat, selectedCounty.lon).catch(() => null)
      : Promise.resolve(null)

  // Insurance deadline countdown — shown for EVERY selected county in EVERY view (it
  // serves all producers, farmers included, so it is not gated behind the view toggle).
  // Crops come from the signed-in user's operation profile when present; a missing
  // profile or a crops jsonb that isn't a clean string array → null → show all county/
  // state deadlines.
  let deadlineResult: UpcomingDeadlinesResult = { status: 'none' }
  // Operation zone (Block 2, Slice 1) — the herd-value anchor for a signed-in user with a
  // herd. Gated on the SAME profile result the deadline read uses (no new auth call).
  // userId comes from the profile row; homeFips via the existing service-role
  // home-county helper; the page's user-scoped client keeps the herd_estimate_history
  // read inside getHerdAnchor RLS-scoped to the owner. Anon / no-herd / no-home-county
  // all leave herdAnchor null → nothing renders, and any failure degrades to null so the
  // public county view below never blocks.
  let herdAnchor: HerdAnchor | null = null
  if (selectedCounty) {
    const crops = profileResult.status === 'ok' ? cropsToStringArray(profileResult.profile.crops) : null
    const herd = profileResult.status === 'ok' ? (profileResult.profile.herd as { lots?: Lot[] } | null) : null
    const lots = Array.isArray(herd?.lots) ? herd!.lots : []
    const profileUserId = profileResult.status === 'ok' ? profileResult.profile.user_id : null

    // Second parallel stage — the three reads that need the county but not each
    // other: the cheap latest reading (drives the shared Share label + heading and
    // the Latest Reading chrome card, independent of which view is open), the
    // deadlines, and the herd-anchor chain. Only the chain is serial, and only
    // because the anchor genuinely needs the profile's lots + home county first.
    const [{ data: latestRow }, deadlineRes, anchor] = await Promise.all([
      db
        .from('drought_data')
        .select('week_date, d0, d1, d2, d3, d4')
        .eq('county_id', selectedCounty.id)
        .order('week_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      getUpcomingDeadlines(selectedCounty.fips, crops),
      lots.length > 0 && profileUserId
        ? getHomeCountyFips(profileUserId)
            .then(homeFips => (homeFips ? getHerdAnchor({ lots, homeFips, supabase }) : null))
            .catch(() => null)
        : Promise.resolve(null),
    ])
    latest = latestRow as DroughtReading | null
    deadlineResult = deadlineRes
    herdAnchor = anchor
  }

  // LFP eligibility — HOISTED to the always-run path (was Drought-only) so the LFP alert
  // can show in EVERY view. Held as a PROMISE, not awaited here: it streams behind a
  // <Suspense> boundary (LfpAlertAsync) so the slow USDM consecutive-weeks fetch never
  // blocks the news/page paint. Resolves to a tagged outcome so an outage/timeout
  // degrades honestly. The Drought view's Promise.all below consumes this SAME promise,
  // so eligibility is computed ONCE and shared by the alert and the hero.
  const lfpPromise: Promise<LfpFetchOutcome> = selectedCounty
    ? computeLfpEligibility(selectedCounty.fips, (() => {
        if (gs && ge) return { grazingPeriod: { startDate: gs, endDate: ge } }
        return { grazingPeriod: resolveDefaultGrazingWindow(selectedCounty.fips, pt) }
      })())
        .then(result => ({ ok: true as const, result }))
        .catch(() => ({ ok: false as const }))
    : Promise.resolve({ ok: false as const })





  // What the deferred bodies depend on from the URL — passed to the client
  // panels (and back to the server action on first activation), and keyed on so
  // a param change never shows a body built for the old params.
  const viewParams: ViewParams = { fips: selectedCounty?.fips ?? '', gs, ge, pt }
  const viewParamsKey = `${viewParams.fips}|${gs ?? ''}|${ge ?? ''}|${pt ?? ''}`

  // Public, neighborly drought descriptor for the Share affordance (no money/PII).
  const shareDrought = droughtSeverity(latest)

  return (
    <div className="min-h-screen bg-cream">

      <SiteHeader
        center={selectedCounty ? `${selectedCounty.name}, ${selectedCounty.state}` : undefined}
      />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <ScrollToTop />

        {/* ── County selector ───────────────────────────────────────────────── */}
        <section className="mb-8">
          <label className="mb-2 block text-sm font-medium text-forest-green font-dm-sans">
            Select County
          </label>
          <CountySelector selectedCounty={selectedCounty} />
        </section>

        {/* ── National view (no county selected) ───────────────────────────── */}
        {!fips && <EmptyState />}

        {fips && !selectedCounty && (
          <p className="text-sm text-forest-green/60 font-dm-sans">
            County not found for FIPS {fips}.
          </p>
        )}

        {/* ── Ranch view (county selected) ───────────────────────── */}
        {selectedCounty && (
          <div className="max-w-2xl mx-auto px-4 pb-16 space-y-4">
            <DashboardViewProvider initial={view}>

            {/* ── B1: compact orientation bar — WHICH county, before any money or market
                   read. One slim row shared across all views: county + FIPS left, the same
                   Share / Home / Watchlist controls (identical props and handlers) right.
                   Relocated from below the herd block; CountySelector above is untouched. ── */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {/* Semantic h1 (the page's only heading — public county pages are the SEO
                  surface) at the compact text-lg size; !important beats the level-1 scale. */}
              <Heading level={1} className="!text-lg !leading-snug">
                {selectedCounty.name}, {selectedCounty.state}
                <span className="ml-2 align-middle font-dm-sans text-xs font-normal text-forest-green/50">
                  FIPS {selectedCounty.fips}
                </span>
              </Heading>
              <div className="flex items-center gap-2">
                <ShareButton
                  fips={selectedCounty.fips}
                  countyLabel={`${selectedCounty.name}, ${selectedCounty.state}`}
                  droughtLabel={shareDrought.level != null ? shareDrought.label : null}
                  surface="dashboard"
                />
                <HomeCountyButton
                  countyFips={selectedCounty.fips}
                  countyName={selectedCounty.name}
                />
                <WatchlistButton
                  countyId={selectedCounty.id}
                  countyName={selectedCounty.name}
                />
              </div>
            </div>

            {/* ── B2′: conditions strip — weather leads on every open, in every tab.
                   Drought chip (always-awaited `latest`) renders immediately; today's
                   forecast streams in from the always-started NWS promise (no new
                   fetch, News stays fast, default tab unchanged). Tapping opens the
                   Weather tab via the toggle's exact link pattern. Renders nothing
                   when there's no real data. ── */}
            <Suspense
              fallback={<ConditionsStrip reading={latest} forecast={null} fips={selectedCounty.fips} />}
            >
              <ConditionsStripAsync
                reading={latest}
                forecastPromise={forecastPromise}
                fips={selectedCounty.fips}
              />
            </Suspense>

            {/* A machine working RIGHT NOW — loud, in every view, carrying the
                headline number for the job type (bale count / percent cut + ETA).
                Null when nothing runs and for signed-out visitors (RLS returns
                nothing): the always-on stack stays "the ranch right now or money
                that demands action". */}
            <Suspense fallback={null}>
              <LiveJobCard />
            </Suspense>

            {/* Herd-value anchor (Slice 1). Market Read used to sit above it in
                this always-on stack; it moved to the top of the Markets view
                (2026-08-09) under the rule that finally named the layout: the
                always-on stack is either THE RANCH RIGHT NOW or MONEY THAT
                DEMANDS ACTION — weekly-to-quarterly national context is
                neither. The anchor stays: it's the operation's own number. */}
            {herdAnchor && (
              <HerdAnchorLoader
                estimate={herdAnchor.estimate}
                trend={herdAnchor.trend}
                outlook={herdAnchor.outlook}
              />
            )}

            {/* LFP status alert — LOUD ONLY (Block 2): triggered / pending-OBBBA /
                building a D2 streak / data unavailable (an outage must speak — see
                isLfpLoud). The clean no-trigger state renders nothing here and joins
                the Program status row below instead. Streamed behind Suspense so the
                slow USDM eligibility fetch never blocks the page/news paint; renders
                in every view, persistent across the toggle, above the deadline card
                (higher priority). */}
            <Suspense fallback={<LfpAlertSkeleton />}>
              <LfpAlertAsync dataPromise={lfpPromise} countyName={selectedCounty.name} />
            </Suspense>

            {/* USDA program deadlines — full card ONLY when loud (soonest ≤45 days,
                newly published row, or data_unavailable); quiet (none / far out) folds
                into the Program status row below. Never gated behind a view; filters
                to the user's crops when set, else shows all. */}
            {isDeadlineLoud(deadlineResult) && (
              <DeadlineCountdownCard result={deadlineResult} countyName={selectedCounty.name} />
            )}

            {/* Program status — the quiet home (Block 2). ONE collapsed row for
                whatever is quiet (LFP no-trigger line and/or far-out deadlines), full
                cards one tap away. Its own Suspense slot BELOW the loud cards, fed by
                the SAME lfpPromise, because LFP quietness is only known after the USDM
                fetch resolves; quiet content is by definition non-urgent, so the late
                paint costs nothing (null fallback — a quiet row has no skeleton).
                Renders nothing when everything above is loud. */}
            <Suspense fallback={null}>
              <ProgramStatusRowAsync
                dataPromise={lfpPromise}
                countyName={selectedCounty.name}
                quietDeadline={isDeadlineLoud(deadlineResult) ? null : deadlineResult}
              />
            </Suspense>

            {/* Peer-view toggle — Today ↔ Jobs ↔ Weather ↔ Markets (same county).
                A tap is client state (DashboardViewProvider above), not a
                navigation: no request, no re-render of anything above this line. */}
            <DroughtCattleToggle />

            {/* The view bodies. Mount policy (perf block, commit 5): Today is
                always in the first-load HTML (it's the default and cheap: today's
                sessions, the forecast the strip already started, the news hook);
                the URL's active view, if not Today, renders eagerly too so a cold
                ?view=drought lands on Weather with the body present. Every OTHER
                body neither renders nor fetches until first activated — the
                client asks a server action for it once, then keeps it mounted
                (hidden, not unmounted), so switching back is instant and free.

                Today (key 'news' — see the parse note above) — the daily-use floor:
                7-day forecast carousel + the 3-headline news hook. The carousel reuses
                the SAME already-started forecastPromise the ConditionsStrip streams
                from (zero new fetches). The hook is the ENTIRE news surface now — the
                old full MarketsNews feed is parked.

                Jobs — derived work sessions (the view that replaced Activity).
                Signed-out gets the honest private-ledger gate — the dashboard stays
                public, the ledger doesn't. Weather / Markets — see ViewBodies.tsx.

                key= the URL params the bodies depend on: a new fips / grazing window
                remounts the panels, so a deferred body is never shown for stale
                params (the eager ones arrive fresh as props anyway). */}
            <DashboardViewPanels
              key={viewParamsKey}
              params={viewParams}
              order={VIEW_ORDER}
              eager={{
                news: (
                  <>
                    {/* Today's completed sessions — quiet, gone at midnight ranch
                        time (at breakfast the slate is clean; history lives in the
                        Jobs view). The live card above already carries in-progress. */}
                    <Suspense fallback={null}>
                      <TodayJobs />
                    </Suspense>
                    <div>
                      <p className="text-xs font-dm-sans font-medium text-forest-green/40 uppercase tracking-wide mb-3">7-day forecast</p>
                      <Suspense fallback={<ForecastPanelSkeleton />}>
                        <ForecastPanelAsync dataPromise={forecastPromise} />
                      </Suspense>
                    </div>
                    <NewsHookCard fips={selectedCounty.fips} />
                  </>
                ),
                ...(view === 'jobs'
                  ? { jobs: (
                      <Suspense fallback={<JobsViewSkeleton />}>
                        <JobsView user={user} />
                      </Suspense>
                    ) }
                  : {}),
                ...(view === 'drought'
                  ? { drought: (
                      <Suspense fallback={<RainfallPanelSkeleton />}>
                        <WeatherViewBody
                          selectedCounty={selectedCounty}
                          latest={latest}
                          nationalMap={nationalMap}
                          pt={pt}
                          user={user}
                          lfpPromise={lfpPromise}
                          precipPromise={precipPromise}
                          forecastPromise={forecastPromise}
                        />
                      </Suspense>
                    ) }
                  : {}),
                ...(view === 'hay'
                  ? { hay: (
                      <Suspense fallback={null}>
                        <HayViewBody selectedCounty={selectedCounty} />
                      </Suspense>
                    ) }
                  : {}),
                ...(view === 'markets'
                  ? { markets: (
                      <Suspense fallback={<JobsViewSkeleton />}>
                        <MarketsViewBody selectedCounty={selectedCounty} hasHerd={!!herdAnchor} />
                      </Suspense>
                    ) }
                  : {}),
              }}
              fallbacks={{
                jobs: <JobsViewSkeleton />,
                drought: <RainfallPanelSkeleton />,
                markets: <JobsViewSkeleton />,
              }}
            />

            </DashboardViewProvider>

          </div>
        )}
      </main>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-forest-green/8 mx-auto">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-forest-green/60">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
      </div>
      <Heading level={3}>
        Select a county to begin
      </Heading>
      <p className="mt-2 max-w-xs text-sm text-forest-green/60 font-dm-sans">
        Search above to view drought conditions and weekly history for any US county.
      </p>
    </div>
  )
}
