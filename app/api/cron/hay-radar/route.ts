import type { NextRequest } from 'next/server'
import { sweepRecentRadar } from '@/lib/hay-radar-service'

// Daily safety-net for Hay Radar (vercel.json: 0 14 * * *).
// The primary path is the inline match-on-create in POST /api/hay; this sweep
// re-checks sell/donate listings from the last ~48h to catch any inline misses.
// Dedup means already-emailed (search, listing) pairs are skipped.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await sweepRecentRadar()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
