import type { NextRequest } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { matchNewListing } from '@/lib/hay-radar-service'
import { routeDemand } from '@/lib/demand-routing-service'

interface CountyRow {
  id:    number
  fips:  string
  name:  string
  state: string
  lat:   number | null
  lon:   number | null
}

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

// NOTE: profiles is fetched in a separate batched query, NOT embedded here.
// hay_listings.user_id references auth.users (not profiles), so PostgREST has
// no FK relationship to embed `profiles(...)` — attempting it 400s the whole
// query and empties the list. See /api/hay/[id] for the same separate-fetch pattern.
const FULL_LISTING_SELECT = `
  id, user_id, listing_type, hay_type, tonnage, price_per_ton, contact,
  description, haul_radius_miles, relief_flag, expires_at, created_at,
  cutting_number, bale_type, bale_weight_lbs, storage_method,
  hay_test_protein_pct, hay_test_tdn_pct, hay_test_rfv, hay_test_moisture_pct,
  photo_urls, claim_status, sold_at,
  counties(id, fips, name, state, lat, lon)
`

interface SellerProfile {
  display_name:        string | null
  verified_phone:      boolean | null
  total_sales:         number | null
  seller_avg_rating:   number | null
  seller_review_count: number | null
}

// GET /api/hay — all active listings with county info and drought tier
export async function GET() {
  try {
  const currentUserId = await getAuthUserId()
  const db = createServiceClient()

  const { data: latest } = await db
    .from('drought_data')
    .select('week_date')
    .order('week_date', { ascending: false })
    .limit(1)
    .single()


  const { data, error } = await db
    .from('hay_listings')
    .select(FULL_LISTING_SELECT)
    .eq('active', true)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message, details: error.details, hint: error.hint }, { status: 500 })
  }

  const listings = data ?? []
  if (listings.length === 0) return Response.json([])

  // Seller trust fields — fetched separately and stitched by user_id.
  // (No FK from hay_listings to profiles, so this can't be a PostgREST embed.)
  const sellerIds = [...new Set(listings.map(l => (l as typeof l & { user_id: string }).user_id))]
  const { data: profileRows } = await db
    .from('profiles')
    .select('id, display_name, verified_phone, total_sales, seller_avg_rating, seller_review_count')
    .in('id', sellerIds)

  const profileById: Record<string, SellerProfile> = {}
  for (const p of (profileRows ?? []) as (SellerProfile & { id: string })[]) {
    profileById[p.id] = p
  }

  // Drought tier (highest D1–D4 with coverage > 0) per listing county
  let tierByCounty: Record<number, number> = {}
  if (latest) {
    const countyIds = [...new Set(listings.map(l => (l.counties as unknown as CountyRow).id))]
    const { data: droughtRows } = await db
      .from('drought_data')
      .select('county_id, d1, d2, d3, d4')
      .in('county_id', countyIds)
      .eq('week_date', latest.week_date)

    for (const d of droughtRows ?? []) {
      for (let i = 4; i >= 1; i--) {
        const key = `d${i}` as 'd1' | 'd2' | 'd3' | 'd4'
        if ((d[key] ?? 0) > 0) { tierByCounty[d.county_id] = i; break }
      }
    }
  }

  return Response.json(
    listings.map(l => {
      const row = l as typeof l & { user_id: string }
      const profile = profileById[row.user_id] ?? null
      return {
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
        claim_status:          (row as unknown as { claim_status: string | null }).claim_status ?? null,
        sold_at:               (row as unknown as { sold_at: string | null }).sold_at ?? null,
        counties:              row.counties,
        mine:                  currentUserId !== null && row.user_id === currentUserId,
        droughtTier:           tierByCounty[(row.counties as unknown as CountyRow).id] ?? null,
        display_name:          profile?.display_name ?? null,
        verified_phone:        profile?.verified_phone ?? null,
        seller_listing_count:  profile?.total_sales ?? null,
        seller_avg_rating:     profile?.seller_avg_rating ?? null,
        seller_review_count:   profile?.seller_review_count ?? null,
      }
    }),
  )
  } catch (e) {
    return Response.json({ error: 'Internal server error', message: String(e) }, { status: 500 })
  }
}

