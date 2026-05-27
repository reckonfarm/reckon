import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

// GET /api/hay/sellers/[userId]/reviews — public seller rating summary
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('hay_reviews')
    .select('id, rating, comment, created_at')
    .eq('seller_user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const reviews = data ?? []
  const count = reviews.length
  const avg_rating = count > 0
    ? reviews.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / count
    : null

  return Response.json({ reviews, avg_rating, count })
}
