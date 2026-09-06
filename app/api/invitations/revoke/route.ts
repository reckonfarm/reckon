import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sessionUser } from '@/lib/auth-user'
import { resolveRanchId } from '@/lib/ranch-membership'
import { membershipRole, revokeInvitation } from '@/lib/invitations'

// POST /api/invitations/revoke { id } → { ok }   OWNERS ONLY, own ranch only.
export async function POST(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const ranchId = await resolveRanchId(s.supabase, s.user.id)
  if (!ranchId) return NextResponse.json({ error: 'You are not on a ranch yet.' }, { status: 404 })
  if ((await membershipRole(s.supabase, s.user.id, ranchId)) !== 'owner') return NextResponse.json({ error: 'Only an owner can revoke an invitation.' }, { status: 403 })
  const ok = await revokeInvitation(createServiceClient(), id, ranchId)
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'No open invitation with that id on your ranch.' }, { status: 404 })
}
