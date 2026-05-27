import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

// GET /api/hay/[id] — single listing with drought tier and seller trust info
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
      description, haul_radius_miles, relief_flag, expires_at, created_at,
      cutting_number, bale_type, bale_weight_lbs, storage_method,
      hay_test_protein_pct, hay_test_tdnpct, hay_test_rfv, hay_test_moisture_pct,
      counties(id, fips, name, state, lat, lon)
    `)
    .eq('id', numId)
    .eq('active', true)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error || !data) return Response.json({ error: 'Not found' }, { status: 404 })

  const row = data as typeof data & { user_id: string }
  const county = data.counties as unknown as { id: number }
  const sellerUserId = row.user_id

  // Parallel: drought week + seller profile + listing count + seller ratings
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
      .eq('seller_user_id', sellerUserId),
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

  // Seller info
  const profile = profileRes.data as {
    created_at: string | null
    verified_phone: boolean | null
    display_name: string | null
  } | null

  const sellerSince         = profile?.created_at ?? null
  const verifiedPhone       = profile?.verified_phone ?? false
  const displayName         = profile?.display_name ?? null
  const sellerListingCount  = listingCountRes.count ?? 0

  // Seller ratings
  const reviews          = (reviewsRes.data ?? []) as { rating: number }[]
  const sellerReviewCount = reviews.length
  const sellerAvgRating  = sellerReviewCount > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / sellerReviewCount
    : null

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
    hay_test_tdnpct:       row.hay_test_tdnpct,
    hay_test_rfv:          row.hay_test_rfv,
    hay_test_moisture_pct: row.hay_test_moisture_pct,
    counties:              row.counties,
    mine:                  currentUserId !== null && row.user_id === currentUserId,
    droughtTier,
    seller_since:          sellerSince,
    seller_listing_count:  sellerListingCount,
    verified_phone:        verifiedPhone,
    display_name:          displayName,
    seller_avg_rating:     sellerAvgRating,
    seller_review_count:   sellerReviewCount,
  })
}
