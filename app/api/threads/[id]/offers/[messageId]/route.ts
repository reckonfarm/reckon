import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { actOnOffer } from '@/lib/messaging-service'

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

// POST /api/threads/[id]/offers/[messageId] { action: 'accept'|'counter'|'decline', offer_price_per_ton?, offer_tonnage? }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { id, messageId } = await params
  const threadId = parseInt(id, 10)
  const msgId = parseInt(messageId, 10)
  if (isNaN(threadId) || isNaN(msgId)) return Response.json({ error: 'Invalid id' }, { status: 400 })

  const body = await request.json().catch(() => null)
  const action = body?.action
  if (action !== 'accept' && action !== 'counter' && action !== 'decline') {
    return Response.json({ error: "action must be 'accept', 'counter', or 'decline'" }, { status: 400 })
  }

  if (action === 'counter') {
    const hasPrice = body.offer_price_per_ton != null
    const hasTons  = body.offer_tonnage != null
    if (!hasPrice && !hasTons) {
      return Response.json({ error: 'A counter offer needs a price and/or tonnage' }, { status: 400 })
    }
  }

  const result = await actOnOffer(threadId, msgId, userId, action, {
    offer_price_per_ton: body?.offer_price_per_ton != null ? Number(body.offer_price_per_ton) : null,
    offer_tonnage: body?.offer_tonnage != null ? Number(body.offer_tonnage) : null,
  })
  if ('error' in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ ok: true })
}
