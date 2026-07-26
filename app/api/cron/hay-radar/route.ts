import type { NextRequest } from 'next/server'
import { sweepRecentRadar } from '@/lib/hay-radar-service'
import { sweepRecentDemand } from '@/lib/demand-routing-service'
import { flagDisabled } from '@/lib/flags'

// Daily safety-net for Hay Radar + Demand Routing (vercel.json: 0 13 * * *).
// Primary paths are the inline after() hooks in POST /api/hay; these sweeps
// re-check the last ~48h of listings/wants to catch any inline misses.
// Dedup (and the demand 7-day cap) mean already-handled pairs are skipped.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Marketplace flagged off → no radar/demand emails (they'd link into 404'd
  // listings). 200 so Vercel cron logs a clean skip, not a failure.
  if (flagDisabled('marketplace')) {
    return Response.json({ ok: true, skipped: 'marketplace flagged off' })
  }

  try {
    const [radar, demand] = await Promise.all([
      sweepRecentRadar(),
      sweepRecentDemand(),
    ])
    return Response.json({ ok: true, radar, demand })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
