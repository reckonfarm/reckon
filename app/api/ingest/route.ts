import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

// ─── POST /api/ingest — the ONE hardware door (S2, the receiving dock) ─────────
//
// Every Dryline device forever reports here: the tank node is the first caller,
// a puck later POSTs the same endpoint with a different `type`, and the courier
// app POSTs Scout batches (see BATCH CONTRACT below). One door, not one door
// per device type — the events table is the only destination.
//
// AUTH — two accepted bearers, checked in order:
//   1. Authorization: Bearer ${INGEST_SECRET} — the original shared-secret
//      (CRON_SECRET pattern), still the path for PK-flashed firmware.
//   2. Authorization: Bearer <device token> — sha256 of the presented token is
//      looked up in devices.token_hash (033). Per-device revocation = null the
//      column. This is the 2026-07-26 revisit trigger, executed 2026-07-29:
//      the courier phone is the first device whose credential must be
//      revocable without re-flashing a fleet.
//
// BODY CONTRACT (locked with firmware — do not drift):
//   {
//     hardware_id:    string   required — must match a registered device
//     type:           string   required — e.g. 'tank_level'
//     ts:             string   optional ISO 8601 — when the reading HAPPENED
//     payload:        object   required — stored VERBATIM (RAW-DATA doctrine;
//                              this route never interprets it)
//     schema_version: number   optional, default 1
//     dedup_key:      string   optional idempotency key
//   }
//
// DEFAULTING RULES for dumb devices:
//   • ts absent/invalid → ts = server now, and payload gains ts_source:'server'
//     so the ledger never passes server time off as device time.
//   • dedup_key absent → derived `${hardware_id}:${ts}` — a transport retry of
//     the SAME reading dedups itself even from a device that never heard of
//     idempotency.
//
// RESPONSES: 201 created · 200 duplicate (retries must see success) ·
// 400 malformed · 401 bad/missing secret · 404 unknown hardware_id (fail LOUD,
// never silently drop — the device keeps retrying and the reading lands once
// the device is registered) · 413 oversized (~32KB cap keeps a chatty firmware
// bug from bloating the ledger).
//
// SIDE EFFECT: devices.last_seen refreshed on every accepted reading;
// battery_pct refreshed when the payload carries a valid one (display cache
// only — the honest battery curve stays in the event payloads).
//
// ─── BATCH CONTRACT (courier sync sweeps, S2 step 2 — locked with the courier
//     repo's PROTOCOL.md; do not drift) ─────────────────────────────────────
// Detected by Array.isArray(body.records). Same door, same table:
//   {
//     hardware_id:       string   required — the Scout being reported FOR
//     type:              string   required — 'bump' (the firmware's own word)
//     courier_device_id: string   required — the phone that hauled the batch;
//                                 must match the token's device when token-authed
//     records: [                  required, 1..64 (one Scout NVS queue max)
//       { seq, unixTime, lat, lon, fixType, sats, peak_mg }   all numbers;
//         lat/lon are RAW 1e-7 degrees — the ledger converts, the courier never does
//     ]
//   }
// Per record: dedup_key = `${hardware_id}:${seq}` — the idempotency guarantee
// rides 031's (user_id, dedup_key) unique index; NO new table, NO new index
// (three tables, forever). payload = the record verbatim + courier_device_id
// provenance (which phone hauled it — the record itself can't know). Typed
// lat/lng = payload ÷ 1e7 ONLY when fixType ≥ 2; a no-fix coordinate inserts
// NULL (honest states — no fake pins), raw values stay in payload regardless.
// unixTime earlier than 2020 → server ts + ts_source:'server' (a Scout that
// never got GPS lock reports t=0; the ledger never passes that off as truth).
// ANY malformed record 400s the WHOLE batch — batches are machine-generated,
// malformed means courier bug, partial acceptance would hide it.
//
// BATCH RESPONSE — acked means DURABLE (inserted now or already present); the
// courier marks records uploaded only on ack, so replays, overlapping batches,
// mid-flight-timeout retries, and two phones on one pass all collapse:
//   201 { ok, acked: [seq…], inserted, duplicates }   inserted > 0
//   200 { ok, acked: [seq…], inserted: 0, duplicates } all already present
//   (4xx/5xx shapes match the single path; on 500 nothing is acked and the
//    courier retries the batch whole — idempotency makes that free.)

const MAX_BODY_BYTES = 32 * 1024
const MAX_BATCH_RECORDS = 64 // one full Scout queue; the courier chunks anything bigger

// GPS epochs before 2020 don't exist for this hardware — t below this means
// "never had a fix", not a reading from the past.
const MIN_CREDIBLE_UNIX_TIME = 1577836800 // 2020-01-01T00:00:00Z

type CourierDevice = { id: string; user_id: string; hardware_id: string; type: string | null }

