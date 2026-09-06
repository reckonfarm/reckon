'use client'

import dynamic from 'next/dynamic'
import { Card } from '@/app/components/ui/Card'
import type { MarketsChartsProps } from './MarketsCharts'

// recharts loads in its own chunk on first Markets mount (the rainfall panel's
// pattern) — the Today view never pays for it.
function Skeleton() {
  return (
    <Card className="p-4 sm:p-6" aria-hidden="true">
      <div className="h-10 w-full animate-pulse rounded-lg bg-forest-green/5" />
      <div className="mt-4 h-[280px] w-full animate-pulse rounded-lg bg-forest-green/5" />
    </Card>
  )
}

const MarketsCharts = dynamic(() => import('./MarketsCharts'), { loading: () => <Skeleton /> })

export default function MarketsChartsLoader(props: MarketsChartsProps) {
  return <MarketsCharts {...props} />
}
