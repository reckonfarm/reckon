import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

async function getAuthUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

// GET /api/radar — the user's saved searches + recent matches
export async function GET() {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const db = createServiceClient()

  const { data: searchData, error } = await db
    .from('saved_searches')
    .select('id, state, hay_type, listing_type, max_price_per_ton, max_distance_miles, origin_county_id, label, active, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const searches = searchData ?? []
  if (searches.length === 0) return Response.json([])

  // Origin county names (for "within X mi of …" display)
  const originIds = [...new Set(searches.map(s => s.origin_county_id).filter((v): v is number => v != null))]
  const originNameById: Record<number, string> = {}
  if (originIds.length > 0) {
    const { data: cs } = await db.from('counties').select('id, name, state').in('id', originIds)
    for (const c of (cs ?? []) as { id: number; name: string; state: string }[]) {
      originNameById[c.id] = `${c.name}, ${c.state}`
    }
  }

  // Recent matches per search
  const searchIds = searches.map(s => s.id)
  const { data: matchData } = await db
    .from('hay_radar_sent')
    .select('saved_search_id, listing_id, sent_at, hay_listings(id, hay_type, listing_type, price_per_ton, counties(name, state))')
    .in('saved_search_id', searchIds)
    .order('sent_at', { ascending: false })
    .limit(100)

  const matchesBySearch: Record<number, unknown[]> = {}
  for (const m of (matchData ?? []) as unknown as Array<{
    saved_search_id: number
    listing_id: number
    sent_at: string
    hay_listings: { id: number; hay_type: string | null; listing_type: string; price_per_ton: number | null; counties: { name: string; state: string } | null } | null
  }>) {
    const listing = m.hay_listings
    const arr = (matchesBySearch[m.saved_search_id] ??= [])
    if (arr.length >= 5) continue
    arr.push({
      listing_id:    m.listing_id,
      sent_at:       m.sent_at,
      hay_type:      listing?.hay_type ?? null,
      listing_type:  listing?.listing_type ?? null,
      price_per_ton: listing?.price_per_ton ?? null,
      county_name:   listing?.counties?.name ?? null,
      state:         listing?.counties?.state ?? null,
    })
  }

  return Response.json(
    searches.map(s => ({
      ...s,
      origin_county_name: s.origin_county_id != null ? originNameById[s.origin_county_id] ?? null : null,
      matches: matchesBySearch[s.id] ?? [],
    })),
  )
}

// POST /api/radar — create a saved search
export async function POST(request: NextRequest) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return Response.json({ error: 'Invalid body' }, { status: 400 })

  const str = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  // Radar only matches sell/donate; anything else (incl. 'want') becomes null = any.
  const rawType = typeof body.listing_type === 'string' ? body.listing_type : null
  const listing_type = rawType === 'sell' || rawType === 'donate' ? rawType : null

  const origin_county_id = Number.isInteger(body.origin_county_id) ? body.origin_county_id : null
  const max_distance_miles = num(body.max_distance_miles)

  const row = {
    user_id:            userId,
    state:              str(body.state, 2)?.toUpperCase() ?? null,
    hay_type:           str(body.hay_type, 60),
    listing_type,
    max_price_per_ton:  num(body.max_price_per_ton),
    // A distance constraint is meaningless without an origin — drop it if missing.
    max_distance_miles: origin_county_id != null ? max_distance_miles : null,
    origin_county_id,
    label:              str(body.label, 80),
  }

  const db = createServiceClient()
  const { data, error } = await db.from('saved_searches').insert(row).select('id').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true, id: data.id })
}

// PATCH /api/radar — toggle active on one of the user's searches
export async function PATCH(request: NextRequest) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const id = body?.id
  if (!Number.isInteger(id)) return Response.json({ error: 'id (number) is required' }, { status: 400 })
  if (typeof body.active !== 'boolean') return Response.json({ error: 'active (boolean) is required' }, { status: 400 })

  const db = createServiceClient()
  const { error } = await db
    .from('saved_searches')
    .update({ active: body.active })
    .eq('id', id)
    .eq('user_id', userId)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

// DELETE /api/radar — remove one of the user's searches
export async function DELETE(request: NextRequest) {
  const userId = await getAuthUserId()
  if (!userId) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const id = body?.id
  if (!Number.isInteger(id)) return Response.json({ error: 'id (number) is required' }, { status: 400 })

  const db = createServiceClient()
  const { error } = await db.from('saved_searches').delete().eq('id', id).eq('user_id', userId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
