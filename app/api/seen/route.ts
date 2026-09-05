import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { resolveRanchId } from '@/lib/ranch-membership'

// POST /api/seen — "I've had the ranch's Today in front of me just now."
// Advances ranch_members.last_seen_at (044) for the caller's own membership.
// Service-role write after a membership check, the /api/ranch pattern: no
// member-side UPDATE policy on ranch_members. Seen is not done — this marks
// a visit, never completes anything.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const ranchId = await resolveRanchId(supabase, user.id)
  if (!ranchId) return NextResponse.json({ ok: false, reason: 'no membership' }, { status: 200 })
  const { error } = await createServiceClient()
    .from('ranch_members')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('ranch_id', ranchId)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
