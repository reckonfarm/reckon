import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { updateLot, retireLot } from '@/lib/herd-lots'

// ─── /api/herd/lots/[id] (Block 4B) ────────────────────────────────────────────
//   PATCH  { ...fields, expected_updated_at } → { lot }   409 when the row moved since expected_updated_at
//   DELETE → { lot }                                      retires the lot (never deletes: the ledger keeps its name)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { expected_updated_at, ...fields } = body as Record<string, unknown>
  const expected = typeof expected_updated_at === 'string' && expected_updated_at ? expected_updated_at : null
  const r = await updateLot(s.supabase, id, fields, expected)
  return r.ok ? NextResponse.json({ lot: r.lot }) : NextResponse.json({ error: r.error, code: r.status === 409 ? 'stale' : undefined }, { status: r.status })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const r = await retireLot(s.supabase, id)
  return r.ok ? NextResponse.json({ lot: r.lot }) : NextResponse.json({ error: r.error }, { status: r.status })
}
