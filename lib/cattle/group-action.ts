import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { GROUP_ACTIONS, MAX_GROUP_NAME, MAX_HEAD, isGroupAction, type GroupAction } from './kinds'

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

  const counted = int(body.counted)
  if (counted === null || counted < 0 || counted > MAX_HEAD) bad(`counted must be a whole number 0–${MAX_HEAD}`)
  const stay = int(body.stay)
  if (stay === null || stay < 0) bad('the number that stay must be a whole number, 0 or more')

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
    return { lot_id, name: name || null, head: head as number }
  })

  // The reconciliation, said in the words the chute needs. The database says
  // the same thing in the same shape; this one just arrives sooner.
  const moved = results.reduce((n, r) => n + r.head, 0)
  if ((stay as number) + moved !== counted) {
    bad(`${stay} that stayed and ${moved} that moved do not add up to the ${counted} counted`)
  }

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
  }
}

// The function's own SQLSTATEs. Its messages are written for a person at a
// chute — "90 that stayed and 5 that moved do not add up to the 100 counted" —
// so they are passed through. Anything unmapped is not.
const STATUS: Record<string, number> = {
  '28000': 401,   // not authenticated
  '22023': 400,   // a number or a name the working cannot mean
  'P0002': 404,   // no such bunch on this ranch (RLS made it invisible, or it is retired)
  '40001': 409,   // someone else moved the count under this recorder
}

export interface GroupActionResult {
  duplicate: boolean
  eventId: string
  payload: GroupActionPayload
}

/**
 * One RPC, one transaction. Everything that could half-happen happens together
 * or not at all — see supabase/migrations/063_group_actions.sql for why that
 * is a function and not three writes from here.
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
    p_results: input.results.map(r => ({ lot_id: r.lot_id, name: r.name, head: r.head })),
    p_place_id: input.placeId,
  })

  if (error) {
    const status = STATUS[error.code ?? '']
    if (status) throw new GroupActionError(status, error.message)
    // 42883 = the function is not there yet, i.e. 063 has not been run. Say
    // that as something a person can act on, never as a missing-function error.
    if (error.code === '42883') {
      throw new GroupActionError(503, 'Recording a working is not switched on for this ranch yet.')
    }
    throw new GroupActionError(500, 'That working could not be recorded just now.')
  }

  const out = (data ?? {}) as { duplicate?: boolean; event_id?: string; payload?: GroupActionPayload }
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
  const lines: string[] = [
    `${p.counted.toLocaleString()} counted through${p.source_head_before !== p.counted ? ` · ${p.source_name} said ${p.source_head_before.toLocaleString()}` : ''}`,
    `${head(p.stayed)} stay in ${p.source_name}`,
  ]
  for (const r of p.results) {
    lines.push(`${head(r.head)} to ${r.name}${r.created ? ' (new)' : ` · now ${r.head_after.toLocaleString()}`}`)
  }
  if (p.source_head_after === 0) lines.push(`${p.source_name} is empty now — it stays on the ranch until you retire it`)
  return { lines }
}
