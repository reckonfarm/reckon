import { createServiceClient } from '@/lib/supabase'
import type { OfficialMapRecord } from '@/app/dashboard/components/OfficialMap'
import OfficialMap from '@/app/dashboard/components/OfficialMap'
import CountySearch from '@/app/components/CountySearch'
import FarmerToggle from '@/app/components/FarmerToggle'

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
    <main className="min-h-screen bg-cream">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-16">

        <div className="mb-10">
          <h1 className="font-fraunces text-4xl font-semibold text-forest-green sm:text-5xl">
            Reckon
          </h1>
          <p className="mt-2 font-dm-sans text-base text-forest-green/60">
            Drought and FSA program status for your county.
          </p>
        </div>

        <OfficialMap
          map={map}
          title="U.S. Drought Monitor — Current Conditions"
          className="mb-8"
        />

        <div className="mb-8">
          <p className="mb-2 font-dm-sans text-xs font-semibold uppercase tracking-wider text-forest-green/50">
            Find your county
          </p>
          <CountySearch />
        </div>

        <div>
          <p className="mb-2 font-dm-sans text-xs font-semibold uppercase tracking-wider text-forest-green/50">
            Operation type
          </p>
          <FarmerToggle />
          <p className="mt-2 font-dm-sans text-xs text-forest-green/40">
            Your selection carries into the dashboard.
          </p>
        </div>

      </div>
    </main>
  )
}
