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
// loaders. Same pattern as RegionalMapLoader.
import { type OfficialMapRecord } from './components/OfficialMap'
import { getPrecipNormal, type PrecipNormalResult } from '@/lib/precip-normal'
import { getLocalForecast, type LocalForecast } from '@/lib/nws'
import ConditionsStrip from './components/ConditionsStrip'
import { getOperationProfile } from '@/lib/operation-profile-service'
import { getUpcomingDeadlines, isDeadlineLoud, type UpcomingDeadlinesResult } from '@/lib/rma-deadline-service'
import DeadlineCountdownCard from './components/DeadlineCountdownCard'
import ProgramStatusRow, { deadlineQuietPreview } from './components/ProgramStatusRow'
import LfpAlertCard, { LfpAlertSkeleton } from './components/LfpAlertCard'
import LfpCard from './components/LfpCard'
import LfpHero from './components/LfpHero'
import ProgramStatus from './components/ProgramStatusLoader'
import type { LfpEligibilityResult } from '@/lib/lfp-eligibility'
import { Heading } from '@/app/components/ui/Heading'
import ScrollToTop from './components/ScrollToTop'
import NewsHookCard from '@/app/components/NewsHookCard'
import JobsView, { JobsViewSkeleton } from './components/JobsView'
import { LiveJobCard, TodayJobs } from './components/RanchNow'
// The operation's own cards — moved here from /home (shell pass, commit 3).
import LogIt from './components/LogIt'
import SeasonTotals from './components/SeasonTotals'
import HayInventoryCard from './components/HayInventoryCard'
import RecentlyLogged from './components/RecentlyLogged'
import { createClient } from '@/lib/supabase-server'
import { getHomeCountyFips } from '@/lib/concierge-service'
import { getRanch } from '@/lib/ranch-membership'
import type { Lot } from '@/lib/herd'
import { flagEnabled } from '@/lib/flags'
import { EYEBROW } from '@/app/components/ui/Eyebrow'

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
// The operation's county for the orientation line (layout, commit 2): name +
// state + fips, nothing more — read once, shared with the herd-anchor chain.
interface HomeCounty { fips: string; name: string; state: string }

function cropsToStringArray(crops: unknown): string[] | null {
  if (!Array.isArray(crops)) return null
  const strings = crops.filter((c): c is string => typeof c === 'string')
  return strings.length > 0 ? strings : null
}

// ─── LFP: ONE card per screen (shell pass, commit 6) ────────────────────────────
// Awaits the shared lfpPromise (computed once) and renders the single LFP card in
// the always-on stack: the summary is the LfpAlertCard body — triggered /
// pending / building / no-trigger / unavailable, real engine values, no dollar —
// visible without a tap in EVERY state (the quiet no-trigger line no longer
// hides in the Program status row); the detail (LfpHero: path to payment,
// payout schedule, estimate, FSA guidance; ProgramStatus: calculator, tier
// ladder, prior year, CCC-853) expands on one tap. The prior-year comparison
// rides its own promise (5 cached USDM calls, keyed by release date) that
// nothing awaits until this card streams. Unavailable → summary only.
async function LfpCardAsync({
  dataPromise,
  priorYearPromise,
  countyName,
  fips,
}: {
  dataPromise: Promise<LfpFetchOutcome>
  priorYearPromise: Promise<LfpEligibilityResult | null>
  countyName: string
  fips: string
}) {
  const res = await dataPromise
  const eligibility = res.ok ? res.result : null
  const unavailable = !res.ok
  const official = !!eligibility && eligibility.enforcement === 'officially_eligible'
  const priorYear = eligibility ? await priorYearPromise : null
  return (
    <LfpCard
      highlight={official}
      summary={<LfpAlertCard eligibility={eligibility} unavailable={unavailable} countyName={countyName} embedded />}
      detail={eligibility ? (
        <>
          <LfpHero eligibility={eligibility} countyName={countyName} />
          <div id="eligibility-math" className="scroll-mt-24">
            <ProgramStatus
              eligibility={eligibility}
              priorYearEligibility={priorYear}
              fips={fips}
              countyName={countyName}
            />
          </div>
        </>
      ) : null}
    />
  )
}

