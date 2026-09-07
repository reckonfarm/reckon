import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { getRanchLots, createLot } from '@/lib/herd-lots'

// ─── /api/herd/lots (Block 4B) — the ranch's lots, one row each ───────────────
//   GET  → { lots: Lot[] }        live lots, oldest first (any member)
//   POST { class, head_count, avg_weight, weight_unit, frame?, weaned?, sale_windows?, name? } → { lot }
// Every read and write is on the USER-SCOPED client; the membership policy on
// herd_lots is the gate. The blob on operation_profiles is no longer written.
export async function GET(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  return NextResponse.json({ lots: await getRanchLots(s.supabase, s.user.id) })
}

export async function POST(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const r = await createLot(s.supabase, body)
  return r.ok ? NextResponse.json({ lot: r.lot }, { status: 201 }) : NextResponse.json({ error: r.error }, { status: r.status })
}
