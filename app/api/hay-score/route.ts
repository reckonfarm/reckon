import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

// Latest Hay Opportunity Score snapshot, keyed by county FIPS. hay_score is RLS-on with
// no policies, so it can ONLY be read with the service role — this server route is the
// gatekeeper (an anon client fetch would get nothing). Returns { asOf, scores: {fips:score} }
// for the most recent snapshot_date; the dashboard hay-map choropleth joins it to the
// bundled county geometry on FIPS.
//
// Honest-degraded: on any failure / empty store it returns error:true with an empty scores
// map (not cached) so the choropleth simply doesn't paint and the legend shows
// "temporarily unavailable" — never a false blank/zero choropleth.
export async function GET() {
  try {
    const db = createServiceClient()

    const { data: latest, error: e1 } = await db
      .from('hay_score')
      .select('snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (e1) throw new Error(e1.message)
    if (!latest) {
      return NextResponse.json(
        { asOf: null, scores: {}, error: true },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const asOf = latest.snapshot_date as string
    const { data, error } = await db
      .from('hay_score')
      .select('fips, score')
      .eq('snapshot_date', asOf)
    if (error) throw new Error(error.message)

    const scores: Record<string, number | null> = {}
    for (const r of data ?? []) scores[r.fips as string] = r.score as number | null

    return NextResponse.json(
      { asOf, scores },
      { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' } },
    )
  } catch {
    return NextResponse.json(
      { asOf: null, scores: {}, error: true },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
