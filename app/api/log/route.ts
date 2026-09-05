import { createClient } from '@/lib/supabase-server'
import { resolveRanchId } from '@/lib/ranch-membership'
import { buildManualPayload, isManualEventType, parseEventTs, ValidationError, MANUAL_EVENT_TYPES } from '@/lib/manual-log'
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
// Inserts ONE events row through the user-scoped SSR client so the 034
// INSERT policy is exercised, not bypassed (same doctrine as the annotation
// route). device_id null, dedup_key null, lat/lng null — a manual entry has
// no emitter, no natural key, no fix. ranch_id comes from the person's own
// ranch_members row (null if none: the row still lands, owner-visible), so
// this route never repeats the alert-service omission. Returns the row.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

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
  if (error) {
    // 23505 on the primary key = this exact entry already landed. Return it.
    if (error.code === '23505' && id) {
      const { data: existing } = await supabase.from('events').select(EVENT_COLS).eq('id', id).maybeSingle()
      if (existing) return NextResponse.json({ event: existing, duplicate: true }, { status: 200 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ event: row }, { status: 201 })
}

const EVENT_COLS = 'id, user_id, ranch_id, device_id, type, ts, payload, schema_version, ingested_at'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
