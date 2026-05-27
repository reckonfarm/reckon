'use client'
import dynamic from 'next/dynamic'

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

const HayMapClient = dynamic(() => import('./HayMapClient'), { ssr: false })

export default function HayMapLoader({ listings }: { listings: MapListing[] }) {
  return <HayMapClient listings={listings} />
}
