'use client'

import dynamic from 'next/dynamic'
import type { HerdEstimate } from '@/lib/herd-estimate'
import type { TrendData } from '@/lib/trend'
import type { OutlookData } from '@/lib/outlook'

// The herd-value anchor is loaded client-only (no SSR), the same pattern the dashboard's
// other heavy client islands use (RegionalMapLoader / HayMapLoader). Rendering
// HerdEstimatePanel into the dashboard's SERVER tree broke the whole route's App-Router
// client navigation in production (router.push + <Link> both died; leaf state survived) —
// keeping it out of the SSR/hydration critical path restores navigation. The server still
// computes the estimate/trend/outlook and passes them down as serializable props.
const HerdEstimatePanel = dynamic(() => import('@/app/herd/HerdEstimatePanel'), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden="true"
      className="h-40 rounded-xl border border-forest-green/10 bg-white"
    />
  ),
})

export default function HerdAnchorLoader({
  estimate,
  trend,
  outlook,
}: {
  estimate: HerdEstimate
  trend: TrendData | null
  outlook: OutlookData | null
}) {
  return <HerdEstimatePanel estimate={estimate} trend={trend} outlook={outlook} />
}
