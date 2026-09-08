import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ACTIVITY_COLS, type ActivityRow } from './activity'
import { buildManualPayload, isManualEventType, parseEventTs, ValidationError, type ManualEventType } from './manual-log'
import { consequenceFor, type Consequence } from './log-consequence'

// ─── Corrections after the undo window (Block 5B, migration 054) ─────────────
// events is append-only. A correction is a NEW row that supersedes the row it
// corrects; a void is a superseding row with voided_at set that counts for
// nothing. The database (054) refuses a second correction of the same row, a
// cross-ranch or cross-type correction, and correcting a void; this module
// holds the same rules in words the phone can show, and turns the database's
// refusals into the right status.
//
// Work time vs recording time: a correction's ts is the corrected WORK time
// (the original's unless the corrector changed it); its ingested_at is now.
// So it is news now (the cursor compares ingested_at) and it belongs to the
// work day in the record and in every balance.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REASON_MAX = 500

export type CorrectionResult =
  | { ok: true; status: 200 | 201; event: ActivityRow; duplicate?: true; consequence: Consequence }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string }

interface OriginalRow extends ActivityRow { ranch_id: string | null }

async function loadHead(supabase: SupabaseClient, id: string): Promise<{ row: OriginalRow } | { error: CorrectionResult }> {
  const { data } = await supabase.from('events').select(`${ACTIVITY_COLS}, ranch_id`).eq('id', id).maybeSingle()
  const row = data as OriginalRow | null
  if (!row) return { error: { ok: false, status: 404, error: 'No such entry on your ranch' } }
  if (!isManualEventType(row.type)) return { error: { ok: false, status: 400, error: 'Only entries logged by hand can be corrected' } }
  if (row.voided_at) return { error: { ok: false, status: 409, error: 'This entry was voided; there is nothing to correct' } }
  if (row.superseded_by) return { error: { ok: false, status: 409, error: 'This entry was already corrected — correct the current entry instead', } }
  return { row }
}

function reasonOf(v: unknown): string | null {
  if (v == null) return null
  if (typeof v !== 'string') throw new ValidationError('reason must be text')
  const r = v.trim()
  if (!r) return null
  if (r.length > REASON_MAX) throw new ValidationError(`reason must be ${REASON_MAX} characters or fewer`)
  return r
}

function idOf(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'string' && UUID_RE.test(v)) return v.toLowerCase()
  throw new ValidationError('id must be a uuid')
}

async function placeNameOf(supabase: SupabaseClient, placeId: unknown): Promise<string | null> {
  if (typeof placeId !== 'string' || !placeId) return null
  const { data } = await supabase.from('places').select('name').eq('id', placeId).maybeSingle()
  return (data as { name?: string } | null)?.name ?? null
}

// Maps the database's refusals (054's triggers, index, and checks) to a status.
// A 23505 can be the primary key (the same client id arrived twice) OR the
// trigger's "already corrected" (which fires BEFORE the key is checked, so a
// retry of a landed correction also reads as 23505 from the trigger); the
// caller settles which by looking for the client id.
function dbRefusal(code: string | undefined, message: string): CorrectionResult {
  if (code === '23505') return { ok: false, status: 409, error: 'This entry was already corrected — correct the current entry instead' }
  if (code === '23514' || code === '23503') return { ok: false, status: 409, error: message.replace(/^events_supersede: /, '') }
  return { ok: false, status: 500, error: message }
}

async function insertSuperseding(
  supabase: SupabaseClient,
  userId: string,
  original: OriginalRow,
  fields: { id: string | null; ts: string; payload: Record<string, unknown>; reason: string | null; voided: boolean },
): Promise<CorrectionResult> {
  const { data, error } = await supabase
    .from('events')
    .insert({
      ...(fields.id ? { id: fields.id } : {}),
      user_id: userId,
      ranch_id: original.ranch_id,
      device_id: null,
      type: original.type,
      ts: fields.ts,
      lat: null,
      lng: null,
      payload: fields.payload,
      schema_version: (fields.payload.schema_version as number | undefined) ?? 1,
      dedup_key: null,
      supersedes_event_id: original.id,
      correction_reason: fields.reason,
      ...(fields.voided ? { voided_at: new Date().toISOString() } : {}),
    })
    .select(ACTIVITY_COLS)
    .single()
  const answer = async (): Promise<Consequence> => {
    const c = await consequenceFor(supabase, original.type as ManualEventType, fields.payload, await placeNameOf(supabase, fields.payload.place_id))
    // The first line of a plain answer restates the number recorded; a void
    // reverses one, so its first line says so and the balance lines follow.
    return fields.voided ? { lines: ['Entry voided — it no longer counts', ...c.lines.slice(1)] } : { lines: ['Entry corrected', ...c.lines] }
  }
  if (error) {
    if (error.code === '23505' && fields.id) {
      // The same client id arrived twice (a retry after a landed write): answer with the row that exists.
      const { data: existing } = await supabase.from('events').select(ACTIVITY_COLS).eq('id', fields.id).maybeSingle()
      if (existing) return { ok: true, status: 200, event: existing as ActivityRow, duplicate: true, consequence: await answer() }
    }
    return dbRefusal(error.code, error.message)
  }
  return { ok: true, status: 201, event: data as ActivityRow, consequence: await answer() }
}