// POST /api/hay — create a listing (auth required)
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const {
    county_id, listing_type, hay_type, contact,
    tonnage, price_per_ton, description, haul_radius_miles, relief_flag,
    cutting_number, bale_type, bale_weight_lbs, storage_method,
    hay_test_protein_pct, hay_test_tdn_pct, hay_test_rfv, hay_test_moisture_pct,
  } = body ?? {}

  if (!county_id || typeof county_id !== 'number') {
    return Response.json({ error: 'county_id (number) is required' }, { status: 400 })
  }
  if (!['sell', 'want', 'donate'].includes(listing_type)) {
    return Response.json({ error: 'listing_type must be sell, want, or donate' }, { status: 400 })
  }
  if (!hay_type || typeof hay_type !== 'string' || !hay_type.trim()) {
    return Response.json({ error: 'hay_type is required' }, { status: 400 })
  }
  if (!contact || typeof contact !== 'string' || !contact.trim()) {
    return Response.json({ error: 'contact is required' }, { status: 400 })
  }

  const VALID_BALE_TYPES = ['large_round', 'small_round', 'small_square', '3string_square', '4string_square']
  const VALID_STORAGE    = ['outside', 'covered', 'barn']

  if (bale_type != null && !VALID_BALE_TYPES.includes(bale_type)) {
    return Response.json({ error: 'Invalid bale_type' }, { status: 400 })
  }
  if (storage_method != null && !VALID_STORAGE.includes(storage_method)) {
    return Response.json({ error: 'Invalid storage_method' }, { status: 400 })
  }
  if (cutting_number != null && ![1, 2, 3].includes(Number(cutting_number))) {
    return Response.json({ error: 'cutting_number must be 1, 2, or 3' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('hay_listings')
    .insert({
      user_id:               userId,
      county_id,
      listing_type,
      hay_type:              hay_type.trim(),
      contact:               contact.trim(),
      tonnage:               tonnage               != null ? Number(tonnage)               : null,
      price_per_ton:         price_per_ton         != null ? Number(price_per_ton)         : null,
      description:           description?.trim()   || null,
      haul_radius_miles:     haul_radius_miles     != null ? Number(haul_radius_miles)     : null,
      relief_flag:           relief_flag === true,
      cutting_number:        cutting_number        != null ? Number(cutting_number)        : null,
      bale_type:             bale_type             ?? null,
      bale_weight_lbs:       bale_weight_lbs       != null ? Number(bale_weight_lbs)       : null,
      storage_method:        storage_method        ?? null,
      hay_test_protein_pct:  hay_test_protein_pct  != null ? Number(hay_test_protein_pct)  : null,
      hay_test_tdn_pct:       hay_test_tdn_pct       != null ? Number(hay_test_tdn_pct)       : null,
      hay_test_rfv:          hay_test_rfv          != null ? Number(hay_test_rfv)          : null,
      hay_test_moisture_pct: hay_test_moisture_pct != null ? Number(hay_test_moisture_pct) : null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('hay_listings insert error:', error)
    return Response.json({ error: error.message, details: error.details, hint: error.hint }, { status: 500 })
  }

  // Fire-and-forget after the response so neither path can block or fail the POST.
  // A thrown error here is swallowed; the daily cron catches misses.
  const newId = Number(data.id)
  after(async () => {
    // Hay Radar (no-ops on 'want' internally): push new sell/donate listings to buyers.
    try { await matchNewListing(newId) } catch { /* daily cron is the safety net */ }
    // Demand routing: push new 'want' listings to opted-in sellers in haul range.
    if (listing_type === 'want') {
      try { await routeDemand(newId) } catch { /* daily cron is the safety net */ }
    }
  })

  return Response.json({ ok: true, id: data.id })
}

// DELETE /api/hay — deactivate own listing (auth required)
export async function DELETE(request: NextRequest) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const { id } = body ?? {}

  if (!id || typeof id !== 'number') {
    return Response.json({ error: 'id (number) is required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { error } = await db
    .from('hay_listings')
    .update({ active: false })
    .eq('id', id)
    .eq('user_id', userId)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
