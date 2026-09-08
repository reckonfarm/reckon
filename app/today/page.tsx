import type { Metadata } from 'next'
import { DashboardShell } from '@/app/dashboard/DashboardShell'
import { privateTitle } from '@/lib/private-title'

// ─── /today — the signed-in home (Block 6A) ───────────────────────────────────
// The private stack (live job · needs attention · recorded since you checked ·
// quick record · hay · conditions · programs) with the ranch in the header. It
// came OUT of the county page: /dashboard?fips= is public information for
// everyone and keeps its county title; this page never carries one.
export const dynamic = 'force-dynamic'
export async function generateMetadata(): Promise<Metadata> { return privateTitle('Today') }

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ fips?: string; gs?: string; ge?: string; pt?: string }> }) {
  return DashboardShell({ searchParams, route: 'today' })
}
