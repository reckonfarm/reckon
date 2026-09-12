import { sessionUser } from '@/lib/auth-user'
import { resolveRanchId } from '@/lib/ranch-membership'
import { buildManualPayload, isManualEventType, parseEventTs, ValidationError, MANUAL_EVENT_TYPES } from '@/lib/manual-log'
import { consequenceFor } from '@/lib/log-consequence'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// POST /api/log — the operator logs something by hand.
//   { id?: uuid (client-minted, Block 2A), type: 'rain' | 'hay_fed' | 'bales_stacked' | 'cattle_moved' | 'cattle_worked',
//     ts?: ISO string (default now), place_id?: uuid | null, ...type fields }
//
// IDEMPOTENT ON id: the phone mints the event id before its first attempt and
// every retry resends it. A second arrival of the same id (a retry after a
// timed-out-but-landed write, a double-tap, a force-quit mid-save) is answered
// 200 { event, duplicate: true } with the row that already exists — never a
// second row. Without an id the server mints one (legacy callers).
// AUTH (Block 7E): sessionUser(req), like every other ledger-writing route.
// It was the cookie-only createClient(), which the browser is happy with and
// the isolation suite cannot reach — so the one route that writes EVERY manual
// entry in the app was the one route 147 isolation checks could not see, and
// its cross-ranch behaviour was asserted nowhere. sessionUser tries cookies
// FIRST and Bearer second, so the browser path is byte-for-byte what it was;
// nothing about the outbox changes. Inserts ONE events row through the
// user-scoped client either way, so the 034 INSERT policy is exercised, not
// bypassed (same doctrine as the annotation route). device_id null, dedup_key null, lat/lng null — a manual entry has
// no emitter, no natural key, no fix. ranch_id comes from the person's own
// ranch_members row.
//
// A RANCHLESS PERSON CANNOT RECORD, and this route now says so instead of
// failing. The comment here used to claim "null if none: the row still lands,
// owner-visible". That was true under 034, whose INSERT policy was
// `user_id = auth.uid()`. 043 made membership the SOLE gate — the check is
// `ranch_id in (select … from ranch_members …)`, and a NULL ranch_id makes
// that NULL, which is not TRUE, so the insert is refused. The read policy has
// the same shape, so even a landed row would have been invisible to its own
// writer: "owner-visible" was false twice over.
//
// Nothing tested it, so the claim outlived its truth by nine migrations and
// surfaced as a 500 the first time 7E's isolation checks asked. Returns the
// row on success.
export async function POST(req: NextRequest) {
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { supabase, user } = session

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!isManualEventType(body.type)) {
    return NextResponse.json(
      { error: `type must be one of ${MANUAL_EVENT_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  let ts: string
  let payload
  try {
    ts = parseEventTs(body.ts)
    payload = buildManualPayload(body.type, body)
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    throw err
  }

  const ranch_id = await resolveRanchId(supabase, user.id)
  // Answered here, not by the database. Without this the person gets a 500
  // carrying a row-level-security message, which tells them nothing they can
  // act on and leaks the policy's shape to anyone who asks.
  if (!ranch_id) {
    return NextResponse.json({
      error: 'You are not on a ranch yet, so there is nowhere to record this. Accept your invitation, or set up your ranch first.',
      code: 'no_ranch',
    }, { status: 409 })
  }

  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id.toLowerCase() : null
  if (body.id != null && !id) return NextResponse.json({ error: 'id must be a uuid' }, { status: 400 })

  const { data: row, error } = await supabase
    .from('events')
    .insert({
      ...(id ? { id } : {}),
      user_id: user.id,
      ranch_id,
      device_id: null,
      type: body.type,
      ts,
      lat: null,
      lng: null,
      payload,
      schema_version: payload.schema_version,
      dedup_key: null,
    })
    .select(EVENT_COLS)
    .single()
  // The answer (Block 2C): what this entry means, read on the same client.
  const answer = async () => {
    let placeName: string | null = null
    if (payload.place_id) {
      const { data: place } = await supabase.from('places').select('name').eq('id', payload.place_id).maybeSingle()
      placeName = (place as { name?: string } | null)?.name ?? null
    }
    return consequenceFor(supabase, body.type, payload as unknown as Record<string, unknown>, placeName)
  }

  if (error) {
    // 23505 on the primary key = this exact entry already landed. Return it.
    if (error.code === '23505' && id) {
      const { data: existing } = await supabase.from('events').select(EVENT_COLS).eq('id', id).maybeSingle()
      if (existing) return NextResponse.json({ event: existing, duplicate: true, consequence: await answer() }, { status: 200 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ event: row, consequence: await answer() }, { status: 201 })
}

const EVENT_COLS = 'id, user_id, ranch_id, device_id, type, ts, payload, schema_version, ingested_at'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