// Resolve the bearer: the shared secret, or a device token (sha256 → 033's
// devices.token_hash). Returns 'secret' | the matched device row | null.
async function resolveAuth(
  request: NextRequest,
  db: ReturnType<typeof createServiceClient>,
): Promise<'secret' | CourierDevice | null> {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const bearer = auth.slice('Bearer '.length)

  const secret = process.env.INGEST_SECRET
  if (secret && bearer === secret) return 'secret'

  const token_hash = createHash('sha256').update(bearer).digest('hex')
  const { data: device } = await db
    .from('devices')
    .select('id, user_id, hardware_id, type')
    .eq('token_hash', token_hash)
    .maybeSingle()
  return device ?? null
}

export async function POST(request: NextRequest) {
  const db = createServiceClient()

  const authed = await resolveAuth(request, db)
  if (!authed) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: 'Payload too large' }, { status: 413 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'Body must be a JSON object' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  if (Array.isArray(b.records)) {
    return handleBatch(db, authed, b)
  }

  const hardware_id = typeof b.hardware_id === 'string' ? b.hardware_id.trim() : ''
  if (!hardware_id) {
    return Response.json({ error: 'hardware_id (string) is required' }, { status: 400 })
  }
  const type = typeof b.type === 'string' ? b.type.trim() : ''
  if (!type) {
    return Response.json({ error: 'type (string) is required' }, { status: 400 })
  }
  if (!b.payload || typeof b.payload !== 'object' || Array.isArray(b.payload)) {
    return Response.json({ error: 'payload (object) is required' }, { status: 400 })
  }
  const payload = { ...(b.payload as Record<string, unknown>) }

  const schema_version =
    b.schema_version === undefined ? 1
      : Number.isInteger(b.schema_version) && (b.schema_version as number) > 0
        ? (b.schema_version as number)
        : null
  if (schema_version === null) {
    return Response.json({ error: 'schema_version must be a positive integer' }, { status: 400 })
  }

  // ts: device-supplied ISO timestamp, or honest server fallback.
  let ts: string
  const tsRaw = typeof b.ts === 'string' ? Date.parse(b.ts) : NaN
  if (Number.isFinite(tsRaw)) {
    ts = new Date(tsRaw).toISOString()
  } else {
    ts = new Date().toISOString()
    payload.ts_source = 'server'
  }

  const dedup_key =
    typeof b.dedup_key === 'string' && b.dedup_key.trim()
      ? b.dedup_key.trim()
      : `${hardware_id}:${ts}`

  // Map hardware → registered device (supplies user_id, ranch_id + device_id).
  const { data: device, error: deviceErr } = await db
    .from('devices')
    .select('id, user_id, ranch_id')
    .eq('hardware_id', hardware_id)
    .maybeSingle()
  if (deviceErr) {
    return Response.json({ error: deviceErr.message }, { status: 500 })
  }
  if (!device) {
    // Fail LOUD: non-2xx keeps the device retrying, the id lands in the logs,
    // and the reading is never silently dropped. No auto-provisioning — an
    // unknown device has no owner to assign, and auto-create is a spoof door.
    return Response.json({ error: 'unknown hardware_id', hardware_id }, { status: 404 })
  }

  const { data: inserted, error: insertErr } = await db
    .from('events')
    .insert({
      user_id: device.user_id,
      // 034 transition: ranch scope rides the device row exactly like user_id.
      // ranch_id is nullable by design — an unstamped device inserts null,
      // never rejects; NOT NULL enforcement belongs to the tightening pass.
      ranch_id: device.ranch_id,
      device_id: device.id,
      type,
      ts,
      payload,
      schema_version,
      dedup_key,
    })
    .select('id')
    .single()

  if (insertErr) {
    // 23505 = unique violation on (user_id, dedup_key) — this exact reading
    // already landed. Success to the retrying transport, no second row.
    if (insertErr.code === '23505') {
      return Response.json({ ok: true, duplicate: true })
    }
    return Response.json({ error: insertErr.message }, { status: 500 })
  }

  // Display-cache refresh — never blocks the accepted reading; a failure here
  // leaves the ledger correct and only the registry row momentarily stale.
  const registry: Record<string, unknown> = { last_seen: new Date().toISOString() }
  const bp = payload.battery_pct
  if (typeof bp === 'number' && Number.isFinite(bp) && bp >= 0 && bp <= 100) {
    registry.battery_pct = Math.round(bp)
  }
  await db.from('devices').update(registry).eq('id', device.id)

  return Response.json({ ok: true, event_id: inserted.id }, { status: 201 })
}

// ─── The batch path (courier sync sweeps) — see BATCH CONTRACT above ──────────

// A record's numeric fields, all required — the courier always sends the full
// shape; anything missing is a courier bug and fails the batch loud.
const RECORD_FIELDS = ['seq', 'unixTime', 'lat', 'lon', 'fixType', 'sats', 'peak_mg'] as const
type BatchRecord = Record<(typeof RECORD_FIELDS)[number], number>

