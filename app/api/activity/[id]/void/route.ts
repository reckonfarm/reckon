import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { voidEvent } from '@/lib/corrections'

// ─── POST /api/activity/[id]/void (Block 5B) ────────────────────────────────
//   body { id?: uuid (client-minted, retried with the same id), reason?: text }
//   → 201 { event, consequence }   the superseding row and what it means now
//   → 200 { event, duplicate }     the same client id arrived twice
//   → 400 invalid · 404 not on your ranch · 409 already corrected / voided / refused by 054
// The insert runs on the USER-SCOPED client: the 043 INSERT policy is the gate
// (member of the ranch, user_id = the caller); the 054 triggers are the floor.
export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (body != null && typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const r = await voidEvent(s.supabase, s.user.id, id, (body ?? {}) as Record<string, unknown>)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ event: r.event, consequence: r.consequence, ...(r.duplicate ? { duplicate: true } : {}) }, { status: r.status })
}
