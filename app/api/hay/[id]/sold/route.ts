import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'

// POST /api/hay/[id]/sold — listing owner marks the listing sold.
//   { buyer: 'claim' }    → confirms the pending buyer claim (on-platform deal)
//   { buyer: 'external' } → sold off-platform, no counterparty account
// Increments the seller's total_sales exactly once (on the sold_at null→set edge).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const numId = parseInt(id, 10)
  if (isNaN(numId)) return Response.json({ error: 'Invalid id' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const buyer = body?.buyer
  if (buyer !== 'claim' && buyer !== 'external') {
    return Response.json({ error: "buyer must be 'claim' or 'external'" }, { status: 400 })
  }

  const db = createServiceClient()
  const { data: listing, error } = await db
    .from('hay_listings')
    .select('id, user_id, claim_status, buyer_claim_user_id, sold_at')
    .eq('id', numId)
    .single()

  if (error || !listing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (listing.user_id !== user.id) {
    return Response.json({ error: 'Only the listing owner can mark it sold' }, { status: 403 })
  }
  if (listing.sold_at != null) {
    return Response.json({ error: 'This listing is already marked sold' }, { status: 409 })
  }

  const update: Record<string, unknown> = {
    sold_at: new Date().toISOString(),
    active: false,
  }

  if (buyer === 'claim') {
    if (listing.claim_status !== 'pending' || !listing.buyer_claim_user_id) {
      return Response.json({ error: 'No pending buyer claim to confirm' }, { status: 409 })
    }
    update.claim_status    = 'confirmed'
    update.sold_to_user_id = listing.buyer_claim_user_id
  } else {
    // external: drop any pending claim, no counterparty account
    update.sold_external = true
    update.claim_status  = 'none'
    update.buyer_claim_user_id = null
    update.sold_to_user_id = null
  }

  // Guard the increment to the null→set transition: only update rows still unsold.
  const { data: updated, error: updErr } = await db
    .from('hay_listings')
    .update(update)
    .eq('id', numId)
    .eq('user_id', user.id)
    .is('sold_at', null)
    .select('id')

  if (updErr) return Response.json({ error: updErr.message }, { status: 500 })
  if (!updated || updated.length === 0) {
    return Response.json({ error: 'This listing is already marked sold' }, { status: 409 })
  }

  // Increment seller's total_sales (read-modify-write; solo-build, low contention)
  const { data: prof } = await db
    .from('profiles')
    .select('total_sales')
    .eq('id', user.id)
    .single()
  const nextTotal = (prof?.total_sales ?? 0) + 1
  await db.from('profiles').update({ total_sales: nextTotal }).eq('id', user.id)

  return Response.json({ ok: true })
}
