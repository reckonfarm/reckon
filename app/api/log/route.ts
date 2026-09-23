import { sessionUser } from '@/lib/auth-user'
import { resolveRanchId } from '@/lib/ranch-membership'
import { setLotHeadFromCount } from '@/lib/herd-lots'
import { buildManualPayload, isManualEventType, parseCreatedAt, parseEventTs, ValidationError, MANUAL_EVENT_TYPES } from '@/lib/manual-log'
import { consequenceFor } from '@/lib/log-consequence'
import { MOVE_NEEDS_BUNCH } from '@/lib/move-line'
import { GROUP_ACTION_TYPE, GroupActionError, groupActionConsequence, parseGroupAction, recordGroupAction } from '@/lib/cattle/group-action'
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
  // Block 10: a group action is not an insert — it is one transaction that
  // also moves head counts, so it goes through the 063 function. It rides this
  // route and not its own because the outbox posts HERE and nowhere else:
  // offline saving, the client-minted id, the retry ladder and the save-status
  // strip all come free, and rebuilding any of them for the chute would be the
  // worst trade available three days out.
  if (body.type === GROUP_ACTION_TYPE) {
    try {
      const input = parseGroupAction(body as Record<string, unknown>)
      const done = await recordGroupAction(supabase, input)
      // Block 27: the working — and the placement a split writes beside it —
      // are made when the phone made them. record_group_action stamps arrival;
      // one update after it, on the caller's client, says the phone's moment.
      if (!done.duplicate && input.createdAt) {
        await supabase.from('events').update({ created_at: input.createdAt }).or(`id.eq.${done.eventId},payload->>origin_event_id.eq.${done.eventId}`)
      }
      const { data: event } = await supabase.from('events').select(EVENT_COLS).eq('id', done.eventId).maybeSingle()
      return NextResponse.json(
        { event, ...(done.duplicate ? { duplicate: true } : {}), consequence: groupActionConsequence(done.payload) },
        { status: done.duplicate ? 200 : 201 },
      )
    } catch (err) {
      if (err instanceof GroupActionError) return NextResponse.json({ error: err.message }, { status: err.status })
      return NextResponse.json({ error: 'That working could not be recorded just now.' }, { status: 500 })
    }
  }

  if (!isManualEventType(body.type)) {
    return NextResponse.json(
      { error: `type must be one of ${MANUAL_EVENT_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  let ts: string, createdAt: string
  let payload
  try {
    createdAt = parseCreatedAt(body.created_at)
    ts = parseEventTs(body.ts, createdAt)
    payload = buildManualPayload(body.type, body)
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    throw err
  }

  // Block 14: a count's EXPECTED is what the bunch says right now, read here —
  // never trusted from the phone, which may have opened the sheet an hour ago.
  // The bunch must be this ranch's (RLS: another ranch's is not found). The
  // count moves nothing; "Change bunch to N?" is a separate act the answer offers.
  let countFollowUp: { kind: 'set_head'; lot_id: string; head: number; label: string } | null = null
  let setHeadDone: { before: number | null; head: number; name: string } | null = null
  if (body.type === 'cattle_counted') {
    const lotId = (payload as { herd_lot_id: string }).herd_lot_id
    const { data: lotRow } = await supabase.from('herd_lots').select('id, head_count, name, class, retired_at, deleted_at').eq('id', lotId).maybeSingle()
    const lot = lotRow as { id: string; head_count: number; name: string | null; class: string; retired_at: string | null; deleted_at: string | null } | null
    if (!lot || lot.retired_at || lot.deleted_at) return NextResponse.json({ error: 'That bunch is not on your ranch.' }, { status: 400 })
    payload = { ...payload, expected: lot.head_count } as typeof payload
    const counted = (payload as { counted: number }).counted
    // Block 22 (ruling 6): the count carries its own meaning when it was taken
    // at a gate — the person already chose, on the screen, that the gate beats
    // the record. Then the bunch is set HERE, in the same request, and the
    // answer does not ask a question that has been answered. Everything else
    // is unchanged: a count with no such decision still moves nothing and
    // still offers "Change bunch to N?".
    if ((payload as { set_head?: boolean }).set_head === true) {
      const set = await setLotHeadFromCount(supabase, lot.id, counted)
      if (!set.ok) return NextResponse.json({ error: set.error }, { status: 400 })
      setHeadDone = set.changed ? { before: set.before, head: counted, name: lot.name ?? lot.class } : null
    } else if (counted !== lot.head_count) {
      countFollowUp = { kind: 'set_head', lot_id: lot.id, head: counted, label: `Change bunch to ${counted.toLocaleString()}?` }
    }
  }

  // Block 25: a move names its bunch — one bunch, this ranch's, still on it.
  // Same read a count makes, and the same words when the bunch is not there.
  // Block 30: a sighting the same.
  if (body.type === 'cattle_moved' || body.type === 'bunch_seen') {
    const lotId = (payload as { herd_lot_id: string | null }).herd_lot_id
    if (!lotId) return NextResponse.json({ error: body.type === 'bunch_seen' ? 'Pick the bunch you saw.' : MOVE_NEEDS_BUNCH }, { status: 400 })
    const { data: lotRow } = await supabase.from('herd_lots').select('id, retired_at, deleted_at').eq('id', lotId).maybeSingle()
    const lot = lotRow as { id: string; retired_at: string | null; deleted_at: string | null } | null
    if (!lot || lot.retired_at || lot.deleted_at) return NextResponse.json({ error: 'That bunch is not on your ranch.' }, { status: 400 })
  }
  // Block 42 (ruling 1): a count INTO a pasture is one record — the move carries
  // the count as its head, and set_head makes the bunch read that count in the
  // same act, through the outbox. The same door 22's count uses (setLotHeadFromCount).
  if (body.type === 'cattle_moved' && (body as { set_head?: unknown }).set_head === true) {
    const lotId = typeof body.herd_lot_id === 'string' ? body.herd_lot_id : null
    const head = typeof body.head === 'number' ? body.head : null
    if (lotId && head != null) {
      const set = await setLotHeadFromCount(supabase, lotId, head)
      if (!set.ok) return NextResponse.json({ error: set.error }, { status: 400 })
      ;(payload as Record<string, unknown>).set_head = true
      if (set.changed) (payload as Record<string, unknown>).head_before = set.before
    }
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
      created_at: createdAt,   // Block 27: made on the phone
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

  // Block 25b: the bunch's place is the DATABASE's (072) — a trigger rebuilds it
  // from the bunch's live moves in the same transaction as this insert. The
  // route writes the move and nothing else.
  if (error) {
    // 23505 on the primary key = this exact entry already landed. Return it.
    if (error.code === '23505' && id) {
      const { data: existing } = await supabase.from('events').select(EVENT_COLS).eq('id', id).maybeSingle()
      if (existing) return NextResponse.json({ event: existing, duplicate: true, consequence: await answer(), ...(countFollowUp ? { follow_up: countFollowUp } : {}) }, { status: 200 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ event: row, consequence: await answer(), ...(countFollowUp ? { follow_up: countFollowUp } : {}) }, { status: 201 })
}

const EVENT_COLS = 'id, user_id, ranch_id, device_id, type, ts, created_at, payload, schema_version, ingested_at'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
