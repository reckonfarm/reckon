import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

// POST /api/hay/[id]/confirm — the listing owner confirms the hay is still
// available. Records last_confirmed_at and pushes expires_at out 30 days so
// the listing reads fresh again. Never destructive; owner-only; not for sold
// listings. The deal-handshake / claim / sold logic is untouched.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const numId = parseInt(id, 10)
  if (isNaN(numId)) return Response.json({ error: 'Invalid id' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const db = createServiceClient()
  const { data: listing, error } = await db
    .from('hay_listings')
    .select('id, user_id, sold_at, claim_status')
    .eq('id', numId)
    .single()

  if (error || !listing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (listing.user_id !== user.id) {
    return Response.json({ error: 'Only the listing owner can confirm it' }, { status: 403 })
  }
  if (listing.sold_at != null || listing.claim_status === 'confirmed') {
    return Response.json({ error: 'This listing is already sold' }, { status: 409 })
  }

  const now = new Date()
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const { error: updErr } = await db
    .from('hay_listings')
    .update({
      last_confirmed_at: now.toISOString(),
      expires_at:        expires.toISOString(),
      active:            true, // re-activates a listing that quietly expired
    })
    .eq('id', numId)
    .eq('user_id', user.id)

  if (updErr) return Response.json({ error: updErr.message }, { status: 500 })
  return Response.json({ ok: true, expires_at: expires.toISOString() })
}
