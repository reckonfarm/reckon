import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { filterOptions } from '@/lib/activity'

// ─── GET /api/activity/options (Block 5A) ─────────────────────────────────────
//   → { people, places, lots } the caller's ranch can filter the record by.
//   The ranch is resolved from the caller's OWN membership row (user-scoped
//   read); the member list behind `people` is then read with the service role
//   and filtered to that one ranch. A caller with no ranch gets empty lists.
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  return NextResponse.json(await filterOptions(s.supabase, s.user.id))
}