// Correct: the body carries only what changed (bales, inches, ts, place_id,
// herd_lot_id, …) plus `reason`; everything else is the original's. The
// merged answer is validated exactly like a fresh entry.
// A retry of a correction that already landed (same client id) is answered
// with the row that exists — BEFORE the head check, which would otherwise
// read the now-superseded original as "already corrected" and refuse the retry.
async function alreadyLanded(supabase: SupabaseClient, original: string, body: Record<string, unknown>): Promise<CorrectionResult | null> {
  const clientId = idOf(body.id)
  if (!clientId) return null
  const { data } = await supabase.from('events').select(ACTIVITY_COLS).eq('id', clientId).maybeSingle()
  const row = data as ActivityRow | null
  if (!row) return null
  if (row.supersedes_event_id !== original) return { ok: false, status: 409, error: 'That id already names a different entry' }
  const c = await consequenceFor(supabase, row.type as ManualEventType, row.payload, await placeNameOf(supabase, row.payload.place_id))
  return { ok: true, status: 200, event: row, duplicate: true, consequence: row.voided_at ? { lines: ['Entry voided — it no longer counts', ...c.lines.slice(1)] } : { lines: ['Entry corrected', ...c.lines] } }
}

export async function correctEvent(supabase: SupabaseClient, userId: string, id: string, body: Record<string, unknown>): Promise<CorrectionResult> {
  try {
    const landed = await alreadyLanded(supabase, id, body)
    if (landed) return landed
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, status: 400, error: err.message }
    throw err
  }
  const head = await loadHead(supabase, id)
  if ('error' in head) return head.error
  const original = head.row
  try {
    // The body is a PATCH (6A): a key present is set — null clears it, on
    // purpose, from the form's explicit Clear — and a key absent keeps the
    // original's value, note and stock source included. No client may clear a
    // field by leaving it out, and undefined is treated as absent.
    const merged: Record<string, unknown> = { ...original.payload }
    for (const [k, v] of Object.entries(body)) {
      if (k === 'id' || k === 'reason' || k === 'ts' || v === undefined) continue
      merged[k] = v
    }
    const payload = buildManualPayload(original.type as ManualEventType, merged) as unknown as Record<string, unknown>
    const ts = body.ts == null || body.ts === '' ? original.ts : parseEventTs(body.ts)
    const reason = reasonOf(body.reason)
    const clientId = idOf(body.id)
    const same = ts === original.ts && JSON.stringify(payload) === JSON.stringify(original.payload)
    if (same) return { ok: false, status: 400, error: 'Nothing changed — change a value or the time, or void the entry instead' }
    return insertSuperseding(supabase, userId, original, { id: clientId, ts, payload, reason, voided: false })
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, status: 400, error: err.message }
    throw err
  }
}

// Void: a reversal row with the original's values and work time, voided_at
// set. Both stay readable; the balance drops the pair.
export async function voidEvent(supabase: SupabaseClient, userId: string, id: string, body: Record<string, unknown>): Promise<CorrectionResult> {
  try {
    const landed = await alreadyLanded(supabase, id, body)
    if (landed) return landed
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, status: 400, error: err.message }
    throw err
  }
  const head = await loadHead(supabase, id)
  if ('error' in head) return head.error
  const original = head.row
  try {
    const reason = reasonOf(body.reason)
    const clientId = idOf(body.id)
    return insertSuperseding(supabase, userId, original, { id: clientId, ts: original.ts, payload: original.payload, reason, voided: true })
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, status: 400, error: err.message }
    throw err
  }
}
