import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { isTrashTable, listTrash, restoreRow, TRASH_DAYS } from '@/lib/trash'

// GET  /api/trash                    → { items, days }
// POST /api/trash { table, id }      → { restored: true }
//
// Block 12 (12.4). The trash is listed and emptied-from here and nowhere
// else; nothing in the app links to it except Account, because PK never sees
// it unless he goes looking. On sessionUser, so the isolation suite can prove
// a member cannot restore another ranch's row.

export async function GET(req: NextRequest) {
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  return NextResponse.json({ items: await listTrash(session.supabase), days: TRASH_DAYS })
}

export async function POST(req: NextRequest) {
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => null) as { table?: unknown; id?: unknown } | null
  if (!body || !isTrashTable(body.table) || typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) {
    return NextResponse.json({ error: 'Say which row: { table, id }.' }, { status: 400 })
  }
  const r = await restoreRow(session.supabase, session.user.id, body.table, body.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ restored: true })
}
