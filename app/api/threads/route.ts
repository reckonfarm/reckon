import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getOrCreateThread, listThreads } from '@/lib/messaging-service'

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

// GET /api/threads — current user's threads (as buyer or seller)
export async function GET() {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const threads = await listThreads(userId)
  return Response.json(threads)
}

// POST /api/threads { listing_id } — open or create a thread for this listing
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const listingId = Number(body?.listing_id)
  if (!Number.isInteger(listingId)) {
    return Response.json({ error: 'listing_id (number) is required' }, { status: 400 })
  }

  const result = await getOrCreateThread(listingId, userId)
  if ('error' in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ ok: true, id: result.id, created: result.created })
}
