'use client'
import dynamic from 'next/dynamic'
import type { TrackPoint } from '@/lib/jobs/derive'

// Lazy shell for the job map — same pattern as HayMapLoader: Leaflet never
// server-renders and never loads unless a job page with a track mounts.
const JobMapClient = dynamic(() => import('./JobMapClient'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-xl border border-forest-green/10 bg-white">
      <p className="font-dm-sans text-sm text-forest-green/50">Loading map…</p>
    </div>
  ),
})

export interface BalePin {
  lat: number
  lng: number
  ts: string
  confidence: number
}

// The map's three faces (the page decides which, from the boundary grade):
//   mapping — no qualified boundary yet, machine may be tracing one: the
//             track IS the show. Clean line, small uniform dots.
//   working — boundary qualified: field outline + swept cells lighting up.
//             The track is diagnostics now, behind a toggle, default OFF.
//   plain   — finished job with no boundary story: the track, plainly.
// Baling jobs stay pins-first regardless (bales prop drives that).
export type JobMapMode = 'mapping' | 'working' | 'plain'

export interface JobMapProps {
  track: TrackPoint[]
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null
  mode: JobMapMode
  // Detected bale positions (slam fixes, truck-length accurate). Only passed
  // when the session is unlabeled or confirmed as a baler.
  bales?: BalePin[]
  // The field boundary ring — only passed when the boundary qualified
  // (confirmed or estimate); below the gates it is never drawn.
  boundary?: { lat: number; lng: number }[] | null
  // Row-merged swept-cell rectangles from the sweep raster (working mode) —
  // the fill on screen and the percent beside it are literally these cells.
  cells?: { minLat: number; minLng: number; maxLat: number; maxLng: number }[]
}

export default function JobMapLoader(props: JobMapProps) {
  return <JobMapClient {...props} />
}
