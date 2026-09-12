import type { Metadata } from 'next'
import { DashboardShell } from '@/app/dashboard/DashboardShell'

// ─── /weather/programs — Programs, its own destination (Block 7D.6) ───────────
// Drought, LFP and the PRF deadlines together, off the bottom of Weather.
//
// NOT a fifth tab. Four at 320 is already tight, and /weather/locations and
// /weather/radar are the established pattern for a Weather destination that is
// not one — reached by a clear link where the section used to be.
//
// The same DashboardShell and the same data path as Weather, asked for one
// section, so a program surface can never drift from the county the rest of
// Weather is showing.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Programs' }

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<{ fips?: string; gs?: string; ge?: string; pt?: string }> }) {
  return DashboardShell({ searchParams, route: 'programs' })
}
