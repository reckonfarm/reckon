import Link from 'next/link'
import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase'
import { createClient } from '@/lib/supabase-server'
import SiteHeader from '@/app/components/SiteHeader'
import SiteFooter from '@/app/components/SiteFooter'
import CountySearch from '@/app/components/CountySearch'
import HomeDroughtMap from '@/app/components/HomeDroughtMap'
import MarketsNews from '@/app/components/MarketsNews'
import MarketsComingSoon from '@/app/components/MarketsComingSoon'

// ─── Markets surface (the default landing) ──────────────────────────────────────
// Async SERVER component rendered by BOTH / and /markets-preview so the two stay
// identical through the transition. It re-homes the acquisition funnel — county
// search (TOP), driest-county chips, nearby-hay — plus the drought map, ABOVE the
// news feed and demand tiles, so a first-time anonymous visitor hits the funnel
// immediately and nothing from the old homepage is orphaned.
//
// Every server query is wrapped so it degrades to empty and NEVER throws/500s.
// Reuses the exact query logic that was inline in app/page.tsx; chips are capped at
// 4 here (passed in, not via a shared default) for this surface.

interface DriestChip {
  name: string
  state: string
  fips: string
  tier: number // highest D tier with coverage (1–4)
}

async function getDriestChips(limit: number, stateFilter?: string): Promise<DriestChip[]> {
  try {
    const db = createServiceClient()
    const { data: weekRow } = await db
      .from('drought_data')
      .select('week_date')
      .order('week_date', { ascending: false })
      .limit(1)
      .single()

    if (!weekRow) return []

    let query = db
      .from('drought_data')
      .select('d1, d2, d3, d4, counties!inner(fips, name, state)')
      .eq('week_date', weekRow.week_date)
      .gt('d1', 0)

    if (stateFilter) {
      query = query.eq('counties.state', stateFilter)
    }

    const { data } = await query
      .order('d4', { ascending: false })
      .order('d3', { ascending: false })
      .order('d2', { ascending: false })
      .order('d1', { ascending: false })
      .limit(limit)

    if (!data) return []

    return data
      .map(row => {
        const c = row.counties as unknown as { fips: string; name: string; state: string } | null
        const d4 = row.d4 ?? 0
        const d3 = row.d3 ?? 0
        const d2 = row.d2 ?? 0
        const tier = d4 > 0 ? 4 : d3 > 0 ? 3 : d2 > 0 ? 2 : 1
        return {
          name: c?.name ?? 'Unknown',
          state: c?.state ?? '',
          fips: c?.fips ?? '',
          tier,
        }
      })
      .filter(c => c.fips)
  } catch {
    return []
  }
}

async function getNearbyHayCount(stateCode: string): Promise<number> {
  try {
    const db = createServiceClient()
    const { count } = await db
      .from('hay_listings')
      .select('id, counties!inner(state)', { count: 'exact', head: true })
      .eq('active', true)
      .gt('expires_at', new Date().toISOString())
      .eq('counties.state', stateCode)
    return count ?? 0
  } catch {
    return 0
  }
}

const CHIP_LIMIT = 4

export default async function MarketsHome({ fips }: { fips?: string | null }) {
  // Resolve sign-in for the demand-probe tiles. Failure → signed-out; never throws,
  // never redirects (the whole point of Phase 2: everyone lands here).
  let signedIn = false
  try {
    const supabase = await createClient()
    signedIn = Boolean((await supabase.auth.getUser()).data.user)
  } catch {
    signedIn = false
  }

  const headersList = await headers()
  const visitorRegion = headersList.get('x-vercel-ip-country-region') ?? ''
  // x-vercel-ip-country-region returns state codes like "MT", "GA", "TX"
  const visitorState = visitorRegion.length === 2 ? visitorRegion : ''

  const [driestChipsLocal, driestChipsNational, nearbyHayCount] = await Promise.all([
    visitorState ? getDriestChips(CHIP_LIMIT, visitorState) : Promise.resolve([]),
    getDriestChips(CHIP_LIMIT),
    visitorState ? getNearbyHayCount(visitorState) : Promise.resolve(0),
  ])

  // Use local chips if we got at least 2, otherwise fall back to national.
  const driestChips = driestChipsLocal.length >= 2 ? driestChipsLocal : driestChipsNational
  const chipsLabel =
    driestChipsLocal.length >= 2 && visitorState
      ? `Driest counties in ${visitorState} right now:`
      : 'Driest counties right now:'

  return (
    <>
      {/* Warm up the OSM tile hosts so the drought map's tiles fetch without a cold
          DNS/TLS handshake. */}
      <link rel="preconnect" href="https://a.tile.openstreetmap.org" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://b.tile.openstreetmap.org" crossOrigin="anonymous" />
      <SiteHeader subtitle="Markets" />
      <main className="min-h-screen bg-cream">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
          {/* ── Funnel: county search (TOP) + driest chips + nearby hay ─────────── */}
          <section>
            <p className="mb-2 font-dm-sans text-xs font-semibold uppercase tracking-wider text-forest-green/50">
              Find your county
            </p>
            <CountySearch />

            {driestChips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <p className="w-full font-dm-sans text-xs text-forest-green/40">{chipsLabel}</p>
                {driestChips.map(c => (
                  <Link
                    key={c.fips}
                    href={`/dashboard?fips=${c.fips}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-forest-green/15 bg-white px-3 py-1 font-dm-sans text-xs text-forest-green/70 transition-colors hover:border-forest-green/30 hover:text-forest-green"
                  >
                    <span
                      className="inline-block flex-shrink-0 rounded-full"
                      style={{
                        width: 8,
                        height: 8,
                        background:
                          c.tier === 4
                            ? '#7B2D00'
                            : c.tier === 3
                              ? '#C2410C'
                              : c.tier === 2
                                ? '#D97706'
                                : c.tier === 1
                                  ? '#92400E'
                                  : '#78716C',
                      }}
                    />
                    {c.name}, {c.state}
                  </Link>
                ))}
              </div>
            )}

            {nearbyHayCount > 0 && visitorState && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-rust/15 bg-rust/5 px-4 py-2.5">
                <svg
                  className="h-4 w-4 flex-shrink-0 text-rust"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <rect x="2" y="8" width="20" height="10" rx="2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 8V6a2 2 0 012-2h8a2 2 0 012 2v2" />
                </svg>
                <p className="font-dm-sans text-xs text-forest-green">
                  <span className="font-medium">
                    {nearbyHayCount} hay listing{nearbyHayCount !== 1 ? 's' : ''}
                  </span>{' '}
                  available in {visitorState} right now.{' '}
                  <Link
                    href={`/hay?state=${visitorState}`}
                    className="underline transition-colors hover:text-rust"
                  >
                    Browse hay →
                  </Link>
                </p>
              </div>
            )}
          </section>

          {/* ── Drought map ────────────────────────────────────────────────────── */}
          <section className="mt-8">
            <h2 className="mb-3 font-fraunces text-2xl font-semibold text-forest-green sm:text-3xl">
              Drought conditions
            </h2>
            <HomeDroughtMap />
          </section>

          {/* ── News feed (unchanged) ──────────────────────────────────────────── */}
          <section className="mt-12">
            <MarketsNews fips={fips} />
          </section>

          {/* ── Demand-probe tiles (unchanged) ─────────────────────────────────── */}
          <MarketsComingSoon signedIn={signedIn} />
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