async function handleBatch(
  db: ReturnType<typeof createServiceClient>,
  authed: 'secret' | CourierDevice,
  b: Record<string, unknown>,
) {
  const hardware_id = typeof b.hardware_id === 'string' ? b.hardware_id.trim() : ''
  if (!hardware_id) {
    return Response.json({ error: 'hardware_id (string) is required' }, { status: 400 })
  }
  const type = typeof b.type === 'string' ? b.type.trim() : ''
  if (!type) {
    return Response.json({ error: 'type (string) is required' }, { status: 400 })
  }
  const courier_device_id =
    typeof b.courier_device_id === 'string' ? b.courier_device_id.trim() : ''
  if (!courier_device_id) {
    return Response.json({ error: 'courier_device_id (string) is required' }, { status: 400 })
  }
  // A device token speaks only for its own device — a leaked courier token
  // must not be able to impersonate another phone's hauls.
  if (authed !== 'secret' && authed.hardware_id !== courier_device_id) {
    return Response.json({ error: 'courier_device_id does not match token' }, { status: 401 })
  }

  const rawRecords = b.records as unknown[]
  if (rawRecords.length === 0 || rawRecords.length > MAX_BATCH_RECORDS) {
    return Response.json(
      { error: `records must contain 1..${MAX_BATCH_RECORDS} items` },
      { status: 400 },
    )
  }

  // Validate every record BEFORE touching the ledger — whole batch or nothing.
  const records: BatchRecord[] = []
  for (let i = 0; i < rawRecords.length; i++) {
    const r = rawRecords[i]
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return Response.json({ error: `records[${i}] must be an object` }, { status: 400 })
    }
    const rec = r as Record<string, unknown>
    for (const field of RECORD_FIELDS) {
      if (typeof rec[field] !== 'number' || !Number.isFinite(rec[field])) {
        return Response.json(
          { error: `records[${i}].${field} (number) is required` },
          { status: 400 },
        )
      }
    }
    if (!Number.isInteger(rec.seq) || (rec.seq as number) < 0) {
      return Response.json(
        { error: `records[${i}].seq must be a non-negative integer` },
        { status: 400 },
      )
    }
    records.push(rec as unknown as BatchRecord)
  }

  // The Scout being reported for — same LOUD 404 rule as the single path.
  const { data: device, error: deviceErr } = await db
    .from('devices')
    .select('id, user_id, ranch_id')
    .eq('hardware_id', hardware_id)
    .maybeSingle()
  if (deviceErr) {
    return Response.json({ error: deviceErr.message }, { status: 500 })
  }
  if (!device) {
    return Response.json({ error: 'unknown hardware_id', hardware_id }, { status: 404 })
  }

  // Per-record loop, not a bulk upsert: PostgREST's onConflict can't target
  // 031's PARTIAL unique index, and ≤64 sequential inserts is nothing. 23505
  // → already durable → acked, exactly like the single path's duplicate rule.
  const acked: number[] = []
  let insertedCount = 0
  let duplicateCount = 0

  for (const rec of records) {
    const payload: Record<string, unknown> = { ...rec, courier_device_id }

    // Honest timestamp: GPS time when credible, server time labeled as such.
    let ts: string
    if (rec.unixTime >= MIN_CREDIBLE_UNIX_TIME) {
      ts = new Date(rec.unixTime * 1000).toISOString()
    } else {
      ts = new Date().toISOString()
      payload.ts_source = 'server'
    }

    // Typed coordinates only from a real fix; raw 1e-7 stays in payload.
    const hasFix = rec.fixType >= 2
    const { error: insertErr } = await db.from('events').insert({
      user_id: device.user_id,
      ranch_id: device.ranch_id, // same null-safe inheritance as the single path
      device_id: device.id,
      type,
      ts,
      lat: hasFix ? rec.lat / 1e7 : null,
      lng: hasFix ? rec.lon / 1e7 : null,
      payload,
      schema_version: 1,
      dedup_key: `${hardware_id}:${rec.seq}`,
    })

    if (insertErr) {
      if (insertErr.code === '23505') {
        duplicateCount++
        acked.push(rec.seq) // already durable — that IS the ack
        continue
      }
      // Nothing past this record is acked; the courier retries the batch
      // whole and idempotency collapses the overlap.
      return Response.json({ error: insertErr.message }, { status: 500 })
    }
    insertedCount++
    acked.push(rec.seq)
  }

  // Display-cache refresh for the Scout row — never blocks the acked batch.
  await db.from('devices').update({ last_seen: new Date().toISOString() }).eq('id', device.id)

  return Response.json(
    { ok: true, acked, inserted: insertedCount, duplicates: duplicateCount },
    { status: insertedCount > 0 ? 201 : 200 },
  )
}
