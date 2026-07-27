import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

// ─── POST /api/ingest — the ONE hardware door (S2, the receiving dock) ─────────
//
// Every Dryline device forever reports here: the tank node is the first caller,
// a puck later POSTs the same endpoint with a different `type`. One door, not
// one door per device type — the events table is the only destination.
//
// AUTH — shared-secret header, the CRON_SECRET pattern (one env var, one
// firmware config value): Authorization: Bearer ${INGEST_SECRET}.
// ⚠️  REVISIT TRIGGER (decided 2026-07-26): the FIRST time hardware ships to a
// rancher who isn't PK, add a nullable token_hash column to devices and verify
// it here when present (per-device revocation). Additive — the endpoint
// contract does not change. Until then a per-device scheme defends against a
// threat that doesn't exist.
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

const MAX_BODY_BYTES = 32 * 1024

export async function POST(request: NextRequest) {
  const secret = process.env.INGEST_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
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

  const db = createServiceClient()

  // Map hardware → registered device (supplies user_id + device_id).
  const { data: device, error: deviceErr } = await db
    .from('devices')
    .select('id, user_id')
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
