import type { Metadata } from 'next'
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'

export const metadata: Metadata = {
  title: {
    absolute: 'Dryline — Drought & LFP Eligibility for Every U.S. County',
  },
  description:
    'Track drought conditions and FSA LFP program eligibility for your county. Know when you qualify for payments before your neighbor does.',
}
import type { OfficialMapRecord } from '@/app/dashboard/components/OfficialMap'
import OfficialMap from '@/app/dashboard/components/OfficialMap'
import CountySearch from '@/app/components/CountySearch'
import SiteHeader from '@/app/components/SiteHeader'
import { headers } from 'next/headers'

interface DriestyChip {
  name:  string
  state: string
  fips:  string
  tier:  number  // highest D tier with coverage (1–4)
}

async function getLatestNationalMap(): Promise<OfficialMapRecord | null> {
  const db = createServiceClient()
  const { data } = await db
    .from('official_maps')
    .select('id, map_type, scope, release_date, image_url, source_url')
    .eq('map_type', 'usdm_national')
    .order('release_date', { ascending: false })
    .limit(1)
  return data?.[0] ?? null
}

async function getDriestChips(stateFilter?: string): Promise<DriestyChip[]> {
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
      .limit(6)

    if (!data) return []

    return data.map(row => {
      const c = row.counties as unknown as { fips: string; name: string; state: string } | null
      const d4 = row.d4 ?? 0
      const d3 = row.d3 ?? 0
      const d2 = row.d2 ?? 0
      const tier = d4 > 0 ? 4 : d3 > 0 ? 3 : d2 > 0 ? 2 : 1
      return {
        name:  c?.name ?? 'Unknown',
        state: c?.state ?? '',
        fips:  c?.fips ?? '',
        tier,
      }
    }).filter(c => c.fips)
  } catch {
    return []
  }
}

async function getNearbyHayCount(stateCode: string): Promise<number> {
  try {
    const db = createServiceClient()
    const { count } = await db
      .from('hay_listings')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)
      .gt('expires_at', new Date().toISOString())
    return count ?? 0
  } catch {
    return 0
  }
}

