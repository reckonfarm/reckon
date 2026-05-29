import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { closeThread } from '@/lib/messaging-service'

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

// POST /api/threads/[id]/close — mark closed from this party; finalize if qualifying
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const { id } = await params
  const threadId = parseInt(id, 10)
  if (isNaN(threadId)) return Response.json({ error: 'Invalid id' }, { status: 400 })

  const result = await closeThread(threadId, userId)
  if ('error' in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ ok: true, ...result })
}
