import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

// POST /api/hay/[id]/reviews — leave a review for the other party of a
// completed on-platform deal. Gated to the seller and the confirmed buyer only.
// Recomputes and persists the reviewee's aggregate rating server-side.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const numId = parseInt(id, 10)
  if (isNaN(numId)) return Response.json({ error: 'Invalid id' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const rating = Number(body?.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return Response.json({ error: 'rating must be an integer 1–5' }, { status: 400 })
  }
  const comment = typeof body?.comment === 'string'
    ? body.comment.trim().slice(0, 1000) || null
    : null

  const db = createServiceClient()

  // ── Gate: a confirmed, on-platform deal with the caller as one of the parties
  const { data: listing, error } = await db
    .from('hay_listings')
    .select('id, user_id, sold_to_user_id, claim_status, sold_external, sold_at')
    .eq('id', numId)
    .single()

  if (error || !listing) return Response.json({ error: 'Not found' }, { status: 404 })

  const seller = listing.user_id as string
  const buyer  = listing.sold_to_user_id as string | null

  if (
    listing.claim_status !== 'confirmed' ||
    listing.sold_at == null ||
    listing.sold_external ||
    !buyer
  ) {
    return Response.json({ error: 'This deal is not eligible for reviews' }, { status: 403 })
  }
  if (user.id !== seller && user.id !== buyer) {
    return Response.json({ error: 'Only the buyer or seller of this deal can review' }, { status: 403 })
  }

  const revieweeUserId = user.id === seller ? buyer : seller
  const revieweeRole: 'seller' | 'buyer' = revieweeUserId === seller ? 'seller' : 'buyer'

  // Insert — unique(listing_id, reviewer_user_id) enforces one review per deal
  const { error: insErr } = await db
    .from('hay_reviews')
    .insert({
      listing_id:       numId,
      reviewer_user_id: user.id,
      reviewee_user_id: revieweeUserId,
      reviewee_role:    revieweeRole,
      rating,
      comment,
      verified_deal:    true,
    })

  if (insErr) {
    // 23505 = unique_violation → already reviewed this deal
    if ((insErr as { code?: string }).code === '23505') {
      return Response.json({ error: 'You have already reviewed this deal' }, { status: 409 })
    }
    return Response.json({ error: insErr.message }, { status: 500 })
  }

  // ── Recompute the reviewee's aggregate server-side and persist to profile
  const { data: allReviews } = await db
    .from('hay_reviews')
    .select('rating')
    .eq('reviewee_user_id', revieweeUserId)

  const ratings = (allReviews ?? []) as { rating: number }[]
  const count = ratings.length
  const avg = count > 0
    ? Math.round((ratings.reduce((s, r) => s + r.rating, 0) / count) * 100) / 100
    : null

  await db
    .from('profiles')
    .update({ seller_avg_rating: avg, seller_review_count: count })
    .eq('id', revieweeUserId)

  return Response.json({ ok: true, seller_avg_rating: avg, seller_review_count: count })
}
