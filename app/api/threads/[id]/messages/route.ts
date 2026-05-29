import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getThreadMessages, postMessage } from '@/lib/messaging-service'

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

// GET /api/threads/[id]/messages?after=<id> — messages since cursor; marks read
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await params
  const threadId = parseInt(id, 10)
  if (isNaN(threadId)) return Response.json({ error: 'Invalid id' }, { status: 400 })

  const afterRaw = request.nextUrl.searchParams.get('after')
  const afterId = afterRaw != null && /^\d+$/.test(afterRaw) ? parseInt(afterRaw, 10) : null

  const result = await getThreadMessages(threadId, userId, afterId)
  if ('error' in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json(result)
}

// POST /api/threads/[id]/messages { body } | { offer_price_per_ton, offer_tonnage }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await params
  const threadId = parseInt(id, 10)
  if (isNaN(threadId)) return Response.json({ error: 'Invalid id' }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  const result = await postMessage(threadId, userId, {
    body: typeof body.body === 'string' ? body.body : null,
    offer_price_per_ton: body.offer_price_per_ton != null ? Number(body.offer_price_per_ton) : null,
    offer_tonnage: body.offer_tonnage != null ? Number(body.offer_tonnage) : null,
  })
  if ('error' in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ ok: true, id: result.id })
}
