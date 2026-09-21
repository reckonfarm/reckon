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
  /** Block 26: a place with a bunch on it is filled in that bunch's colour. */
  fill?: string
}

/** Block 26: a place with no shape but a known position — a pin, tappable like a shape. */
export interface MapMarker {
  id: string
  position: LatLng
  fill?: string
}

/**
 * Block 7A — a dropped point on the map. `fix` and `accuracyM` are what the
 * phone said and never move; `position` is where the pin is, which starts at
 * the fix and moves only if the person drags it. The map reports a drag and
 * writes nothing.
 */
export interface MapPin {
  fix: LatLng
  accuracyM: number
  position: LatLng
  /** Absent = the pin is shown but not draggable (the live fix, before the drop). */
  onMove?: (p: LatLng) => void
}

/**
 * Block 21 — the ride, drawn as it is laid. `track` is every usable fix so
 * far; `here` is the latest one with its accuracy. The map follows the rider
 * until a finger moves it. Nothing here is a claim: it is the raw thing.
 */
export interface MapTrack {
  points: LatLng[]
  here: LatLng | null
  accuracyM: number | null
}

export interface PlaceMapProps {
  shapes: MapShape[]
  /** Ride mode: the track being laid. */
  track?: MapTrack
  /** Where to open when there is nothing drawn to fit to. */
  initialCenter: LatLng
  /** Pixels, or any CSS length ("40vh") — the Today overview is sized to the screen. */
  height?: number | string
  /** Block 26: places with no shape. */
  markers?: MapMarker[]
  /** Block 26: a tap on a saved shape or a marker. Off while drawing (fight #4). */
  onPlaceTap?: (id: string) => void
  /** Block 26: the ranch overview — expands to full screen, and offers Follow me. */
  overview?: boolean
  /** Pin mode: the map opens on the pin, follow is off, and the pin is the subject. */
  pin?: MapPin
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
