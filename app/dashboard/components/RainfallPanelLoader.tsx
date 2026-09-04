'use client'

import dynamic from 'next/dynamic'
import { Card } from '@/app/components/ui/Card'
import type { PrecipNormalResult } from '@/lib/precip-normal'

// PrecipVsNormalPanel is the one recharts consumer on the site. Imported
// statically it rode in the dashboard's eager first-load chunk; here it loads
// in its own chunk on first mount, after the page has painted. The rainfall
// panel already streams in behind a Suspense boundary on the server
// (RainfallPanelAsync), so the loading placeholder below is the same quiet
// skeleton the page uses for that stream — a viewer sees one shimmer, not two
// different ones. SSR stays on; the card chrome still prerenders.
//
// Client component on purpose: next/dynamic from a Server Component does not
// code-split a Client Component (Next's lazy-loading guide).
function Skeleton() {
  return (
    <Card className="p-4 sm:p-6" aria-hidden="true">
      <style>{`@keyframes dlRainShimmer{0%,100%{opacity:.55}50%{opacity:.85}}.dl-rain-skel{animation:dlRainShimmer 1.4s ease-in-out infinite}`}</style>
      <div className="dl-rain-skel h-40 w-full rounded-lg bg-forest-green/5" />
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="dl-rain-skel h-12 rounded bg-forest-green/5" />
        <div className="dl-rain-skel h-12 rounded bg-forest-green/5" />
        <div className="dl-rain-skel h-12 rounded bg-forest-green/5" />
      </div>
    </Card>
  )
}

const PrecipVsNormalPanel = dynamic(
  () => import('./PrecipForecastSection').then(m => m.PrecipVsNormalPanel),
  { loading: () => <Skeleton /> },
)

export default function RainfallPanelLoader({ data, countyName }: { data: PrecipNormalResult; countyName?: string }) {
  return <PrecipVsNormalPanel data={data} countyName={countyName} />
}
