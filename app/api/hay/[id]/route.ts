import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

// GET /api/hay/[id] — single listing with drought tier, seller trust info,
// and the viewer's relationship to the deal (claim / sold / review state).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const numId = parseInt(id, 10)
  if (isNaN(numId)) return Response.json({ error: 'Invalid id' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? null

  const db = createServiceClient()

  const { data, error } = await db
    .from('hay_listings')
    .select(`
      id, user_id, listing_type, hay_type, tonnage, price_per_ton, contact,
      description, haul_radius_miles, relief_flag, expires_at, created_at, active,
      cutting_number, bale_type, bale_weight_lbs, storage_method,
      hay_test_protein_pct, hay_test_tdn_pct, hay_test_rfv, hay_test_moisture_pct,
      photo_urls,
      claim_status, buyer_claim_user_id, sold_to_user_id, sold_external, sold_at,
      counties(id, fips, name, state, lat, lon)
    `)
    .eq('id', numId)
    .single()

  if (error || !data) return Response.json({ error: 'Not found' }, { status: 404 })

  const row = data as typeof data & {
    user_id: string
    active: boolean
    claim_status: string
    buyer_claim_user_id: string | null
    sold_to_user_id: string | null
    sold_external: boolean
    sold_at: string | null
  }

  // Visibility: sold listings stay viewable (so the parties can review);
  // otherwise must be active and unexpired. Removed listings 404.
  const isSold = row.sold_at != null
  const visible = isSold || (row.active && new Date(row.expires_at ?? 0).getTime() > Date.now())
  if (!visible) return Response.json({ error: 'Not found' }, { status: 404 })

  const county        = data.counties as unknown as { id: number }
  const sellerUserId  = row.user_id
  const buyerUserId   = row.sold_to_user_id

  // Parallel: drought week + seller profile + active listing count + reviews of seller
  const [latestWeekRes, profileRes, listingCountRes, reviewsRes] = await Promise.all([
    db.from('drought_data')
      .select('week_date')
      .order('week_date', { ascending: false })
      .limit(1)
      .single(),
    db.from('profiles')
      .select('created_at, verified_phone, display_name')
      .eq('id', sellerUserId)
      .single(),
    db.from('hay_listings')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', sellerUserId)
      .eq('active', true),
    db.from('hay_reviews')
      .select('rating')
      .eq('reviewee_user_id', sellerUserId),
  ])

  // Drought tier (sequential — needs latest week date)
  let droughtTier: number | null = null
  if (latestWeekRes.data) {
    const { data: droughtRow } = await db
      .from('drought_data')
      .select('d1, d2, d3, d4')
      .eq('county_id', county.id)
      .eq('week_date', latestWeekRes.data.week_date)
      .single()
    if (droughtRow) {
      for (let i = 4; i >= 1; i--) {
        const key = `d${i}` as 'd1' | 'd2' | 'd3' | 'd4'
        if ((droughtRow[key] ?? 0) > 0) { droughtTier = i; break }
      }
    }
  }

  const profile = profileRes.data as {
    created_at: string | null
    verified_phone: boolean | null
    display_name: string | null
  } | null

  const sellerSince        = profile?.created_at ?? null
  const verifiedPhone      = profile?.verified_phone ?? false
  const displayName        = profile?.display_name ?? null
  const sellerListingCount = listingCountRes.count ?? 0

  const reviews           = (reviewsRes.data ?? []) as { rating: number }[]
  const sellerReviewCount = reviews.length
  const sellerAvgRating   = sellerReviewCount > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / sellerReviewCount
    : null

  // ── Viewer relationship to the deal ───────────────────────────────────────
  const isOwner         = currentUserId !== null && currentUserId === sellerUserId
  const viewerIsClaimant = currentUserId !== null && currentUserId === row.buyer_claim_user_id
  const viewerIsBuyer   = currentUserId !== null && currentUserId === buyerUserId

  // Owner sees who is claiming (display_name only — never contact info)
  let buyerClaimName: string | null = null
  if (isOwner && row.claim_status === 'pending' && row.buyer_claim_user_id) {
    const { data: c } = await db
      .from('profiles')
      .select('display_name')
      .eq('id', row.buyer_claim_user_id)
      .single()
    buyerClaimName = c?.display_name ?? 'A Dryline member'
  }

  // Review eligibility — only the two parties of a confirmed on-platform deal
  let viewerCanReview     = false
  let viewerHasReviewed   = false
  let counterpartyUserId: string | null = null
  let counterpartyName: string | null = null
  let counterpartyRole: 'seller' | 'buyer' | null = null
  if (
    row.claim_status === 'confirmed' &&
    buyerUserId &&
    !row.sold_external &&
    (isOwner || viewerIsBuyer)
  ) {
    counterpartyUserId = isOwner ? buyerUserId : sellerUserId
    counterpartyRole   = isOwner ? 'buyer' : 'seller'
    const [cpRes, existingRes] = await Promise.all([
      db.from('profiles').select('display_name').eq('id', counterpartyUserId).single(),
      db.from('hay_reviews')
        .select('id')
        .eq('listing_id', numId)
        .eq('reviewer_user_id', currentUserId!)
        .maybeSingle(),
    ])
    counterpartyName  = cpRes.data?.display_name ?? (counterpartyRole === 'seller' ? 'the seller' : 'the buyer')
    viewerHasReviewed = !!existingRes.data
    viewerCanReview   = !existingRes.data
  }

  return Response.json({
    id:                    row.id,
    listing_type:          row.listing_type,
    hay_type:              row.hay_type,
    tonnage:               row.tonnage,
    price_per_ton:         row.price_per_ton,
    contact:               row.contact,
    description:           row.description,
    haul_radius_miles:     row.haul_radius_miles,
    relief_flag:           row.relief_flag,
    expires_at:            row.expires_at,
    created_at:            row.created_at,
    cutting_number:        row.cutting_number,
    bale_type:             row.bale_type,
    bale_weight_lbs:       row.bale_weight_lbs,
    storage_method:        row.storage_method,
    hay_test_protein_pct:  row.hay_test_protein_pct,
    hay_test_tdn_pct:       row.hay_test_tdn_pct,
    hay_test_rfv:          row.hay_test_rfv,
    hay_test_moisture_pct: row.hay_test_moisture_pct,
    photo_urls:            (row as unknown as { photo_urls: string[] | null }).photo_urls ?? [],
    counties:              row.counties,
    mine:                  isOwner,
    droughtTier,
    seller_user_id:        sellerUserId,
    seller_since:          sellerSince,
    seller_listing_count:  sellerListingCount,
    verified_phone:        verifiedPhone,
    display_name:          displayName,
    seller_avg_rating:     sellerAvgRating,
    seller_review_count:   sellerReviewCount,
    // Deal / claim state
    claim_status:          row.claim_status,
    sold_external:         row.sold_external,
    sold_at:               row.sold_at,
    // Viewer relationship
    is_owner:              isOwner,
    viewer_is_claimant:    viewerIsClaimant,
    buyer_claim_name:      buyerClaimName,
    viewer_can_review:     viewerCanReview,
    viewer_has_reviewed:   viewerHasReviewed,
    counterparty_user_id:  counterpartyUserId,
    counterparty_name:     counterpartyName,
    counterparty_role:     counterpartyRole,
  })
}

// PATCH /api/hay/[id] — update own listing fields (currently: photo_urls)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  const allowed = ['photo_urls']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }
  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const db = createServiceClient()
  const { error } = await db
    .from('hay_listings')
    .update(update)
    .eq('id', parseInt(id, 10))
    .eq('user_id', user.id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
