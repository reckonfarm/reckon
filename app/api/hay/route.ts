import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

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

// GET /api/hay — all active listings with county info and drought tier
export async function GET() {
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
    .select(`
      id, user_id, listing_type, hay_type, tonnage, price_per_ton, contact,
      description, haul_radius_miles, relief_flag, expires_at, created_at,
      counties(id, fips, name, state, lat, lon)
    `)
    .eq('active', true)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const listings = data ?? []
  if (listings.length === 0) return Response.json([])

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
      return {
        id:                row.id,
        listing_type:      row.listing_type,
        hay_type:          row.hay_type,
        tonnage:           row.tonnage,
        price_per_ton:     row.price_per_ton,
        contact:           row.contact,
        description:       row.description,
        haul_radius_miles: row.haul_radius_miles,
        relief_flag:       row.relief_flag,
        expires_at:        row.expires_at,
        created_at:        row.created_at,
        counties:          row.counties,
        mine:              currentUserId !== null && row.user_id === currentUserId,
        droughtTier:       tierByCounty[(row.counties as unknown as CountyRow).id] ?? null,
      }
    }),
  )
}

// POST /api/hay — create a listing (auth required)
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const {
    county_id, listing_type, hay_type, contact,
    tonnage, price_per_ton, description, haul_radius_miles, relief_flag,
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

  const db = createServiceClient()
  const { data, error } = await db
    .from('hay_listings')
    .insert({
      user_id: userId,
      county_id,
      listing_type,
      hay_type:          hay_type.trim(),
      contact:           contact.trim(),
      tonnage:           tonnage != null ? Number(tonnage) : null,
      price_per_ton:     price_per_ton != null ? Number(price_per_ton) : null,
      description:       description?.trim() || null,
      haul_radius_miles: haul_radius_miles != null ? Number(haul_radius_miles) : null,
      relief_flag:       relief_flag === true,
    })
    .select('id')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
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
