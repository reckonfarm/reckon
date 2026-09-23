import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { getRanchLots } from '@/lib/herd-lots'
import { readFollowed, writeFollowed } from '@/lib/herd-follow'

// ─── POST /api/herd/follow — follow or unfollow a bunch on Markets (Block 40) ──
// A ranch-wide preference, not a record: the list of bunch ids Markets prices.
//   body { lot_id: uuid, followed: boolean } → { followed: uuid[] } (live ids only)
export async function POST(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { lot_id?: unknown; followed?: unknown } | null
  if (typeof body?.lot_id !== 'string' || typeof body?.followed !== 'boolean') {
    return NextResponse.json({ error: 'lot_id (uuid) and followed (true/false) are required' }, { status: 400 })
  }
  const lots = await getRanchLots(s.supabase, s.user.id)
  if (!lots.some(l => l.id === body.lot_id)) return NextResponse.json({ error: 'That bunch is not on your ranch.' }, { status: 404 })
  const live = new Set(lots.map(l => l.id))
  const current = (await readFollowed(s.supabase, s.user.id)).filter(id => live.has(id))
  const next = body.followed ? [...new Set([...current, body.lot_id])] : current.filter(id => id !== body.lot_id)
  const r = await writeFollowed(s.supabase, s.user.id, next)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  return NextResponse.json({ followed: next })
}
