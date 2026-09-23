import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { getRanchLots, updateLot } from '@/lib/herd-lots'
import { LIMITS } from '@/lib/manual-log'

// ─── POST /api/herd/lots/[id]/head — the head count, on the spot (Block 37) ──
// The number on the Cattle row is the control: this is what its keypad saves,
// through the outbox, so it never blocks on signal. One value; the rest of the
// bunch is read from the row and written back unchanged through the same
// updateLot every edit uses (the head_count_set anchor is written there). A
// replayed count — the outbox retrying, or the same number again — writes
// nothing and answers 200.
//   body { id?: uuid (the outbox's), head_count: 1–20000 } → { lot, duplicate? }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const body = (await req.json().catch(() => null)) as { head_count?: unknown } | null
  const head = body?.head_count
  if (typeof head !== 'number' || !Number.isInteger(head) || head < LIMITS.head.min || head > LIMITS.head.max) {
    return NextResponse.json({ error: `head_count must be a whole number ${LIMITS.head.min}–${LIMITS.head.max}` }, { status: 400 })
  }
  const lot = (await getRanchLots(s.supabase, s.user.id)).find(l => l.id === id)
  if (!lot) return NextResponse.json({ error: 'That bunch is not on your ranch.' }, { status: 404 })
  if (lot.head_count === head) return NextResponse.json({ lot, duplicate: true }, { status: 200 })
  const r = await updateLot(s.supabase, id, { ...lot, head_count: head }, null)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ lot: r.lot }, { status: 201 })
}
