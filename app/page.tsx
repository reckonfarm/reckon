import type { Metadata } from 'next'
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase'

export const metadata: Metadata = {
  title: {
    absolute: 'Reckon — Drought & LFP Eligibility for Every U.S. County',
  },
  description:
    'Track drought conditions and FSA LFP program eligibility for your county. Know when you qualify for payments before your neighbor does.',
}
import type { OfficialMapRecord } from '@/app/dashboard/components/OfficialMap'
import OfficialMap from '@/app/dashboard/components/OfficialMap'
import CountySearch from '@/app/components/CountySearch'
import FarmerToggle from '@/app/components/FarmerToggle'
import SiteHeader from '@/app/components/SiteHeader'

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

export default async function Home() {
  const map = await getLatestNationalMap()

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

              {/* Quick-pick counties */}
              <div className="mt-3 flex flex-wrap gap-2">
                <p className="w-full font-dm-sans text-xs text-forest-green/40">
                  Try a county:
                </p>
                {[
                  { name: 'Petroleum Co., MT', fips: '30069' },
                  { name: 'Cascade Co., MT',   fips: '30013' },
                  { name: 'Custer Co., MT',    fips: '30011' },
                  { name: 'Armstrong Co., TX', fips: '48011' },
                  { name: 'Harding Co., SD',   fips: '46063' },
                ].map(c => (
                  <Link
                    key={c.fips}
                    href={`/dashboard?fips=${c.fips}`}
                    className="rounded-full border border-forest-green/15 bg-white px-3 py-1 font-dm-sans text-xs text-forest-green/70 hover:border-forest-green/30 hover:text-forest-green transition-colors"
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 font-dm-sans text-xs font-semibold uppercase tracking-wider text-forest-green/50">
                Operation type
              </p>
              <FarmerToggle />
              <p className="mt-2 font-dm-sans text-xs text-forest-green/40">
                Your selection carries into the dashboard.
              </p>
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
