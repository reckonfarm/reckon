import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

// GET /api/hay/[id] — single listing with all fields and drought tier
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

  // Drought tier for this listing's county
  let droughtTier: number | null = null
  const county = data.counties as unknown as { id: number }

  const { data: latest } = await db
    .from('drought_data')
    .select('week_date')
    .order('week_date', { ascending: false })
    .limit(1)
    .single()

  if (latest) {
    const { data: droughtRow } = await db
      .from('drought_data')
      .select('d1, d2, d3, d4')
      .eq('county_id', county.id)
      .eq('week_date', latest.week_date)
      .single()

    if (droughtRow) {
      for (let i = 4; i >= 1; i--) {
        const key = `d${i}` as 'd1' | 'd2' | 'd3' | 'd4'
        if ((droughtRow[key] ?? 0) > 0) { droughtTier = i; break }
      }
    }
  }

  const row = data as typeof data & { user_id: string }
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
  })
}
