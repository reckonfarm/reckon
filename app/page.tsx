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

async function getDriestChips(): Promise<DriestyChip[]> {
  try {
    const db = createServiceClient()
    const { data: weekRow } = await db
      .from('drought_data')
      .select('week_date')
      .order('week_date', { ascending: false })
      .limit(1)
      .single()

    if (!weekRow) return []

    const { data } = await db
      .from('drought_data')
      .select('d1, d2, d3, d4, counties(fips, name, state)')
      .eq('week_date', weekRow.week_date)
      .gt('d1', 0)
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

export default async function Home() {
  const [map, driestChips] = await Promise.all([
    getLatestNationalMap(),
    getDriestChips(),
  ])

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
            </h1>

            <p className="mt-4 font-dm-sans text-base leading-relaxed text-forest-green/60">
              Real-time drought conditions and FSA disaster program eligibility for every county in America.
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
                    Tap any county to see its LFP status and payment estimate:
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
        <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-3">

          <div className="rounded-xl border border-forest-green/10 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-forest-green/10">
              <svg className="h-5 w-5 text-forest-green" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="10" r="8" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 10l2 2 4-4" />
              </svg>
            </div>
            <p className="font-fraunces text-base font-semibold text-forest-green">LFP Eligibility</p>
            <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/60">
              See exactly which drought tiers your county has triggered and your estimated payment.
            </p>
          </div>

          <div className="rounded-xl border border-forest-green/10 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-forest-green/10">
              <svg className="h-5 w-5 text-forest-green" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="2,14 7,9 11,12 18,5" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="2" y1="17" x2="18" y2="17" strokeLinecap="round" />
              </svg>
            </div>
            <p className="font-fraunces text-base font-semibold text-forest-green">52-Week Trends</p>
            <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/60">
              Track drought intensity week by week across the full grazing season.
            </p>
          </div>

          <div className="rounded-xl border border-forest-green/10 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-forest-green/10">
              <svg className="h-5 w-5 text-forest-green" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 3c0 0-6 6.5-6 10a6 6 0 0012 0c0-3.5-6-10-6-10z" />
              </svg>
            </div>
            <p className="font-fraunces text-base font-semibold text-forest-green">Precipitation vs Normal</p>
            <p className="mt-1 font-dm-sans text-sm leading-relaxed text-forest-green/60">
              Compare actual rainfall against 30-year normals from the nearest station.
            </p>
          </div>

        </div>

      </div>
    </main>
    </>
  )
}
