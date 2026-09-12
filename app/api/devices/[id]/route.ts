import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { createServiceClient } from '@/lib/supabase'
import { deviceReferences, deviceRefsSentence } from '@/lib/devices/references'

// ─── DELETE /api/devices/[id] (Block 7D.3) ───────────────────────────────────
//
// The first delete surface devices have ever had, and it arrives with 062
// closing the open policy that preceded it.
//
//   nothing points at it  → the row is removed
//   something does        → 409 with a count of what still points at it
//
//   401 not signed in · 404 not on your ranch
//
// Read through the caller's client first: RLS is the membership gate, and a
// device on another ranch must be indistinguishable from one that is gone.
// The delete itself is a service-role write, because 062 revoked the client's
// delete door on purpose — the reference rule lives here, in one testable
// place, not in a policy that cannot count.
export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { supabase } = session

  const { data: device } = await supabase.from('devices').select('id, name, type, hardware_id').eq('id', id).maybeSingle()
  if (!device) return NextResponse.json({ error: 'No such device' }, { status: 404 })

  const refs = await deviceReferences(supabase, id)
  if (refs.total > 0) {
    return NextResponse.json({ error: 'still referenced', device, refs, message: deviceRefsSentence(refs) }, { status: 409 })
  }

  const { error } = await createServiceClient().from('devices').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'That device could not be deleted just now' }, { status: 500 })
  return NextResponse.json({ deleted: true, device })
}
