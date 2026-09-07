import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient, User } from '@supabase/supabase-js'

// ─── Invitations (Phase A2) ───────────────────────────────────────────────────
// THE SECURITY SHAPE (043): ranch_members is the grant itself and has no client
// write policy. Everything in this module that WRITES membership takes the
// SERVICE-ROLE client and is reached only from a route that has already proven,
// on the USER-SCOPED client, who is asking and what they are to that ranch.
// The token is the only thing that authorizes membership: 32 random bytes,
// shown once, stored only as a SHA-256 hash.

export const INVITE_TTL_DAYS = 7
export const MAX_OPEN_INVITES_PER_RANCH = 10     // open = unaccepted, unrevoked, unexpired
export const MAX_INVITES_PER_RANCH_PER_DAY = 20  // created in the trailing 24 h, any state
export const ROLES = ['owner', 'member'] as const
export type Role = (typeof ROLES)[number]
export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v)

export const normalizeEmail = (v: unknown): string | null => {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null
}
export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

// ─── Who is this person to this ranch? (user-scoped read: RLS decides) ───────
export async function membershipRole(userScoped: SupabaseClient, userId: string, ranchId: string): Promise<Role | null> {
  const { data } = await userScoped.from('ranch_members').select('role').eq('ranch_id', ranchId).eq('user_id', userId).maybeSingle()
  return isRole(data?.role) ? data.role : null
}

export interface Person { user_id: string; email: string | null; name: string | null; role: Role; since: string }
export interface OpenInvite { id: string; invited_email: string; role: Role; created_at: string; expires_at: string; invited_by: string | null }

// ─── The people on a ranch: members + open invitations (service read after a membership check) ──
export async function listPeople(service: SupabaseClient, ranchId: string): Promise<{ members: Person[]; invites: OpenInvite[] }> {
  const [{ data: mems }, { data: invs }] = await Promise.all([
    service.from('ranch_members').select('user_id, role, created_at').eq('ranch_id', ranchId).order('created_at', { ascending: true }),
    service.from('invitations').select('id, invited_email, role, created_at, expires_at, created_by')
      .eq('ranch_id', ranchId).is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: true }),
  ])
  const ids = [...new Set([...(mems ?? []).map(m => m.user_id as string), ...(invs ?? []).map(i => i.created_by as string)])]
  const { data: profs } = ids.length ? await service.from('profiles').select('id, email, display_name').in('id', ids) : { data: [] as { id: string; email: string | null; display_name: string | null }[] }
  const prof = (id: string) => (profs ?? []).find(p => p.id === id)
  const members: Person[] = (mems ?? []).map(m => ({ user_id: m.user_id as string, email: prof(m.user_id as string)?.email ?? null, name: prof(m.user_id as string)?.display_name ?? null, role: (isRole(m.role) ? m.role : 'member'), since: m.created_at as string }))
  const invites: OpenInvite[] = (invs ?? []).map(i => { const p = prof(i.created_by as string); return { id: i.id as string, invited_email: i.invited_email as string, role: isRole(i.role) ? i.role : 'member', created_at: i.created_at as string, expires_at: i.expires_at as string, invited_by: p?.display_name ?? p?.email ?? null } })
  return { members, invites }
}

