import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { resolveRanchId } from '@/lib/ranch-membership'
import { effective } from '@/lib/ledger-effective'
import { getTurnout, isTurnoutDate, TURNOUT_TYPE } from '@/lib/hay/turnout'
import { todayKey } from '@/lib/jobs/format'

// GET  /api/ranch/turnout → { upcoming, last }
// POST /api/ranch/turnout { date: 'YYYY-MM-DD' } → { upcoming }
//
// The one thing about hay planning only the operator can answer. On
// sessionUser, not the cookie-only client, so the isolation suite can reach it
// with a Bearer token — the standing rule since 7E, and the reason a route's
// cross-ranch behaviour can be PROVEN rather than asserted.
//
// The write goes through the caller's own client, so 043's membership policy
// is the gate: a turnout date lands on the ranch he belongs to or it does not
// land. No service role, because nothing here needs to outrank RLS.

const FUTURE_YEARS = 2

export async function GET(req: NextRequest) {
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  return NextResponse.json(await getTurnout(session.supabase))
}

export async function POST(req: NextRequest) {
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null) as { date?: unknown } | null
  const date = body?.date
  if (!isTurnoutDate(date)) {
    return NextResponse.json({ error: 'A turnout date looks like 2027-05-15.' }, { status: 400 })
  }
  const today = todayKey()
  if (date <= today) {
    return NextResponse.json({ error: 'Turnout is a day still ahead — pick one in the future.' }, { status: 400 })
  }
  // A fat-fingered year is the one typo that would quietly make every planning
  // number absurd, so it bounces with a message rather than storing.
  if (Number(date.slice(0, 4)) - Number(today.slice(0, 4)) > FUTURE_YEARS) {
    return NextResponse.json({ error: `That is more than ${FUTURE_YEARS} years out — check the year.` }, { status: 400 })
  }

  const ranchId = await resolveRanchId(session.supabase, session.user.id)
  if (!ranchId) return NextResponse.json({ error: 'No ranch' }, { status: 404 })

  // Changing it supersedes the one it replaces (054), so `effective` keeps
  // returning exactly one live turnout and the history stays legible.
  const { upcoming } = await getTurnout(session.supabase)

  const { data, error } = await session.supabase.from('events').insert({
    user_id: session.user.id,
    ranch_id: ranchId,
    device_id: null,
    type: TURNOUT_TYPE,
    ts: new Date().toISOString(),
    schema_version: 1,
    payload: { source: 'manual', schema_version: 1, date },
    ...(upcoming ? { supersedes_event_id: upcoming.id } : {}),
  }).select('id, ts, payload').single()

  if (error || !data) {
    return NextResponse.json({ error: 'That date could not be saved just now.' }, { status: 500 })
  }
  // Read it back the way every other surface will, so the answer the caller
  // gets is the answer the ledger gives — never the row we hoped we wrote.
  const { data: check } = await effective(session.supabase
    .from('events').select('id').eq('id', data.id)).maybeSingle()
  if (!check) return NextResponse.json({ error: 'That date could not be saved just now.' }, { status: 500 })

  return NextResponse.json({ upcoming: { id: data.id, date, setAt: data.ts } })
}
