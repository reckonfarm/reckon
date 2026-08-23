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
  // The drawn field edges — each entry is one field's buffered-mask smoothed
  // contour (lib/jobs/sweep.ts computeSweepRender). Only boundaries that
  // qualified AND held their raster within the divergence cap are passed;
  // below the gates nothing is drawn. Multi-field jobs pass one ring per
  // graded field.
  boundaries?: { lat: number; lng: number }[][]
  // Cut ground: closed + smoothed polygons (holes = the uncut middle),
  // clipped to the field at the raster stage. Cartography, not data — the
  // numbers come from the raster and the divergence guard keeps these honest.
  fill?: { outer: { lat: number; lng: number }[]; holes: { lat: number; lng: number }[][] }[]
}

export default function JobMapLoader(props: JobMapProps) {
  return <JobMapClient {...props} />
}