// ─── Create (service write; the route has proven the actor is an owner) ──────
export type CreateResult = { ok: true; id: string; token: string; expires_at: string } | { ok: false; status: number; error: string }
export async function createInvitation(service: SupabaseClient, args: { ranchId: string; email: string; role: Role; createdBy: string }): Promise<CreateResult> {
  const now = new Date()
  const [{ count: open }, { count: recent }, { data: already }] = await Promise.all([
    service.from('invitations').select('id', { count: 'exact', head: true }).eq('ranch_id', args.ranchId).is('accepted_at', null).is('revoked_at', null).gt('expires_at', now.toISOString()),
    service.from('invitations').select('id', { count: 'exact', head: true }).eq('ranch_id', args.ranchId).gt('created_at', new Date(now.getTime() - 86_400_000).toISOString()),
    service.from('profiles').select('id').eq('email', args.email).maybeSingle(),
  ])
  if ((open ?? 0) >= MAX_OPEN_INVITES_PER_RANCH) return { ok: false, status: 429, error: `This ranch already has ${MAX_OPEN_INVITES_PER_RANCH} open invitations — revoke one first.` }
  if ((recent ?? 0) >= MAX_INVITES_PER_RANCH_PER_DAY) return { ok: false, status: 429, error: 'Too many invitations today — try again tomorrow.' }
  if (already?.id) {
    const { data: m } = await service.from('ranch_members').select('user_id').eq('ranch_id', args.ranchId).eq('user_id', already.id as string).maybeSingle()
    if (m) return { ok: false, status: 409, error: `${args.email} is already on this ranch.` }
  }
  const token = newToken()
  const expires_at = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString()
  const { data, error } = await service.from('invitations')
    .insert({ ranch_id: args.ranchId, invited_email: args.email, role: args.role, token_hash: hashToken(token), created_by: args.createdBy, expires_at })
    .select('id').single()
  if (error) {
    if (error.code === '23505') return { ok: false, status: 409, error: `${args.email} already has an open invitation to this ranch.` }
    return { ok: false, status: 500, error: error.message }
  }
  return { ok: true, id: data.id as string, token, expires_at }
}

