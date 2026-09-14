import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { retireLot } from '@/lib/herd-lots'

// POST /api/herd/lots/[id]/retire → { lot }
//
// Block 12 (12.4): Archive and Delete became two different acts, and got two
// different doors. Retire = out of the pickers and the estimate, still on the
// ranch, name still resolving for every feeding it ever had; one tap brings it
// back. Delete = the trash, seven days, then gone. DELETE on the lot route used
// to retire; it trashes now, and the first run after that change showed the
// Archive button trashing lots — and every past feeding losing its lot's name.
// This route is where Archive goes.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { id } = await ctx.params
  const r = await retireLot(s.supabase, id)
  return r.ok ? NextResponse.json({ lot: r.lot }) : NextResponse.json({ error: r.error }, { status: r.status })
}
