import { createServiceClient } from '@/lib/supabase'
import HayMapLoader from './HayMapLoader'
import SiteFooter from '@/app/components/SiteFooter'

export const dynamic = 'force-dynamic'

interface MapListing {
  id: string
  hay_type: string | null
  listing_type: string
  price_per_ton: number | null
  tonnage: number | null
  lat: number
  lon: number
  drought_tier: number | null
  county_name: string
  state: string
}

export default async function HayMapPage() {
  const db = createServiceClient()

  // Step 1: fetch active listings with county location
  const { data: rows } = await db
    .from('hay_listings')
    .select('id, hay_type, listing_type, price_per_ton, tonnage, counties(id, name, state, lat, lon)')
    .eq('active', true)
    .not('counties', 'is', null)
    .limit(500)

  if (!rows || rows.length === 0) return (
    <>
      <HayMapLoader listings={[]} />
      <SiteFooter />
    </>
  )

  // Step 2: fetch latest drought data for the unique county IDs
  const countyIds = [...new Set(
    rows.flatMap(r => {
      const c = Array.isArray(r.counties) ? r.counties[0] : r.counties
      return c?.id ? [c.id] : []
    })
  )]

  const { data: droughtRows } = await db
    .from('drought_data')
    .select('county_id, d0, d1, d2, d3, d4')
    .in('county_id', countyIds)
    .order('week_date', { ascending: false })

  // Keep only the most recent row per county
  const latestDrought = new Map<string, { d0:number, d1:number, d2:number, d3:number, d4:number }>()
  for (const row of droughtRows ?? []) {
    if (!latestDrought.has(row.county_id)) {
      latestDrought.set(row.county_id, { d0: row.d0, d1: row.d1, d2: row.d2, d3: row.d3, d4: row.d4 })
    }
  }

  function tierFromDrought(d: { d0:number, d1:number, d2:number, d3:number, d4:number } | undefined): number | null {
    if (!d) return null
    if (d.d4 > 0) return 4
    if (d.d3 > 0) return 3
    if (d.d2 > 0) return 2
    if (d.d1 > 0) return 1
    if (d.d0 > 0) return 0
    return null
  }

  const listings: MapListing[] = rows.flatMap(row => {
    const county = Array.isArray(row.counties) ? row.counties[0] : row.counties
    if (!county || county.lat == null || county.lon == null) return []
    return [{
      id: row.id,
      hay_type: row.hay_type,
      listing_type: row.listing_type,
      price_per_ton: row.price_per_ton,
      tonnage: row.tonnage,
      lat: county.lat,
      lon: county.lon,
      drought_tier: tierFromDrought(latestDrought.get(county.id)),
      county_name: county.name,
      state: county.state,
    }]
  })

  return (
    <>
      <HayMapLoader listings={listings} />
      <SiteFooter />
    </>
  )
}
