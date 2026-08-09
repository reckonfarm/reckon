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

export interface JobMapProps {
  track: TrackPoint[]
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null
  // Detected bale positions (slam fixes, truck-length accurate). Only passed
  // when the session is unlabeled or confirmed as a baler.
  bales?: BalePin[]
  // The field boundary (lib/jobs/boundary.ts) — only passed when its status
  // is 'ok'; a guard-failed boundary is never drawn.
  boundary?: { lat: number; lng: number }[] | null
  // Paint the swept swath (header-width translucent fill under the track).
  // Only true when a boundary exists — the fill is the percent, made visible.
  sweepFill?: boolean
}

export default function JobMapLoader(props: JobMapProps) {
  return <JobMapClient {...props} />
}