export default async function Home() {
  const headersList = await headers()
  const visitorRegion = headersList.get('x-vercel-ip-country-region') ?? ''
  // x-vercel-ip-country-region returns state codes like "MT", "GA", "TX"
  const visitorState = visitorRegion.length === 2 ? visitorRegion : ''

  const [map, driestChipsLocal, driestChipsNational, nearbyHayCount] = await Promise.all([
    getLatestNationalMap(),
    visitorState ? getDriestChips(visitorState) : Promise.resolve([]),
    getDriestChips(),
    visitorState ? getNearbyHayCount(visitorState) : Promise.resolve(0),
  ])

  // Use local chips if we got at least 2, otherwise fall back to national
  const driestChips = (driestChipsLocal.length >= 2) ? driestChipsLocal : driestChipsNational
  const chipsLabel = (driestChipsLocal.length >= 2 && visitorState)
    ? `Driest counties in ${visitorState} right now:`
    : 'Driest counties right now:'

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen bg-cream">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-16">

        {/* ── Split hero ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">

          {/* Left: headline + search + toggle */}
          <div>
            <h1 className="font-fraunces text-3xl font-semibold leading-tight sm:text-4xl">
              <span className="text-rust">Know your drought.</span>
              <br />
              <span className="text-forest-green">Know your programs.</span>
              <br />
              <span className="text-forest-green/60">Find your feed.</span>
            </h1>

            <p className="mt-4 font-dm-sans text-base leading-relaxed text-forest-green/60">
              Real-time drought conditions, FSA disaster program eligibility, and the best place to buy and sell hay — for every county in America.
            </p>

            <div className="mt-8">
              <p className="mb-2 font-dm-sans text-xs font-semibold uppercase tracking-wider text-forest-green/50">
                Find your county
              </p>
              <CountySearch />

              {/* Quick-pick counties — top 6 driest nationally */}
              {driestChips.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <p className="w-full font-dm-sans text-xs text-forest-green/40">
                    {chipsLabel}
                  </p>
                  {driestChips.map(c => (
                    <Link
                      key={c.fips}
                      href={`/dashboard?fips=${c.fips}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-forest-green/15 bg-white px-3 py-1 font-dm-sans text-xs text-forest-green/70 hover:border-forest-green/30 hover:text-forest-green transition-colors"
                    >
                      <span
                        className="inline-block rounded-full flex-shrink-0"
                        style={{
                          width: 8,
                          height: 8,
                          background: c.tier === 4 ? '#7B2D00' : c.tier === 3 ? '#C2410C' : c.tier === 2 ? '#D97706' : c.tier === 1 ? '#92400E' : '#78716C'
                        }}
                      />
                      {c.name}, {c.state}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {nearbyHayCount > 0 && visitorState && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-rust/15 bg-rust/5 px-4 py-2.5">
                <svg className="h-4 w-4 flex-shrink-0 text-rust" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <rect x="2" y="8" width="20" height="10" rx="2"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 8V6a2 2 0 012-2h8a2 2 0 012 2v2"/>
                </svg>
                <p className="font-dm-sans text-xs text-forest-green">
                  <span className="font-medium">{nearbyHayCount} hay listing{nearbyHayCount !== 1 ? 's' : ''}</span> available in {visitorState} right now.{' '}
                  <Link href={`/hay?state=${visitorState}`} className="underline hover:text-rust transition-colors">Browse hay →</Link>
                </p>
              </div>
            )}

          </div>

          {/* Right: map */}
          <div>
            <OfficialMap
              map={map}
              title="U.S. Drought Monitor — Current Conditions"
            />
          </div>
        </div>

        {/* ── Feature row ───────────────────────────────────────────────────── */}
        <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">

          <div className="rounded-xl border border-forest-green/10 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-forest-green/10">
              <svg className="h-5 w-5 text-forest-green" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="10" r="8" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 10l2 2 4-4" />
              </svg>
            </div>
            <p className="font-fraunces text-base font-semibold text-forest-green">Know your check</p>
            <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/60">
              See exactly how much FSA disaster money your operation qualifies for — before your neighbor finds out.
            </p>
          </div>

          <div className="rounded-xl border border-forest-green/10 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-forest-green/10">
              <svg className="h-5 w-5 text-forest-green" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="2,14 7,9 11,12 18,5" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="2" y1="17" x2="18" y2="17" strokeLinecap="round" />
              </svg>
            </div>
            <p className="font-fraunces text-base font-semibold text-forest-green">Track the drought</p>
            <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/60">
              Week-by-week drought intensity for your county over the full grazing season. Know if it's getting better or worse.
            </p>
          </div>

          <div className="rounded-xl border border-forest-green/10 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-forest-green/10">
              <svg className="h-5 w-5 text-forest-green" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 3c0 0-6 6.5-6 10a6 6 0 0012 0c0-3.5-6-10-6-10z" />
              </svg>
            </div>
            <p className="font-fraunces text-base font-semibold text-forest-green">Know your rainfall deficit</p>
            <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/60">
              How far behind are you? Compare this season's rain against 30-year averages for your exact county.
            </p>
          </div>

          <div className="rounded-xl border border-forest-green/10 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-rust/10">
              <svg className="h-5 w-5 text-rust" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="8" width="16" height="8" rx="2" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8V6a2 2 0 012-2h6a2 2 0 012 2v2" />
                <line x1="10" y1="8" x2="10" y2="16" strokeLinecap="round" />
              </svg>
            </div>
            <p className="font-fraunces text-base font-semibold text-forest-green">Find your feed</p>
            <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/60">
              Browse hay listings from sellers across the country. Filter by state and variety. Post your own listing in 60 seconds.
            </p>
            <Link href="/hay" className="mt-3 inline-block font-dm-sans text-xs font-medium text-rust hover:text-rust/70 transition-colors">
              Browse hay listings →
            </Link>
          </div>

        </div>

      </div>
    </main>
    </>
  )
}
