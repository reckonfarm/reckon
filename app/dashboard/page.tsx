import { DashboardShell, countyMetadata } from '@/app/dashboard/DashboardShell'

// ─── /dashboard?fips= — the public county page ────────────────────────────────
// Drought, LFP eligibility, deadlines, weather, and markets for ONE county, for
// everyone, with the county title (the SEO and share surface). The private stack
// lives on /today (Block 6A); a signed-in person who opens a county page is
// looking at public information — the ranch and the record are untouched.
export const dynamic = 'force-dynamic'
export const generateMetadata = countyMetadata

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ fips?: string; gs?: string; ge?: string; pt?: string; view?: string }> }) {
  return DashboardShell({ searchParams, route: 'county' })
}
