import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { sessionUser } from '@/lib/auth-user'
import { resolveRanchId, getRanch } from '@/lib/ranch-membership'
import { membershipRole, listPeople, createInvitation, normalizeEmail, isRole } from '@/lib/invitations'
import { sendInviteEmail } from '@/lib/email'

// ─── /api/invitations (Phase A2) ──────────────────────────────────────────────
//   GET  → { ranch, me: { user_id, role }, members, invites }   any member
//   POST { email, role } → { invite, acceptUrl, emailed }        OWNERS ONLY
//
// The inviter's ranch and role are read on the USER-SCOPED client — from the
// session, never from the payload. Only after that does the service role write
// the invitation row. ranch_members itself is never written here.
export async function GET(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const ranch = await getRanch(s.supabase, s.user.id)
  if (!ranch) return NextResponse.json({ ranch: null, me: null, members: [], invites: [] })
  const role = await membershipRole(s.supabase, s.user.id, ranch.id)
  if (!role) return NextResponse.json({ error: 'Not a member' }, { status: 403 })
  const people = await listPeople(createServiceClient(), ranch.id)
  return NextResponse.json({ ranch, me: { user_id: s.user.id, role }, ...people })
}

export async function POST(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const email = normalizeEmail(body?.email)
  const role = isRole(body?.role) ? body.role : 'member'
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })

  const ranchId = await resolveRanchId(s.supabase, s.user.id)
  if (!ranchId) return NextResponse.json({ error: 'You are not on a ranch yet.' }, { status: 404 })
  const myRole = await membershipRole(s.supabase, s.user.id, ranchId)
  if (myRole !== 'owner') return NextResponse.json({ error: 'Only an owner can add people to the ranch.' }, { status: 403 })
  if (email === (s.user.email ?? '').toLowerCase()) return NextResponse.json({ error: 'That is your own address.' }, { status: 400 })

  const service = createServiceClient()
  const created = await createInvitation(service, { ranchId, email, role, createdBy: s.user.id })
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: created.status })

  const origin = new URL(req.url).origin
  const acceptUrl = `${origin}/invite/${created.token}`
  const [{ data: ranch }, { data: me }] = await Promise.all([
    service.from('ranches').select('name').eq('id', ranchId).maybeSingle(),
    service.from('profiles').select('display_name, email').eq('id', s.user.id).maybeSingle(),
  ])
  let emailed = false
  try {
    emailed = await sendInviteEmail({ to: email, inviterName: me?.display_name || me?.email || s.user.email || 'Someone', ranchName: ranch?.name || 'the ranch', role, acceptUrl, expiresAt: created.expires_at })
  } catch (err) {
    console.error('[invitations] email failed:', err instanceof Error ? err.message : err)
    emailed = false   // the link still goes back to the inviter
  }
  return NextResponse.json({ invite: { id: created.id, invited_email: email, role, expires_at: created.expires_at }, acceptUrl, emailed }, { status: 201 })
}
