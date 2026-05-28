import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

// POST /api/hay/[id]/claim — a logged-in buyer claims they purchased this listing.
// Sets claim_status='pending' and records the claimant for the seller to confirm.
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
    .select('id, user_id, active, claim_status, sold_at')
    .eq('id', numId)
    .single()

  if (error || !listing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (listing.user_id === user.id) {
    return Response.json({ error: 'You cannot claim your own listing' }, { status: 403 })
  }
  if (listing.sold_at != null) {
    return Response.json({ error: 'This listing is already sold' }, { status: 409 })
  }
  if (!listing.active) {
    return Response.json({ error: 'This listing is no longer active' }, { status: 409 })
  }
  if (listing.claim_status === 'pending' || listing.claim_status === 'confirmed') {
    return Response.json({ error: 'A claim is already in progress on this listing' }, { status: 409 })
  }

  const { error: updErr } = await db
    .from('hay_listings')
    .update({ claim_status: 'pending', buyer_claim_user_id: user.id })
    .eq('id', numId)
    .in('claim_status', ['none', 'rejected'])

  if (updErr) return Response.json({ error: updErr.message }, { status: 500 })
  return Response.json({ ok: true })
}

// DELETE /api/hay/[id]/claim — the listing owner rejects a pending claim.
// Clears the claimant and resets claim_status to 'none' so another buyer can claim.
export async function DELETE(
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
    .select('id, user_id, claim_status')
    .eq('id', numId)
    .single()

  if (error || !listing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (listing.user_id !== user.id) {
    return Response.json({ error: 'Only the listing owner can reject a claim' }, { status: 403 })
  }
  if (listing.claim_status !== 'pending') {
    return Response.json({ error: 'No pending claim to reject' }, { status: 409 })
  }

  const { error: updErr } = await db
    .from('hay_listings')
    .update({ claim_status: 'none', buyer_claim_user_id: null })
    .eq('id', numId)
    .eq('user_id', user.id)

  if (updErr) return Response.json({ error: updErr.message }, { status: 500 })
  return Response.json({ ok: true })
}
