import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase'
import { getRanch, resolveRanchId, RANCH_NAME_MAX } from '@/lib/ranch-membership'

// The signed-in person's outfit (flow, commit 2).
//   GET  /api/ranch            → { ranch: { id, name } | null }
//   PATCH /api/ranch { name }  → { ranch }   (name: 1–60 chars, trimmed)
//
// Read: the user-scoped client — the "member ranches readable" policy (034) is
// the scope. Write: ranches has NO update policy in 034 (the ranch legs were
// read-only by design), so the rename goes through the service role AFTER
// membership is proven on the user-scoped client — the same shape
// /api/home-county uses for profiles. A member can rename only the ranch
// they belong to; nobody else can reach this row.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const ranch = await getRanch(supabase, user.id)
  return NextResponse.json({ ranch })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, RANCH_NAME_MAX) : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const ranchId = await resolveRanchId(supabase, user.id)
  if (!ranchId) return NextResponse.json({ error: 'You are not a member of a ranch yet' }, { status: 404 })

  const { data, error } = await createServiceClient()
    .from('ranches')
    .update({ name })
    .eq('id', ranchId)
    .select('id, name')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not save' }, { status: 500 })
  return NextResponse.json({ ranch: data })
}