// ─── What a token points at (for the landing page; read-only) ───────────────
export type InviteState = 'open' | 'expired' | 'revoked' | 'accepted' | 'invalid'
export interface InviteView { state: InviteState; ranch_id: string | null; ranch_name: string | null; invited_email: string | null; role: Role; inviter: string | null }
export async function inviteForToken(service: SupabaseClient, token: string): Promise<InviteView> {
  const none: InviteView = { state: 'invalid', ranch_id: null, ranch_name: null, invited_email: null, role: 'member', inviter: null }
  if (!token || token.length > 128) return none
  const { data: inv } = await service.from('invitations').select('id, ranch_id, invited_email, role, expires_at, accepted_at, revoked_at, created_by, ranches(name)').eq('token_hash', hashToken(token)).maybeSingle()
  if (!inv) return none
  const { data: p } = await service.from('profiles').select('email, display_name').eq('id', inv.created_by as string).maybeSingle()
  const rel = inv.ranches as { name?: string } | { name?: string }[] | null
  const ranch_name = (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? null
  const state: InviteState = inv.revoked_at ? 'revoked' : inv.accepted_at ? 'accepted' : new Date(inv.expires_at as string).getTime() < Date.now() ? 'expired' : 'open'
  return { state, ranch_id: inv.ranch_id as string, ranch_name, invited_email: inv.invited_email as string, role: isRole(inv.role) ? inv.role : 'member', inviter: p?.display_name ?? p?.email ?? null }
}

// ─── Accept (THE membership write; service role; idempotent) ─────────────────
export type AcceptResult = { ok: true; ranch_id: string; status: 'joined' | 'already_member' } | { ok: false; status: number; code: 'invalid' | 'expired' | 'revoked' | 'used' | 'email_mismatch'; error: string }
export async function acceptInvitation(service: SupabaseClient, token: string, user: User): Promise<AcceptResult> {
  const bad = (status: number, code: Exclude<AcceptResult, { ok: true }>['code'], error: string): AcceptResult => ({ ok: false, status, code, error })
  if (!token || token.length > 128) return bad(404, 'invalid', 'This invitation link is not valid.')
  const { data: inv } = await service.from('invitations').select('id, ranch_id, invited_email, role, expires_at, accepted_at, accepted_by, revoked_at').eq('token_hash', hashToken(token)).maybeSingle()
  if (!inv) return bad(404, 'invalid', 'This invitation link is not valid.')
  if (inv.revoked_at) return bad(410, 'revoked', 'This invitation was revoked.')
  const email = (user.email ?? '').trim().toLowerCase()
  if (email !== inv.invited_email) return bad(403, 'email_mismatch', `This invitation was sent to ${inv.invited_email}. You are signed in as ${email || 'a different account'}.`)
  const ranchId = inv.ranch_id as string
  // Idempotent: the same person accepting again is a no-op, not a second membership.
  const { data: existing } = await service.from('ranch_members').select('user_id').eq('ranch_id', ranchId).eq('user_id', user.id).maybeSingle()
  if (existing) {
    if (!inv.accepted_at) await service.from('invitations').update({ accepted_at: new Date().toISOString(), accepted_by: user.id }).eq('id', inv.id as string)
    return { ok: true, ranch_id: ranchId, status: 'already_member' }
  }
  if (inv.accepted_at) return bad(410, 'used', 'This invitation has already been used.')
  if (new Date(inv.expires_at as string).getTime() < Date.now()) return bad(410, 'expired', 'This invitation has expired — ask for a new one.')
  // Stamp the invitation FIRST, only if still open (a second racing accept finds it stamped and stops).
  const { data: stamped } = await service.from('invitations').update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq('id', inv.id as string).is('accepted_at', null).is('revoked_at', null).select('id')
  if (!stamped?.length) return bad(410, 'used', 'This invitation has already been used.')
  const { error } = await service.from('ranch_members').insert({ ranch_id: ranchId, user_id: user.id, role: isRole(inv.role) ? inv.role : 'member' })
  if (error && error.code !== '23505') {
    await service.from('invitations').update({ accepted_at: null, accepted_by: null }).eq('id', inv.id as string)  // give the invite back
    throw new Error(`membership insert: ${error.message}`)
  }
  await service.from('profiles').upsert({ id: user.id, email: user.email ?? email }, { onConflict: 'id', ignoreDuplicates: true })
  return { ok: true, ranch_id: ranchId, status: 'joined' }
}

// ─── Revoke (service write after the owner check) ────────────────────────────
export async function revokeInvitation(service: SupabaseClient, id: string, ranchId: string): Promise<boolean> {
  const { data } = await service.from('invitations').update({ revoked_at: new Date().toISOString() })
    .eq('id', id).eq('ranch_id', ranchId).is('accepted_at', null).is('revoked_at', null).select('id')
  return (data?.length ?? 0) > 0
}

// ─── Remove / change role (service writes after the owner check; never the last owner) ──
async function ownerCount(service: SupabaseClient, ranchId: string): Promise<number> {
  const { count } = await service.from('ranch_members').select('user_id', { count: 'exact', head: true }).eq('ranch_id', ranchId).eq('role', 'owner')
  return count ?? 0
}
export type MemberResult = { ok: true } | { ok: false; status: number; error: string }
export async function removeMember(service: SupabaseClient, ranchId: string, targetUserId: string): Promise<MemberResult> {
  const { data: target } = await service.from('ranch_members').select('role').eq('ranch_id', ranchId).eq('user_id', targetUserId).maybeSingle()
  if (!target) return { ok: false, status: 404, error: 'That person is not on this ranch.' }
  if (target.role === 'owner' && (await ownerCount(service, ranchId)) <= 1) return { ok: false, status: 409, error: 'A ranch keeps at least one owner — make someone else an owner first.' }
  const { error } = await service.from('ranch_members').delete().eq('ranch_id', ranchId).eq('user_id', targetUserId)
  return error ? { ok: false, status: 500, error: error.message } : { ok: true }
}
export async function setMemberRole(service: SupabaseClient, ranchId: string, targetUserId: string, role: Role): Promise<MemberResult> {
  const { data: target } = await service.from('ranch_members').select('role').eq('ranch_id', ranchId).eq('user_id', targetUserId).maybeSingle()
  if (!target) return { ok: false, status: 404, error: 'That person is not on this ranch.' }
  if (target.role === 'owner' && role === 'member' && (await ownerCount(service, ranchId)) <= 1) return { ok: false, status: 409, error: 'A ranch keeps at least one owner — make someone else an owner first.' }
  const { error } = await service.from('ranch_members').update({ role }).eq('ranch_id', ranchId).eq('user_id', targetUserId)
  return error ? { ok: false, status: 500, error: error.message } : { ok: true }
}
