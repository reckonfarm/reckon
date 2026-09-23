import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'

// ─── POST /api/places/[id]/name — the name, on the spot (Block 37) ───────────
// The name on a place's page is the control: this is what its keyboard saves,
// through the outbox, so it never blocks on signal. The same write PATCH
// /api/places/[id] makes for `name`, on the user-scoped client: "member places
// updatable" (043) is the authorization, so a place on another ranch matches
// nothing and 404s. A replayed rename writes the same name and answers 200.
//   body { id?: uuid (the outbox's), name } → { place }
const MAX_NAME = 80

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : ''
  if (!name) return NextResponse.json({ error: 'A place needs a name.' }, { status: 400 })
  const { data, error } = await s.supabase
    .from('places')
    .update({ name, updated_by: s.user.id })
    .eq('id', id)
    .is('retired_at', null)
    .select('id, name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const place = (data ?? [])[0]
  if (!place) return NextResponse.json({ error: 'That place is not on your ranch.' }, { status: 404 })
  return NextResponse.json({ place }, { status: 200 })
}
