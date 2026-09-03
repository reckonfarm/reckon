import { createClient } from '@/lib/supabase-server'
import { resolveRanchId } from '@/lib/ranch-membership'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Places — the named spots on the outfit (031). No map, no drawing: the
// smallest path that lets a log say WHERE. geometry stays null ("undrawn",
// the column's own words) until a later session draws it.
//
// GET  /api/places          → { places: [{id, name, kind}] } for the ranch
// POST /api/places          → { name, kind? = 'field' } → { place } (201)
//
// Both on the user-scoped SSR client; the 034 ranch policies ARE the scope
// (no user_id filters here). ranch_id from the person's own membership, null
// when none — the row still lands owner-visible.

const MAX_NAME = 60
const MAX_KIND = 30

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data, error } = await supabase
    .from('places')
    .select('id, name, kind')
    .order('name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ places: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (body.kind != null && typeof body.kind !== 'string') {
    return NextResponse.json({ error: 'kind must be a string' }, { status: 400 })
  }
  // Free text, not an enum (031:46) — lowercased so 'Field' and 'field' are
  // one kind when anything later groups by it.
  const kind = (typeof body.kind === 'string' ? body.kind.trim().toLowerCase().slice(0, MAX_KIND) : '') || 'field'

  const ranch_id = await resolveRanchId(supabase, user.id)

  const { data: place, error } = await supabase
    .from('places')
    .insert({ user_id: user.id, ranch_id, name, kind, geometry: null })
    .select('id, name, kind, ranch_id, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ place }, { status: 201 })
}
