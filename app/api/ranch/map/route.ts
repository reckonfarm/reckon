import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { getRanchMap } from '@/lib/ranch-map'

// ─── Block 20: the ranch map, for the record sheet ───────────────────────────
// The same read Today's map makes, as JSON, so the sheet (a client, in the
// root layout) can draw the ranch. Reads existing columns only; writes nothing.
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const map = await getRanchMap(s.supabase, s.user.id).catch(() => null)
  return NextResponse.json({ map })
}
