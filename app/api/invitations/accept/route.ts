import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sessionUser } from '@/lib/auth-user'
import { acceptInvitation } from '@/lib/invitations'

// POST /api/invitations/accept { token } → { ok, ranch_id, status }
// THE membership write. The signed-in person's email must match the invitation;
// the token must be open. Idempotent: accepting twice never makes two memberships.
export async function POST(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const result = await acceptInvitation(createServiceClient(), token, s.user)
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  return NextResponse.json(result)
}
