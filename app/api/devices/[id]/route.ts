import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { trashRow, liveOnly } from '@/lib/trash'

// ─── /api/devices/[id] ────────────────────────────────────────────────────────
//
//   PATCH  { name?, place_id? }  → { device }       Block 13: what a person can fix
//   DELETE                       → { deleted }      to the trash, always (Block 13)
//
//   401 not signed in · 404 not on your ranch
//
// WHAT A PERSON CAN FIX ON A DEVICE, and what they cannot. The device itself
// writes last_seen, battery_pct and fw_version on every report (app/api/ingest)
// and hardware_id and type are what it IS. None of those are editable here and
// the form says so instead of showing a box. The NAME is set once when the
// device is registered and never written by the device again, so it is a
// person's to change; WHERE IT SITS (place_id) has only ever been a person's.
//
// PATCH runs on the caller's client: 043's "member devices updatable" is the
// gate, so a device on another ranch matches zero rows and 404s. place_id, when
// given, must be a live place this person can see — the same visibility rule
// a place's parent gets.
//
// DELETE used to refuse when observations pointed at the device (7D.3) and
// offer a cascade that deleted them (8B.2). Block 13: it goes to the trash and
// nothing else happens. Observations keep their device_id and name the device
// as gone; Undo or /account/trash puts it back with everything still attached.
export const dynamic = 'force-dynamic'

const SELECT = 'id, name, type, hardware_id, place_id, battery_pct, last_seen, fw_version'
const MAX_NAME = 60

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { supabase } = session

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : ''
    if (!name) return NextResponse.json({ error: 'A device needs a name.' }, { status: 400 })
    patch.name = name
  }
  if ('place_id' in body) {
    if (body.place_id === null) patch.place_id = null
    else if (typeof body.place_id !== 'string' || !body.place_id) return NextResponse.json({ error: 'place_id must be an id or null' }, { status: 400 })
    else {
      const { data: p } = await liveOnly(supabase.from('places').select('id, retired_at').eq('id', body.place_id)).maybeSingle()
      const row = p as { id: string; retired_at: string | null } | null
      if (!row || row.retired_at) return NextResponse.json({ error: 'No such place to put it at.' }, { status: 400 })
      patch.place_id = row.id
    }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

  const { data, error } = await liveOnly(supabase.from('devices').update(patch).eq('id', id)).select(SELECT).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'No such device' }, { status: 404 })
  return NextResponse.json({ device: data })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { supabase } = session

  const { data: device } = await supabase.from('devices').select(SELECT).eq('id', id).maybeSingle()
  if (!device) return NextResponse.json({ error: 'No such device' }, { status: 404 })

  const t = await trashRow(supabase, session.user.id, 'devices', id)
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status })
  return NextResponse.json({ deleted: true, trashed: true, device })
}
