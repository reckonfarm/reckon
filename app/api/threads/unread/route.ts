import { createClient } from '@/lib/supabase-server'
import { unreadCount } from '@/lib/messaging-service'

// GET /api/threads/unread — total unread message count for the nav badge
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ count: 0 })
  const count = await unreadCount(user.id)
  return Response.json({ count })
}
