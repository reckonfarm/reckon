import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { getEvent } from '@/lib/activity'

// ─── GET /api/activity/[id] (Block 5A) ────────────────────────────────────────
//   → the exact event: who (and role), what, quantity, work time, recording
//   time, sync state. The event row is read user-scoped (043: membership is the
//   gate), so an id from another ranch answers 404 before any service-role read.
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const e = await getEvent(s.supabase, s.user.id, id)
  if (!e) return NextResponse.json({ error: 'No such entry on your ranch' }, { status: 404 })
  return NextResponse.json({
    event: {
      id: e.row.id, type: e.row.type, actor: e.names.person(e.row.user_id), actor_id: e.row.user_id, actor_role: e.actorRole,
      line: e.line, quantity: e.quantity, place_id: e.placeId, lot_id: e.lotId,
      work_time: e.row.ts, recorded_at: e.row.ingested_at, synced: Boolean(e.row.ingested_at),
    },
  })
}
