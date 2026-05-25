import type { NextRequest } from 'next/server'
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} from '@/lib/concierge-service'
import { checkAlerts } from '@/lib/alert-service'

// userId comes from the X-User-Id header, populated by the browser with a UUID
// stored in localStorage. Replace with session.user.id once auth is wired up.
function getUserId(req: NextRequest): string | null {
  return req.headers.get('x-user-id')?.trim() || null
}

// GET /api/watchlist          → watchlist entries
// GET /api/watchlist?alerts=1 → active drought alerts for the watchlist
export async function GET(request: NextRequest) {
  const userId = getUserId(request)
  if (!userId) return Response.json({ error: 'Missing X-User-Id header' }, { status: 400 })

  try {
    if (request.nextUrl.searchParams.get('alerts') === '1') {
      const alerts = await checkAlerts(userId)
      return Response.json(alerts)
    }

    const watchlist = await getWatchlist(userId)
    return Response.json(watchlist)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

// POST /api/watchlist  { countyId, alertLevel? }
export async function POST(request: NextRequest) {
  const userId = getUserId(request)
  if (!userId) return Response.json({ error: 'Missing X-User-Id header' }, { status: 400 })

  const body = await request.json()
  const { countyId, alertLevel = 3 } = body ?? {}

  if (!countyId || typeof countyId !== 'number') {
    return Response.json({ error: 'countyId (number) is required' }, { status: 400 })
  }

  try {
    await addToWatchlist(userId, countyId, alertLevel)
    return Response.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}

// DELETE /api/watchlist  { countyId }
export async function DELETE(request: NextRequest) {
  const userId = getUserId(request)
  if (!userId) return Response.json({ error: 'Missing X-User-Id header' }, { status: 400 })

  const body = await request.json()
  const { countyId } = body ?? {}

  if (!countyId || typeof countyId !== 'number') {
    return Response.json({ error: 'countyId (number) is required' }, { status: 400 })
  }

  try {
    await removeFromWatchlist(userId, countyId)
    return Response.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
