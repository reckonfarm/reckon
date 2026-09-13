import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { updateLot } from '@/lib/herd-lots'
import { trashRow } from '@/lib/trash'

// ─── /api/herd/lots/[id] (Block 4B) ────────────────────────────────────────────
//   PATCH  { ...fields, expected_updated_at } → { lot }   409 when the row moved since expected_updated_at
//   DELETE → { deleted, trashed }                         the trash (Block 12, 12.4); retire is POST …/retire
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { expected_updated_at, ...fields } = body as Record<string, unknown>
  const expected = typeof expected_updated_at === 'string' && expected_updated_at ? expected_updated_at : null
  const r = await updateLot(s.supabase, id, fields, expected)
  return r.ok ? NextResponse.json({ lot: r.lot }) : NextResponse.json({ error: r.error, code: r.status === 409 ? 'stale' : undefined, changed_by: r.changed_by ?? undefined, changed_at: r.changed_at ?? undefined }, { status: r.status })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  // Block 12 (12.4): DELETE puts the bunch in the trash. Retire is a different
  // act — out of the pickers, still on the ranch — and lives at POST …/retire.
  const t = await trashRow(s.supabase, s.user.id, 'herd_lots', id)
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status })
  return NextResponse.json({ deleted: true, trashed: true })
}
