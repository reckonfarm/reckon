import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { GROUP_ACTIONS, MAX_GROUP_NAME, MAX_HEAD, isGroupAction, type GroupAction } from './kinds'
import { LOT_CLASSES, type LotClass } from '@/lib/herd'

// ─── Group actions — one event, named result groups (Block 10) ────────────────
//
// The transport half of migration 063. The RULES live in the database, not
// here: reconciliation, the compare-and-set on the source count, accepting the
// chute count, defaulting a created destination, and idempotency on the
// client-minted id are all inside `record_group_action`, in one transaction,
// under the caller's own RLS. This module validates early so a person gets a
// plain sentence before a round trip, and translates what the database says
// into a status and a sentence — never a raw error.
//
// PK's rule since 7D: never show him a database error. Every SQLSTATE the
// function raises is mapped below; anything unmapped becomes one honest
// sentence and a 500, and the detail goes nowhere near the screen.

// The vocabulary lives in lib/cattle/kinds.ts so the chute screen (a client
// component) can name these without importing this server-only module.
export { GROUP_ACTIONS, GROUP_ACTION_LABELS, GROUP_ACTION_TYPE, MAX_HEAD, MAX_GROUP_NAME, isGroupAction, type GroupAction } from './kinds'

export interface ResultGroupIn {
  /** An existing lot on this ranch, or null to create one. */
  lot_id?: string | null
  /** Required when lot_id is null. */
  name?: string | null
  /** Block 14: the class of a bunch this creates. Absent = the source's class. */
  class?: LotClass | null
  head: number
}

export interface AppliedGroup {
  lot_id: string
  name: string
  head: number
  created: boolean
  head_before: number
  head_after: number
}

export interface GroupActionPayload {
  source: 'manual'
  schema_version: number
  place_id: string | null
  action: GroupAction
  counted: number
  stayed: number
  moved: number
  source_lot_id: string
  source_name: string
  /** What the lot said before — kept beside `counted` so the difference is on the record. */
  source_head_before: number
  source_head_after: number
  results: AppliedGroup[]
  /** Block 14: a preg check records these on the bunch checked (069 p_detail). */
  bred?: number
  open?: number
}

export class GroupActionError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null)

export interface GroupActionInput {
  eventId: string
  ts: string
  action: GroupAction
  sourceLotId: string
  expectedHead: number | null
  counted: number
  stay: number
  results: ResultGroupIn[]
  placeId: string | null
  /** Block 14: bred and open for a preg check; nothing else carries a detail yet. */
  detail: { bred?: number; open?: number } | null
}

/**
 * Shape and arithmetic, checked before the round trip so the chute gets an
 * instant answer. The database checks all of it again — this is courtesy, not
 * the gate, and the two must never disagree.
 */