// The quiet Program status row now carries ONLY far-out deadlines (the LFP line
// lives in the card above, in every state). Nothing quiet ⇒ nothing rendered.
function DeadlineQuietRow({ quietDeadline, countyName }: {
  quietDeadline: UpcomingDeadlinesResult | null
  countyName: string
}) {
  if (!quietDeadline) return null
  return (
    <ProgramStatusRow preview={deadlineQuietPreview(quietDeadline)}>
      <DeadlineCountdownCard result={quietDeadline} countyName={countyName} embedded />
    </ProgramStatusRow>
  )
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
          // Profile and ranch (the outfit's name, flow commit 2) side by side —
          // both need only the user; neither waits on the other.
          const [profileResult, ranch] = await Promise.all([
            getOperationProfile({ supabase, user }),
            user ? getRanch(supabase, user.id).catch(() => null) : Promise.resolve(null),
          ])
          return { user, profileResult, ranch }
        })().catch(() => ({ user: null, profileResult: { status: 'unauthenticated' as const }, ranch: null }))
      : Promise.resolve({ user: null, profileResult: { status: 'unauthenticated' as const }, ranch: null }),
  ])

  const nationalMap = nationalMapRow as OfficialMapRecord | null
  const user = session.user
  // The operation's name leads the page when the signed-in person's ranch has
  // one; a blank name is no name (the county stays the subject, exactly as for
  // a signed-out visitor). Never a placeholder.
  const ranchName = session.ranch?.name || null
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
  // The herd-value anchor is no longer computed here (views2, commit 2): the
  // Markets body owns it, on both of its render paths, and nothing on Today
  // reads it. The head keeps only what Today shows.
  // The signed-in person's home county — the operation's county — for the
  // orientation line under the ranch name. Null signed out or when none is set.
  let homeCounty: HomeCounty | null = null
  // The profile's lots — an input the eager Markets body needs for its herd
  // anchor (views2, commit 2: the anchor chain itself left this head; nothing
  // on Today reads it any more).
  let lots: Lot[] = []
  if (selectedCounty) {
    const crops = profileResult.status === 'ok' ? cropsToStringArray(profileResult.profile.crops) : null
    const herd = profileResult.status === 'ok' ? (profileResult.profile.herd as { lots?: Lot[] } | null) : null
    lots = Array.isArray(herd?.lots) ? herd!.lots : []

    // Second parallel stage — the three reads that need the county but not each
    // other: the cheap latest reading (drives the shared Share label + heading and
    // the Latest Reading chrome card, independent of which view is open), the
    // deadlines, and the herd-anchor chain. Only the chain is serial, and only
    // because the anchor genuinely needs the profile's lots + home county first.
    // The home county is read ONCE per request (layout, commit 2): the herd
    // anchor chain and the orientation line share it. Signed out → null, no read.
    const homeFipsPromise: Promise<string | null> = user
      ? getHomeCountyFips(user.id).catch(() => null)
      : Promise.resolve(null)
    const [{ data: latestRow }, deadlineRes, home] = await Promise.all([
      db
        .from('drought_data')
        .select('week_date, d0, d1, d2, d3, d4')
        .eq('county_id', selectedCounty.id)
        .order('week_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      getUpcomingDeadlines(selectedCounty.fips, crops),
      // The operation's county for the orientation line. When it's the county in
      // view the row is already here; only a DIFFERENT home county costs a read
      // (one indexed fips lookup, chained on the fips, concurrent with the rest).
      homeFipsPromise.then(async (hf): Promise<HomeCounty | null> => {
        if (!hf) return null
        if (hf === selectedCounty.fips) return { fips: selectedCounty.fips, name: selectedCounty.name, state: selectedCounty.state }
        const { data } = await db.from('counties').select('fips, name, state').eq('fips', hf).maybeSingle()
        return (data as HomeCounty | null) ?? null
      }).catch(() => null),
    ])
    latest = latestRow as DroughtReading | null
    deadlineResult = deadlineRes
    homeCounty = home
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

  // Prior-year LFP (same forage period, year − 1) for the card's eligibility-math
  // comparison. Started here, awaited only inside LfpCardAsync once the current
  // year resolves — five USDM calls behind unstable_cache (keyed by release date),
  // a cache hit after the first load. Used to run inside the Weather body only.
  const priorYearPromise: Promise<LfpEligibilityResult | null> = selectedCounty
    ? computeLfpEligibility(
        selectedCounty.fips,
        { grazingPeriod: resolveDefaultGrazingWindow(selectedCounty.fips, pt, new Date().getFullYear() - 1) },
      ).catch(() => null)
    : Promise.resolve(null)





  // What the deferred bodies depend on from the URL — passed to the client
  // panels (and back to the server action on first activation), and keyed on so
  // a param change never shows a body built for the old params.
  const viewParams: ViewParams = { fips: selectedCounty?.fips ?? '', gs, ge, pt }
  const viewParamsKey = `${viewParams.fips}|${gs ?? ''}|${ge ?? ''}|${pt ?? ''}`

  // Public, neighborly drought descriptor for the Share affordance (no money/PII).
  const shareDrought = droughtSeverity(latest)

  return (
    <div className="min-h-screen bg-cream">

      {/* No county in the header centre (flow, commit 2): it was a third copy
          of the fact the orientation bar and the selector already carry. */}
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <ScrollToTop />

        {/* ── County selector (flow, commit 4) ──────────────────────────────────
               The public county page's whole job is picking a county, so signed
               out it stays here, the page's main control. Signed in with a county
               it leaves this slot — the operation is the subject — and lives in
               the Weather view as "change the county you're looking at". The one
               dependency: a signed-in person with NO county (bare /dashboard,
               no home county) still needs a way to one, so it stays here for
               them too, above the EmptyState that points at it. */}
        {(!user || !selectedCounty) && (
          <section className="mb-8">
            <label className="mb-2 block text-sm font-medium text-forest-green font-dm-sans">
              Select County
            </label>
            <CountySelector selectedCounty={selectedCounty} />
          </section>
        )}

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
              {ranchName ? (
                // A named outfit is the subject (flow, commit 2); the secondary
                // line is the OPERATION's county — the home county, the one the
                // landing and the bottom anchor resolve to — not whichever county
                // is in view (layout, commit 2; the old line read "Home base ·"
                // and showed the county in view, which was wrong whenever they
                // differed). A different county in view is named after it; no
                // home county yet says so. Same h1 slot and size.
                <div className="min-w-0">
                  <Heading level={1} className="!text-lg !leading-snug">{ranchName}</Heading>
                  <p className="font-dm-sans text-xs text-forest-green/50" data-testid="operation-line">
                    {homeCounty
                      ? `Operation · ${homeCounty.name}, ${homeCounty.state} · FIPS ${homeCounty.fips}`
                      : 'Operation · No home county set'}
                    {(!homeCounty || homeCounty.fips !== selectedCounty.fips) && (
                      <> · Viewing {selectedCounty.name}, {selectedCounty.state}</>
                    )}
                  </p>
                </div>
              ) : (
                <Heading level={1} className="!text-lg !leading-snug">
                  {selectedCounty.name}, {selectedCounty.state}
                  <span className="ml-2 align-middle font-dm-sans text-xs font-normal text-forest-green/50">
                    FIPS {selectedCounty.fips}
                  </span>
                </Heading>
              )}
              <div className="flex items-center gap-2">
                <ShareButton
                  fips={selectedCounty.fips}
                  countyLabel={`${selectedCounty.name}, ${selectedCounty.state}`}
                  droughtLabel={shareDrought.level != null ? shareDrought.label : null}
                  surface="dashboard"
                />
                {/* Set Home and Watch left this bar for the Weather view, beside
                    the county selector, where changing counties already lives
                    (layout, commit 2): signed in, the bar is the operation + Share.
                    Signed out is unchanged — the Watch slot is the sign-in prompt
                    it always was. */}
                {!user && (
                  <WatchlistButton
                    countyId={selectedCounty.id}
                    countyName={selectedCounty.name}
                  />
                )}
              </div>
            </div>

            {/* Peer-view tabs — Today · Markets · Weather · Jobs — directly under the
                orientation bar (flow, commit 3): everything county- and herd-scoped
                now sits BELOW them, inside a view. A tap is client state
                (DashboardViewProvider above), not a navigation. */}
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
                    {/* ── B2′: conditions strip — weather leads the Today view (flow, commit 3: the stack moved under the tabs).
                           Drought chip (always-awaited `latest`) renders immediately; today's
                           forecast streams in from the always-started NWS promise (no new
                           fetch, News stays fast, default tab unchanged). Tapping opens the
                           Weather tab via the toggle's exact link pattern. Renders nothing
                           when there's no real data. ── */}
                    {/* Today's order (layout, commit 3), top to bottom: conditions
                        strip · LFP card · deadlines · Log it · live job · today's
                        jobs · herd value · 7-day forecast · headlines · This season ·
                        Hay · Recently logged. Money and the operator's own line
                        first; the machines; the herd; the sky; the news; then the
                        season ledgers at the bottom. Same components, same gates. */}
                    <ConditionsStrip reading={latest} fips={selectedCounty.fips} />

                    {/* Herd value lives on Markets (views2, commit 2) — one surface,
                        between the Market Read and the cash it's priced at; the full
                        Now/Trend/Outlook panel is on /herd. Nothing herd-scoped here. */}

                    {/* LFP status alert — LOUD ONLY (Block 2): triggered / pending-OBBBA /
                        building a D2 streak / data unavailable (an outage must speak — see
                        isLfpLoud). The clean no-trigger state renders nothing here and joins
                        the Program status row below instead. Streamed behind Suspense so the
                        slow USDM eligibility fetch never blocks the page paint; Today only
                        since flow commit 3, above the deadline card (higher priority). */}
                    <Suspense fallback={<LfpAlertSkeleton />}>
                      <LfpCardAsync
                        dataPromise={lfpPromise}
                        priorYearPromise={priorYearPromise}
                        countyName={selectedCounty.name}
                        fips={selectedCounty.fips}
                      />
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
                    <DeadlineQuietRow
                      countyName={selectedCounty.name}
                      quietDeadline={isDeadlineLoud(deadlineResult) ? null : deadlineResult}
                    />

                    {/* ── The operation (shell pass, commit 3: Today absorbed /home) ──
                        What the machines say, then the sky and the news, then the
                        operator's own line in the ledger (Log it, views2 commit 3) and
                        the ledgers it feeds. Every card is the same self-gating server
                        component it was on /home (RLS-scoped reads that return nothing
                        signed out → null). */}
                    {/* A machine working RIGHT NOW, carrying the headline number for
                        the job type (bale count / percent cut + ETA). Null when nothing
                        runs and for signed-out visitors (RLS returns nothing). */}
                    <Suspense fallback={null}>
                      <LiveJobCard />
                    </Suspense>

                    {/* Today's completed sessions — quiet, gone at midnight ranch
                        time (at breakfast the slate is clean; history lives in the
                        Jobs view). The live card above already carries in-progress. */}
                    <Suspense fallback={null}>
                      <TodayJobs />
                    </Suspense>

                    {/* 7-day forecast — Today ONLY since layout commit 3 (its Weather
                        copy was cut: one carousel, one place). Streamed behind Suspense. */}
                    <div>
                      <p className={`${EYEBROW} mb-3`}>7-day forecast</p>
                      <Suspense fallback={<ForecastPanelSkeleton />}>
                        <ForecastPanelAsync dataPromise={forecastPromise} />
                      </Suspense>
                    </div>
                    <NewsHookCard fips={selectedCounty.fips} />

                    {/* Log it — the primary action, directly above the ledgers its
                        saves feed (views2, commit 3). LogIt is the one client piece
                        and never gated itself, so it takes the page's user: a public
                        county page must not offer a Log it button that can only 401. */}
                    {user && <LogIt />}

                    {/* The season ledgers, at the bottom (layout, commit 3). Each is
                        the same self-gating server component it was on /home. */}
                    <Suspense fallback={null}>
                      <SeasonTotals />
                    </Suspense>

                    <Suspense fallback={null}>
                      <HayInventoryCard />
                    </Suspense>

                    <Suspense fallback={null}>
                      <RecentlyLogged />
                    </Suspense>
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
                          user={user}
                          lfpPromise={lfpPromise}
                          precipPromise={precipPromise}
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
                        <MarketsViewBody selectedCounty={selectedCounty} lots={lots} homeFips={homeCounty?.fips ?? null} supabase={supabase} />
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
