import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sessionUser } from '@/lib/auth-user'
import { resolveRanchId } from '@/lib/ranch-membership'
import { membershipRole, removeMember } from '@/lib/invitations'

// POST /api/members/remove { user_id } → { ok }   OWNERS ONLY; never the last owner.
// Under 043 the removed person immediately loses sight of everything on the
// ranch, including rows they authored; their entries stay in the ranch record.
export async function POST(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const target = typeof body?.user_id === 'string' ? body.user_id : ''
  if (!target) return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
  const ranchId = await resolveRanchId(s.supabase, s.user.id)
  if (!ranchId) return NextResponse.json({ error: 'You are not on a ranch yet.' }, { status: 404 })
  if ((await membershipRole(s.supabase, s.user.id, ranchId)) !== 'owner') return NextResponse.json({ error: 'Only an owner can remove someone from the ranch.' }, { status: 403 })
  const r = await removeMember(createServiceClient(), ranchId, target)
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
}
