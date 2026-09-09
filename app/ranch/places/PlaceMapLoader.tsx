'use client'
import dynamic from 'next/dynamic'
import type { LatLng } from '@/lib/places/geo'

// Lazy shell for the places map — same pattern as JobMapLoader and
// HayMapLoader: Leaflet never server-renders, and the chunk never loads
// unless a places surface with a map actually mounts. That matters here more
// than elsewhere: the places LIST is a text page for anyone whose ground
// isn't drawn yet, and it must not pay for Leaflet to say so.
const PlaceMapClient = dynamic(() => import('./PlaceMapClient'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-xl border border-forest-green/10 bg-white">
      <p className="font-dm-sans text-[16px] text-secondary-ink">Loading map…</p>
    </div>
  ),
})

/** A shape already on the map: a saved place, or the draft being confirmed. */
export interface MapShape {
  id: string
  ring: LatLng[]
  /** Draft shapes draw in the draw colour so they read as not-yet-saved. */
  draft?: boolean
}

export interface PlaceMapProps {
  shapes: MapShape[]
  /** Where to open when there is nothing drawn to fit to. */
  initialCenter: LatLng
  height?: number
  /** Draw mode: corner placement on, follow off, toolbar visible. */
  drawing?: boolean
  /** A validated, closed ring the operator accepted. The map never writes. */
  onShape?: (ring: LatLng[], acres: number) => void
  onCancel?: () => void
  useLabel?: string
}

export default function PlaceMapLoader(props: PlaceMapProps) {
  return <PlaceMapClient {...props} />
}
