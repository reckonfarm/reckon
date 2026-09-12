import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { deleteEvent, planDelete } from '@/lib/deletion'

// ─── /api/activity/[id]/delete (Block 7D.1 / 7D.2) ───────────────────────────
//
//   GET    → 200 { plan: { mode, reason, label, ts } }
//            What deleting this would do, so the confirm sheet can say it
//            BEFORE anything happens — including, for the record path, why.
//   DELETE → 200 { mode: 'hard' | 'record', label }
//            Re-plans server-side and does it. The client's opinion of the
//            mode is never trusted: the page may be minutes old, and in that
//            time another member may have read the ledger or corrected it.
//
//   401 not signed in · 404 not on your ranch · 409 already deleted
//
// sessionUser, not the cookie-only client: the isolation suite reaches this
// route with a Bearer token, and a route it cannot reach is a route nobody
// proves is safe.
//
// No database error ever reaches the caller. The 23503 the correction chain
// raises is absorbed in lib/deletion.ts and turns into the record path.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const r = await planDelete(s.supabase, s.user.id, id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ plan: r.plan })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const r = await deleteEvent(s.supabase, s.user.id, id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ mode: r.mode, label: r.label })
}