export function parseGroupAction(body: Record<string, unknown>): GroupActionInput {
  const bad = (m: string): never => { throw new GroupActionError(400, m) }

  const eventId = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id.toLowerCase() : bad('id must be a uuid')
  if (!isGroupAction(body.action)) bad(`action must be one of ${GROUP_ACTIONS.join(', ')}`)
  const action = body.action as GroupAction
  const sourceLotId = typeof body.source_lot_id === 'string' && UUID_RE.test(body.source_lot_id)
    ? body.source_lot_id : bad('source_lot_id must be a uuid')

  // Block 19: a SPLIT brings neither. 071 reads the count off the bunch and
  // works out what stays, and ignores both of these — so the route must not
  // demand numbers the caller has no business computing. Every other working
  // still brings them.
  const isSplit = action === 'split'
  const counted = int(body.counted) ?? (isSplit ? 0 : null)
  if (counted === null || counted < 0 || counted > MAX_HEAD) bad(`counted must be a whole number 0–${MAX_HEAD}`)
  const stay = int(body.stay) ?? (isSplit ? 0 : null)
  if (stay === null || stay < 0) bad('the number that stay must be a whole number, 0 or more')
  if (isSplit && !Array.isArray(body.results)) bad('a split needs the bunch that leaves')

  if (!Array.isArray(body.results)) bad('results must be a list')
  const rawResults = body.results as unknown[]
  if (rawResults.length > 20) bad('that is more groups than one working can produce')

  const results: ResultGroupIn[] = rawResults.map((r, i) => {
    const o = (typeof r === 'object' && r ? r : {}) as Record<string, unknown>
    const head = int(o.head)
    if (head === null || head <= 0) bad(`group ${i + 1} needs a head count of 1 or more`)
    const lot_id = o.lot_id == null || o.lot_id === '' ? null
      : typeof o.lot_id === 'string' && UUID_RE.test(o.lot_id) ? o.lot_id : bad(`group ${i + 1} has a bad lot id`)
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, MAX_GROUP_NAME) : ''
    if (!lot_id && !name) bad(`group ${i + 1} is new, so it needs a name`)
    const klass = o.class == null || o.class === '' ? null
      : typeof o.class === 'string' && (LOT_CLASSES as readonly string[]).includes(o.class) ? o.class as LotClass : bad(`group ${i + 1} names a class of cattle this app does not know`)
    return { lot_id, name: name || null, class: klass, head: head as number }
  })

  // Block 15 (ruling 3): a preg check may carry its opens as a bunch again —
  // one record, one Undo. Migration 070 lifts the rule in the database; the
  // route no longer refuses ahead of it, so what the ranch answers is the
  // answer (a database still on 069 refuses with its own sentence).

  let detail: GroupActionInput['detail'] = null
  if (body.detail && typeof body.detail === 'object') {
    const d = body.detail as Record<string, unknown>
    const bred = d.bred == null ? undefined : int(d.bred)
    const open = d.open == null ? undefined : int(d.open)
    if (bred === null || (bred !== undefined && bred < 0)) bad('bred must be a whole number, 0 or more')
    if (open === null || (open !== undefined && open < 0)) bad('open must be a whole number, 0 or more')
    if (bred != null && open != null && bred + open !== counted) bad(`${bred} bred and ${open} open do not add up to the ${counted} counted`)
    detail = { ...(bred != null ? { bred } : {}), ...(open != null ? { open } : {}) }
  }

  // The reconciliation is the database's (070): a preg check with bred and
  // open given keeps the bred and lets the opens move or simply leave the
  // count; everything else is stayed + moved = counted. It is NOT repeated
  // here — a copy of a rule in the route is how 070 changed nothing for a day.
  // The ranch answers, in its own words, and the route relays them.

  const expectedHead = int(body.expected_head)
  const placeId = body.place_id == null || body.place_id === '' ? null
    : typeof body.place_id === 'string' && UUID_RE.test(body.place_id) ? body.place_id : bad('place_id must be a uuid')

  return {
    eventId: eventId as string,
    ts: typeof body.ts === 'string' ? body.ts : new Date().toISOString(),
    action,
    sourceLotId: sourceLotId as string,
    expectedHead,
    counted: counted as number,
    stay: stay as number,
    results,
    placeId,
    detail,
  }
}

// 064: THE FUNCTION RETURNS ITS REFUSALS AS DATA. 063 raised them, and the
// first isolation run showed both raised refusals arriving here as 500s — the
// SQLSTATE did not survive the trip the way the code assumed, so a stale count
// read as "could not be recorded just now" instead of the sentence written for
// it. Nothing now depends on how an exception is translated between Postgres,
// PostgREST and the client: the reason is a string in the body.
const STATUS: Record<string, number> = {
  not_authenticated: 401,
  unknown_action: 400,
  too_many: 400,       // Block 19 (071): more head leaving than the bunch holds
  bad_number: 400,
  mismatch: 400,
  unnamed_group: 400,
  source_not_found: 404,
  dest_not_found: 404,
  stale: 409,
  preg_no_split: 400,   // a database still on 069 (070 not run) answers this
}

export interface GroupActionResult {
  duplicate: boolean
  eventId: string
  payload: GroupActionPayload
}

/**
 * One RPC, one transaction. Everything that could half-happen happens together
 * or not at all — see supabase/migrations/063_group_actions.sql for why that
 * is a function and not three writes from here, and 064 for why the duplicate
 * check comes before everything else in it.
 */
