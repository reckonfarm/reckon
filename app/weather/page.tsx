import type { Metadata } from 'next'
import { DashboardShell } from '@/app/dashboard/DashboardShell'

// ─── /weather — route shell (Block 6A) ────────────────────────────────────────
// The existing Weather body (forecast, rain by place, county rainfall vs
// normal, county drought, programs) on the operation's home county, or ?fips=
// for another county's public weather. Titled "Weather". Content order is 6B's.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Weather' }

export default async function WeatherPage({ searchParams }: { searchParams: Promise<{ fips?: string; gs?: string; ge?: string; pt?: string }> }) {
  return DashboardShell({ searchParams, route: 'weather' })
}
