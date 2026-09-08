import type { Metadata } from 'next'
import { DashboardShell } from '@/app/dashboard/DashboardShell'

// ─── /markets — route shell (Block 6A) ────────────────────────────────────────
// The existing Markets body, on the operation's home county (or ?fips= to look
// at another county's public market context), titled "Markets". Content order
// is Block 6B's.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Markets' }

export default async function MarketsPage({ searchParams }: { searchParams: Promise<{ fips?: string; gs?: string; ge?: string; pt?: string; lot?: string }> }) {
  return DashboardShell({ searchParams, route: 'markets' })
}