export async function recordGroupAction(supabase: SupabaseClient, input: GroupActionInput): Promise<GroupActionResult> {
  const { data, error } = await supabase.rpc('record_group_action', {
    p_event_id: input.eventId,
    p_ts: input.ts,
    p_action: input.action,
    p_source_lot: input.sourceLotId,
    p_expected_head: input.expectedHead,
    p_counted: input.counted,
    p_stay: input.stay,
    p_results: input.results.map(r => ({ lot_id: r.lot_id, name: r.name, head: r.head, ...(r.class ? { class: r.class } : {}) })),
    p_place_id: input.placeId,
    p_detail: input.detail ?? {},
  })

  if (error) {
    // 42883 = the function is not there yet (063/064 unrun); PGRST202 = it is
    // there without p_detail (069 unrun). Both are "not yet", said as something
    // a person can act on, and both are 503 so the outbox keeps the entry and
    // retries rather than marking it failed — nothing is lost while the
    // migration waits.
    if (error.code === '42883' || error.code === 'PGRST202') {
      throw new GroupActionError(503, 'Recording a working needs a database update on this ranch first. It is saved on this phone and will send when that is done.')
    }
    throw new GroupActionError(500, 'That working could not be recorded just now.')
  }

  const out = (data ?? {}) as {
    ok?: boolean; reason?: string; message?: string
    duplicate?: boolean; event_id?: string; payload?: GroupActionPayload
  }

  if (out.ok === false) {
    const status = STATUS[out.reason ?? ''] ?? 400
    // The function's messages are written for a person at a chute and pass
    // through; a reason with no message of its own never reaches the screen
    // as a bare code.
    throw new GroupActionError(status, out.message || 'That working could not be recorded.')
  }
  if (!out.payload || !out.event_id) throw new GroupActionError(500, 'That working could not be recorded just now.')
  return { duplicate: !!out.duplicate, eventId: out.event_id, payload: out.payload }
}

/**
 * The receipt (2C), built from what the DATABASE did — never from what the
 * client hoped it would. Both counts appear when the chute disagreed with the
 * stored number, because that difference is the whole reason to trust the
 * chute over the estimate.
 */
export function groupActionConsequence(p: GroupActionPayload): { lines: string[] } {
  const head = (n: number) => `${n.toLocaleString()} head`
  // Block 19 (ruling 2): a split is an event, and its receipt says the count
  // the bunch held BEFORE it as well as after — that number stays readable
  // for good, here and in the ledger, rather than being quietly replaced.
  // Block 23 (ruling 3): ONE LINE. "220 → 198, 22 to Fall Cows" and nothing
  // else — it is read at arm's length in a corral, in gloves and sun, by
  // someone whose attention is on cattle. The arithmetic, the class, the
  // place, what the bunch was called before: all of it is one tap away on the
  // record, and none of it belongs on a strip at the bottom of a phone.
  if (p.action === 'split') {
    const went = p.results.map(r => `${r.head.toLocaleString()} to ${r.name}`).join(', ')
    return { lines: [`${p.source_head_before.toLocaleString()} → ${p.source_head_after.toLocaleString()}${went ? `, ${went}` : ''}`] }
  }
  const lines: string[] = [
    `${p.counted.toLocaleString()} counted through${p.source_head_before !== p.counted ? ` · ${p.source_name} said ${p.source_head_before.toLocaleString()}` : ''}`,
  ]
  // Block 14: a preg check's numbers, on the bunch checked.
  if (typeof p.bred === 'number' || typeof p.open === 'number') {
    lines.push(`${(p.bred ?? 0).toLocaleString()} bred · ${(p.open ?? 0).toLocaleString()} open · ${p.source_name} is ${head(p.source_head_after)} now`)
  } else {
    lines.push(`${head(p.stayed)} stay in ${p.source_name}`)
  }
  for (const r of p.results) {
    lines.push(`${head(r.head)} to ${r.name}${r.created ? ' (new)' : ` · now ${r.head_after.toLocaleString()}`}`)
  }
  if (p.source_head_after === 0) lines.push(`${p.source_name} is empty now — it stays on the ranch until you retire it`)
  return { lines }
}
