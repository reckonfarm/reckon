import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

// Latest Hay Opportunity Score snapshot, keyed by county FIPS. hay_score is RLS-on with
// no policies, so it can ONLY be read with the service role — this server route is the
// gatekeeper (an anon client fetch would get nothing).
//
// AS-OF CONTRACT: snapshot_date is used ONLY to pick the newest snapshot (history key). The
// user-facing freshness is DATA-DERIVED — `window` / `asOfData` / `isProvisional` come from
// what the data actually covers (season_label, months_used), NEVER from the compute date. So
// a stale snapshot can't claim to be "now." Returns { window, monthsUsed, isProvisional,
// asOfData, scores }.
//
// Honest-degraded: on any failure / empty store it returns error:true with empty scores (not
// cached) so the choropleth simply doesn't paint and the legend shows "temporarily
// unavailable" — never a false blank/zero choropleth.

const MONTH_ABBR: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
  '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
}

function fail() {
  return NextResponse.json(
    { window: null, monthsUsed: [], isProvisional: false, asOfData: null, scores: {}, error: true },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function GET() {
  try {
    const db = createServiceClient()

    // Newest snapshot by snapshot_date (history key — which run, not which data period).
    const { data: latest, error: e1 } = await db
      .from('hay_score')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (e1) throw new Error(e1.message)
    if (!latest) return fail()

    const snapshotDate = latest.snapshot_date as string
    const { data, error } = await db
      .from('hay_score')
      .select('fips, score, season_year, season_label, is_provisional, months_used')
      .eq('snapshot_date', snapshotDate)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) return fail()

    const scores: Record<string, number | null> = {}
    for (const r of data) scores[r.fips as string] = r.score as number | null

    // Data-derived freshness from the snapshot's own metadata (same for every row).
    const meta = data[0] as { season_year: number; season_label: string | null; is_provisional: boolean; months_used: string[] | null }
    const window = meta.season_label
    const monthsUsed = meta.months_used ?? []
    const lastMm = monthsUsed.length ? monthsUsed[monthsUsed.length - 1] : null
    const asOfData = lastMm ? `${MONTH_ABBR[lastMm] ?? lastMm} ${meta.season_year}` : window

    return NextResponse.json(
      { window, monthsUsed, isProvisional: meta.is_provisional, asOfData, scores },
      { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' } },
    )
  } catch {
    return fail()
  }
}
