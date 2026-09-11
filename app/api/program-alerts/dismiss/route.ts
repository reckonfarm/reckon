import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { resolveRanchId } from '@/lib/ranch-membership'

// POST /api/program-alerts/dismiss { alert_key } → { ok: true }
//
// One person marking one SPECIFIC change as seen (Block 7.9). The key encodes
// what changed and when, so this can never silence a later, different change.
//
// TOLERANT OF A MISSING TABLE. Migration 059 may not have been run yet. A
// failure here answers ok:false with `stored: false` rather than an error the
// UI has to explain: the alert stays on screen, which is the honest outcome —
// nothing was recorded, so nothing should look recorded.
export async function POST(req: NextRequest) {
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const key = typeof body?.alert_key === 'string' ? body.alert_key.trim().slice(0, 200) : ''
  if (!key) return NextResponse.json({ error: 'alert_key is required' }, { status: 400 })

  const ranchId = await resolveRanchId(session.supabase, session.user.id)
  if (!ranchId) return NextResponse.json({ error: 'You are not on a ranch yet' }, { status: 404 })

  const { error } = await session.supabase
    .from('program_alert_dismissals')
    .upsert({ user_id: session.user.id, ranch_id: ranchId, alert_key: key }, { onConflict: 'user_id,alert_key' })
  if (error) return NextResponse.json({ ok: false, stored: false, reason: error.message }, { status: 200 })
  return NextResponse.json({ ok: true, stored: true })
}
