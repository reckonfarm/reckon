'use client'

import dynamic from 'next/dynamic'
import type { MapListing } from '@/app/hay/map/HayMapClient'

// Embedded hay map for the dashboard Hay view. Reuses the SAME renderer as the
// full marketplace map (/hay/map) — identical pin style, popup → /hay/[id] link,
// and the non-interactive drought GeoJSON painted UNDER the pins (the slot the
// future county hay-score choropleth drops into). Leaflet is client-only, so the
// renderer loads with no SSR behind a contained skeleton (mirrors RegionalMapLoader).
const HayMapClient = dynamic(() => import('@/app/hay/map/HayMapClient'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[400px] items-center justify-center rounded-xl border border-forest-green/10 bg-white font-dm-sans text-sm text-forest-green/40">
      Loading map…
    </div>
  ),
})

export default function HayMapLoader({
  listings,
  center,
  zoom = 6,
}: {
  listings: MapListing[]
  center: [number, number]
  zoom?: number
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-forest-green/10">
      <HayMapClient listings={listings} center={center} zoom={zoom} height="400px" compactLegend layerControl />
    </div>
  )
}
