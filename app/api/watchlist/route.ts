import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} from '@/lib/concierge-service'
import { checkAlerts } from '@/lib/alert-service'

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

// GET /api/watchlist          → watchlist entries
// GET /api/watchlist?alerts=1 → active drought alerts for the watchlist
export async function GET(request: NextRequest) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

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
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

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
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

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
