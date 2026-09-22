import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { setHomeCountyFips } from '@/lib/concierge-service'

// ─── Block 31: POST /api/setup { name, county_fips? } ────────────────────────
// The database decides; this relays. create_ranch (075) runs on the caller's
// OWN client — SECURITY DEFINER is the privilege, not the service key — and
// answers ok or a refusal in the ranch's words. The county is also written to
// the person's profile, which is what Today reads for its home county.
export const dynamic = 'force-dynamic'
const STATUS: Record<string, number> = { not_authenticated: 401, already_on_a_ranch: 409, bad_name: 400, bad_county: 400 }
export async function POST(req: NextRequest) {
  const s = await sessionUser(req)
  if (!s) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { name?: unknown; county_fips?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name : ''
  const fips = typeof body?.county_fips === 'string' && body.county_fips ? body.county_fips : null
  const { data, error } = await s.supabase.rpc('create_ranch', { p_name: name, p_county_fips: fips })
  if (error) {
    // 42883 = the function is not there: 075 has not been run on this database.
    if (error.code === '42883') return NextResponse.json({ error: 'Setting up a ranch needs a database update first. Try again later.' }, { status: 503 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const r = data as { ok: boolean; reason?: string; message?: string; ranch_id?: string }
  if (!r?.ok) return NextResponse.json({ error: r?.message ?? 'Could not set up the ranch.', code: r?.reason }, { status: STATUS[r?.reason ?? ''] ?? 400 })
  if (fips) await setHomeCountyFips(s.user.id, s.user.email ?? '', fips).catch(() => { /* the ranch has it; the profile is a convenience */ })
  return NextResponse.json({ ok: true, ranch_id: r.ranch_id }, { status: 201 })
}
