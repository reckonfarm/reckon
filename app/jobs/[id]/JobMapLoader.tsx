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

export interface JobMapProps {
  track: TrackPoint[]
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null
}

export default function JobMapLoader(props: JobMapProps) {
  return <JobMapClient {...props} />
}
