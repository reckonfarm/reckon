import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// GET /api/profile — current user's profile
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('profiles')
    .select('id, email, display_name, bio, phone, verified_phone, total_sales, seller_avg_rating, seller_review_count, operation_type, region')
    .eq('id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? null)
}

// PATCH /api/profile — update editable profile fields
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  // Whitelist — verified_phone, total_sales, ratings are NEVER user-settable
  const update: Record<string, unknown> = {}
  if (typeof body.display_name === 'string') update.display_name = body.display_name.trim().slice(0, 60) || null
  if (typeof body.bio === 'string') update.bio = body.bio.trim().slice(0, 500) || null
  if (typeof body.phone === 'string') update.phone = body.phone.trim().slice(0, 20) || null
  if (typeof body.operation_type === 'string') update.operation_type = body.operation_type.trim().slice(0, 60) || null
  if (typeof body.region === 'string') update.region = body.region.trim().slice(0, 80) || null

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const db = createServiceClient()
  const { error } = await db.from('profiles').update(update).eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
