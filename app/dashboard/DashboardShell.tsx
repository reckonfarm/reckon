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
import { getLocalForecast, getActiveAlerts, type LocalForecast, type ActiveAlert } from '@/lib/nws'
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
import CountyBanner from '@/app/components/CountyBanner'
import NewsHookCard from '@/app/components/NewsHookCard'
import JobsView, { JobsViewSkeleton } from './components/JobsView'
import { LiveJobCard, TodayJobs } from './components/RanchNow'
// The operation's own cards — moved here from /home (shell pass, commit 3).
import LogIt from './components/LogIt'
import RepeatLastFeeding from './components/RepeatLastFeeding'
import NeedsAttention from './components/NeedsAttention'
import ProgramAlerts from './components/ProgramAlerts'
import { buildProgramAlerts, readDismissals, type ProgramAlert } from '@/lib/program-alerts'
import SinceYouWereHere from './components/SinceYouWereHere'
import SeasonTotals from './components/SeasonTotals'
import HayInventoryCard from './components/HayInventoryCard'
import RecentlyLogged from './components/RecentlyLogged'
import LedgerTabs, { LedgerLoading } from './components/LedgerTabs'
import DeviceAttention from './components/DeviceAttention'
import { createClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
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

export async function countyMetadata({
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

export type ShellRoute = 'county' | 'today' | 'markets' | 'weather'

// ─── The shell (Block 6A) ─────────────────────────────────────────────────────
// One component, four routes. 'county' is /dashboard?fips= — public information
// for everyone, county title, county selector, no private stack. 'today',
// 'markets', 'weather' are the private routes: a member is required, the county
// in play is the operation's home county (or ?fips= to look at another county's
// PUBLIC context — that never changes the ranch or the record), the view is fixed
// by the route, and the in-page view strip is gone (primary navigation carries
// it). The private stack renders on 'today' only.
export async function DashboardShell({
  searchParams,
  route,
}: {
  searchParams: Promise<{ fips?: string; gs?: string; ge?: string; pt?: string; view?: string; lot?: string }>
  route: ShellRoute
}) {
  const sp = await searchParams
  const { gs, ge, pt, view: viewParam } = sp
  const priv = route !== 'county'
  let fips = sp.fips
  if (priv) {
    // A private route needs a member; it resolves the county silently from the
    // home county (or the ?fips= they chose to look at). One cookie read.
    const pre = await createClient()
    const { data: { user: member } } = await pre.auth.getUser()
    if (!member) redirect(`/signin?next=${encodeURIComponent(`/${route}`)}`)
    if (!fips) fips = (await getHomeCountyFips(member.id).catch(() => null)) ?? undefined
  }
  // My Operation defaults to the TODAY view (internal key 'news' — kept so deep
  // links, the heavy-fetch gates, and the middleware redirect stay untouched; same
  // deliberate label↔key mismatch as 'drought'/"Weather"). Jobs via &view=jobs
  // (replaced Activity 2026-08-09 — stale ?view=activity deep links parse here
  // too, its successor view), Weather via &view=drought, Markets via
  // &view=markets. With the marketplace flagged off, ?view=hay (stale deep
  // links, share cards) falls back to Today.
  const view: 'news' | 'jobs' | 'drought' | 'hay' | 'markets' =
    route === 'today' ? 'news'
      : route === 'markets' ? 'markets'
        : route === 'weather' ? 'drought'
          : viewParam === 'jobs' || viewParam === 'activity' ? 'jobs'
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
    // The session resolves county or not (Block 2): a member with no home
    // county lands on the bare dashboard and must still get their ledger.
    // Without a session cookie getUser is a local no-op, so the public
    // no-county page pays nothing.
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      // Profile and ranch (the outfit's name, flow commit 2) side by side —
      // both need only the user; neither waits on the other.
      const [profileResult, ranch] = await Promise.all([
        getOperationProfile({ supabase, user }),
        user ? getRanch(supabase, user.id).catch(() => null) : Promise.resolve(null),
      ])
      return { user, profileResult, ranch }
    })().catch(() => ({ user: null, profileResult: { status: 'unauthenticated' as const }, ranch: null })),
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
  let priorReading: DroughtReading | null           = null   // Block 7.9 — the week before, for the change alert

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
  // Block 7 (Part 2): active NWS warnings for the county center — first on Weather when present.
  const alertsPromise: Promise<ActiveAlert[] | null> =
    selectedCounty && selectedCounty.lat != null && selectedCounty.lon != null
      ? getActiveAlerts(selectedCounty.lat, selectedCounty.lon).catch(() => null)
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
        // Block 7.9 — TWO readings, not one. The change alert needs the week
        // before to know whether anything changed at all; one extra row on an
        // indexed read, no extra round trip.
        .limit(2),
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
    const readings = (latestRow ?? []) as DroughtReading[]
    latest = readings[0] ?? null
    priorReading = readings[1] ?? null
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

  // ── Change-only program alerts (Block 7.9) ────────────────────────────────
  // Computed only for Today, only for a signed-in member. Everything standing
  // lives in Weather → Programs; this is strictly what CHANGED. The prior LFP
  // tier comes from lfp_eligibility_snapshots (018) — the audited weekly
  // engine output — rather than a second expensive USDM recomputation.
  let programAlerts: ProgramAlert[] = []
  if (priv && route === 'today' && selectedCounty && user) {
    try {
      const { data: tiers } = await db
        .from('lfp_eligibility_snapshots')
        .select('week_date, max_tier')
        .eq('county_id', selectedCounty.id)
        .order('week_date', { ascending: false })
        .limit(2)
      const t = (tiers ?? []) as { week_date: string; max_tier: number }[]
      const all = buildProgramAlerts({
        fips: selectedCounty.fips,
        countyName: selectedCounty.name,
        latest,
        prior: priorReading,
        lfpTier: t[0]?.max_tier ?? null,
        priorLfpTier: t[1]?.max_tier ?? null,
        deadlines: deadlineResult,
      })
      const seen = await readDismissals(supabase, user.id)
      programAlerts = all.filter(a => !seen.has(a.key))
    } catch { programAlerts = [] }
  }

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

      {/* Phase A2 — ONE column. Every element of the page shares this spine: the
          county control, the heading, the tabs, and every section. Nothing on the
          page is wider; an element that needs more width is the wrong element. */}
      <main className={priv && route === 'today' ? 'mx-auto max-w-[1160px] px-4 py-6 sm:px-5 lg:grid lg:grid-cols-[minmax(0,42rem)_minmax(18rem,1fr)] lg:items-start lg:gap-8' : 'mx-auto max-w-2xl px-4 py-6 sm:px-5'} data-audit="column">
        <ScrollToTop />
        {/* Block 6B — one short first-visit banner on the public county page; the county data stays first. */}
        {!priv && !user && selectedCounty && <CountyBanner />}

        {/* ── County selector (flow, commit 4) ──────────────────────────────────
               The public county page's whole job is picking a county, so signed
               out it stays here, the page's main control. Signed in with a county
               it leaves this slot — the operation is the subject — and lives in
               the Weather view as "change the county you're looking at". The one
               dependency: a signed-in person with NO county (bare /dashboard,
               no home county) still needs a way to one, so it stays here for
               them too, above the EmptyState that points at it. */}
        {/* ── The private ledger, county or not (Block 2, pilot blocker) ──
            A member of a ranch logs from here whether or not a home county
            is set: county selection is for the public drought / program /
            weather / market tools, never a gate on the ledger. Same
            self-gating, RLS-scoped components as the county view's Today. */}
        {priv && route === 'today' && !selectedCounty && (
          <div className="mb-8 space-y-4">
            {/* Block 5E order: live job · since you last checked · quick record · hay on hand (the ledger strip opens on Hay). */}
            <Suspense fallback={null}>
              <LiveJobCard />
            </Suspense>
            <Suspense fallback={null}>
              <SinceYouWereHere />
            </Suspense>
            <Suspense fallback={null}>
              <RepeatLastFeeding />
            </Suspense>
            <LogIt sheet={false} />
            <div id="ledgers" />
            <LedgerTabs
              season={<Suspense fallback={<LedgerLoading />}><SeasonTotals heading={false} /></Suspense>}
              hay={<Suspense fallback={<LedgerLoading />}><HayInventoryCard heading={false} /></Suspense>}
              logged={<Suspense fallback={<LedgerLoading />}><RecentlyLogged heading={false} /></Suspense>}
            />
          </div>
        )}

        {(!priv || !selectedCounty) && (
          <section className="mb-6" aria-label="County">
            <CountySelector selectedCounty={selectedCounty} />
          </section>
        )}

        {/* ── National view (no county selected) ───────────────────────────── */}
        {!fips && !(priv && route === 'today') && <EmptyState signedIn={!!user} />}

        {fips && !selectedCounty && (
          <p className="text-[16px] text-secondary-ink font-dm-sans">
            County not found for FIPS {fips}.
          </p>
        )}

        {/* ── Ranch view (county selected) ───────────────────────── */}
        {selectedCounty && (
          <>
          <div className="pb-16 space-y-4">
            <DashboardViewProvider initial={view}>

            {/* ── B1: compact orientation bar — WHICH county, before any money or market
                   read. One slim row shared across all views: county + FIPS left, the same
                   Share / Home / Watchlist controls (identical props and handlers) right.
                   Relocated from below the herd block; CountySelector above is untouched. ── */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {/* Semantic h1 (the page's only heading — public county pages are the SEO
                  surface) at the compact text-lg size; !important beats the level-1 scale. */}
              {priv && ranchName ? (
                // A named outfit is the subject (flow, commit 2); the secondary
                // line is the OPERATION's county — the home county, the one the
                // landing and the bottom anchor resolve to — not whichever county
                // is in view (layout, commit 2; the old line read "Home base ·"
                // and showed the county in view, which was wrong whenever they
                // differed). A different county in view is named after it; no
                // home county yet says so. Same h1 slot and size.
                <div className="min-w-0">
                  {/* /markets owns its h1 ("Markets · {area}", Block 6B); the ranch stays in the header. */}
                  {route === 'markets' || route === 'weather' ? <p className="font-fraunces text-lg font-semibold leading-snug text-ink">{ranchName}</p> : <Heading level={1} className="!text-lg !leading-snug">{ranchName}</Heading>}
                  <p className="font-dm-sans text-[14px] text-secondary-ink" data-testid="operation-line">
                    {homeCounty
                      ? `Operation · ${homeCounty.name}, ${homeCounty.state}`
                      : 'Operation · No home county set'}
                    {(!homeCounty || homeCounty.fips !== selectedCounty.fips) && (
                      <> · Viewing {selectedCounty.name}, {selectedCounty.state}</>
                    )}
                  </p>
                </div>
              ) : (
                <Heading level={1} className="!text-lg !leading-snug">
                  {selectedCounty.name}, {selectedCounty.state}
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
            {!priv && <DroughtCattleToggle />}

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
                ...(priv && route !== 'today' ? {} : { news: (
                  <>
                    {/* ── Today, reordered (Block 5E). Signed in, Today is a WORKING surface:
                          1. a machine working right now (and today's finished sessions)
                          2. what needs attention — LFP when loud, a deadline when loud, the quiet program row
                          3. recorded since you last checked
                          4. quick record — repeat last, Log it
                          5. hay on hand and runway — the ledger strip, opening on Hay (This season · Recently logged one tap away)
                          6. condition strips — drought chip + today's forecast, then the 7-day carousel
                          7. no news feed (ruled Aug 9; the headlines stay on the signed-out county page only)
                        Same self-gating components; every card that has nothing to say renders nothing. */}
                    {priv && route === 'today' && (
                      <>
                        {/* 2. Live job — conditional behaviour untouched; it renders
                            nothing unless a machine is working. Nothing is reserved for
                            it, because reserving space for a card that is usually absent
                            would put a permanent hole at the top of Today. */}
                        <Suspense fallback={null}>
                          <LiveJobCard />
                        </Suspense>
                        <Suspense fallback={null}>
                          <TodayJobs />
                        </Suspense>
                      </>
                    )}

                    {/* 2. Needs attention. Block 7.7/7.8: the LFP card, the drought
                        designation and the deadline cards are NOT on Today any more —
                        they live in Weather → Programs, because none of them is
                        something the ranch does today. They still lead the PUBLIC county
                        page, which is a drought-and-program tool and the signed-out
                        funnel depends on them; this block only ever reached county and
                        today, so `route !== 'today'` leaves the public page untouched. */}
                    {route !== 'today' && (
                      <>
                        <Suspense fallback={<LfpAlertSkeleton />}>
                          <LfpCardAsync
                            dataPromise={lfpPromise}
                            priorYearPromise={priorYearPromise}
                            countyName={selectedCounty.name}
                            fips={selectedCounty.fips}
                          />
                        </Suspense>
                        {isDeadlineLoud(deadlineResult) && (
                          <DeadlineCountdownCard result={deadlineResult} countyName={selectedCounty.name} />
                        )}
                      </>
                    )}
                    {/* "Check device" — only when a device has a known cadence and missed it (Block 6A). */}
                    {priv && route === 'today' && (
                      <Suspense fallback={null}>
                        <DeviceAttention />
                      </Suspense>
                    )}
                    {!(priv && route === 'today') && (
                      <DeadlineQuietRow
                        countyName={selectedCounty.name}
                        quietDeadline={isDeadlineLoud(deadlineResult) ? null : deadlineResult}
                      />
                    )}

                    {priv && route === 'today' && (
                      <>
                        {/* 3. Changed — program news only when something actually
                            changed, dismissible per person and per change. */}
                        <ProgramAlerts alerts={programAlerts} />
                        {/* 4. Needs attention — only real state, nothing when there is none. */}
                        <NeedsAttention />
                        {/* 4. Recorded since you checked (Block 2E / 5F / 6A): 3–5 rows + View all N updates; the quiet line when nothing is new.

                            Block 7.7 — RESERVED HEIGHT, not `fallback={null}`. These two
                            stream in, and an empty fallback meant the Repeat-feeding
                            button climbed the page as each one landed: measured CLS 0.855
                            on Today at 320px. A thumb already travelling toward "Record 13
                            bales now" can arrive somewhere else.

                            The floors are MEASURED, not guessed: a populated
                            since-you-checked card renders 397px at 390 and 378 at 320, and
                            the repeat card 232 and 253. A floor cannot be exact for both a
                            populated and a quiet state, so it is set for the populated one
                            — the state a working ranch is in most mornings, and the only
                            state where the button below it is worth mis-tapping. */}
                        <Suspense fallback={<div className="min-h-[360px]" aria-hidden />}>
                          <SinceYouWereHere />
                        </Suspense>
                        {/* 5. Quick record — repeat last (Block 2B), then Log it. */}
                        <Suspense fallback={<div className="min-h-[248px]" aria-hidden />}>
                          <RepeatLastFeeding />
                        </Suspense>
                        <LogIt sheet={false} />
                        {/* 5. Hay on hand and runway — the ledger strip opens on Hay; This season and
                            Recently logged stay one tap away (views2, commit 4). */}
                        <div id="ledgers" />
                        <LedgerTabs
                          season={<Suspense fallback={<LedgerLoading />}><SeasonTotals heading={false} /></Suspense>}
                          hay={<Suspense fallback={<LedgerLoading />}><HayInventoryCard heading={false} /></Suspense>}
                          logged={<Suspense fallback={<LedgerLoading />}><RecentlyLogged heading={false} /></Suspense>}
                        />
                      </>
                    )}

                    {/* 6. Condition strips — drought chip + today's forecast (B2′), then the 7-day
                        carousel (Today only since layout commit 3). Signed out this is the top of
                        the county page after the loud cards. */}
                    {!(priv && route === 'today') && (
                      <>
                        <ConditionsStrip reading={latest} fips={selectedCounty.fips} />
                        <div>
                          <p className={`${EYEBROW} mb-3`}>7-day forecast</p>
                          <Suspense fallback={<ForecastPanelSkeleton />}>
                            <ForecastPanelAsync dataPromise={forecastPromise} />
                          </Suspense>
                        </div>
                      </>
                    )}

                    {/* 7. No news feed on the signed-in Today. The headlines hook stays on the
                        public county page for the signed-out visitor. */}
                    {!priv && <NewsHookCard fips={selectedCounty.fips} />}
                  </>
                ) }),
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
                          forecastPromise={forecastPromise}
                          alertsPromise={alertsPromise}
                          titled={route === 'weather'}
                          programs={route === 'weather' ? (
                            <>
                              <Suspense fallback={<LfpAlertSkeleton />}>
                                <LfpCardAsync
                                  dataPromise={lfpPromise}
                                  priorYearPromise={priorYearPromise}
                                  countyName={selectedCounty.name}
                                  fips={selectedCounty.fips}
                                />
                              </Suspense>
                              {isDeadlineLoud(deadlineResult)
                                ? <DeadlineCountdownCard result={deadlineResult} countyName={selectedCounty.name} />
                                : <DeadlineQuietRow countyName={selectedCounty.name} quietDeadline={deadlineResult} />}
                            </>
                          ) : null}
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
                        <MarketsViewBody selectedCounty={selectedCounty} lots={lots} homeFips={homeCounty?.fips ?? null} supabase={supabase} sellBarn={profileResult.status === 'ok' ? profileResult.profile.sell_barn_slug ?? null : null}  ranchId={profileResult.status === 'ok' ? profileResult.profile.ranch_id ?? null : null} selectedLotId={sp.lot ?? null} titled={route === 'markets'} />
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
          {/* Today's strips (Block 6A): conditions (weather only), then programs — LFP as one
              quiet line with its details one tap away. One column on a phone, below the
              record; a right column on desktop (the shell is 1,160 px wide there). */}
          {/* Block 7.7/7.8 — the Today strips are GONE. This aside still carried
              the drought chip (ConditionsStrip) and the program deadline row
              (DeadlineQuietRow) after the LFP card had already moved, which is
              two of the three things the order takes off Today. Both live in
              Weather now: the drought reading in the county-drought card, the
              deadline in Weather → Programs, where it names its program. It
              was also the last big late-arriving block on the page and half of
              the remaining layout shift. */}
          </>
        )}
      </main>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-forest-green/8 mx-auto">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-secondary-ink">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
      </div>
      <Heading level={3}>
        {signedIn ? 'Pick a county for the county tools' : 'Select a county to begin'}
      </Heading>
      <p className="mt-2 max-w-xs text-[16px] text-ink font-dm-sans">
        {signedIn
          ? 'Drought, program, weather, and market tools are by county. Your ledger above is here either way.'
          : 'Search above to view drought conditions and weekly history for any US county.'}
      </p>
    </div>
  )
}
