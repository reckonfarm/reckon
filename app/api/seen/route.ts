import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { resolveRanchId } from '@/lib/ranch-membership'

// POST /api/seen — "I've had the ranch's Today in front of me just now."
// Advances ranch_members.last_seen_at (044) for the caller's own membership.
// Service-role write after a membership check, the /api/ranch pattern: no
// member-side UPDATE policy on ranch_members. Seen is not done — this marks
// a visit, never completes anything.
// `?surface=markets` (Block 2.5 B7) marks the Markets visit (markets_seen_at,
// migration 048) instead of the ledger's last_seen_at. Same rule: seen ≠ done.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const ranchId = await resolveRanchId(supabase, user.id)
  if (!ranchId) return NextResponse.json({ ok: false, reason: 'no membership' }, { status: 200 })
  const surface = new URL(req.url).searchParams.get('surface')
  const column = surface === 'markets' ? 'markets_seen_at' : 'last_seen_at'
  const { error } = await createServiceClient()
    .from('ranch_members')
    .update({ [column]: new Date().toISOString() })
    .eq('ranch_id', ranchId)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
