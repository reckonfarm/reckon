import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sessionUser } from '@/lib/auth-user'
import { resolveRanchId } from '@/lib/ranch-membership'
import { membershipRole, isRole } from '@/lib/invitations'

// POST /api/members/add { user_id, role } → { ok }   OWNERS ONLY.
//
// Block 13: the Undo for "Remove". ranch_members keeps no row for someone
// removed, so putting them back is a fresh membership row — a service-role
// write after the owner check, the same shape as /remove and /role. It is
// only reachable from the ten-second Undo strip: the app never offers "add a
// person by id" anywhere a person can type one. ranch_members still gets no
// client write policy (Phase A2's rule), and this does not give it one.
export async function POST(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const target = typeof body?.user_id === 'string' ? body.user_id : ''
  if (!target || !isRole(body?.role)) return NextResponse.json({ error: 'user_id and role (owner | member) are required' }, { status: 400 })
  const ranchId = await resolveRanchId(s.supabase, s.user.id)
  if (!ranchId) return NextResponse.json({ error: 'You are not on a ranch yet.' }, { status: 404 })
  if ((await membershipRole(s.supabase, s.user.id, ranchId)) !== 'owner') return NextResponse.json({ error: 'Only an owner can put someone back on the ranch.' }, { status: 403 })
  const service = createServiceClient()
  const { data: exists } = await service.from('ranch_members').select('user_id').eq('ranch_id', ranchId).eq('user_id', target).maybeSingle()
  if (exists) return NextResponse.json({ ok: true, already: true })
  const { error } = await service.from('ranch_members').insert({ ranch_id: ranchId, user_id: target, role: body.role })
  if (error) return NextResponse.json({ error: 'They could not be put back just now.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
