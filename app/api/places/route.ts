import { parseCreatedAt, ValidationError } from '@/lib/manual-log'
import { sessionUser } from '@/lib/auth-user'
import { resolveRanchId } from '@/lib/ranch-membership'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { normalizeKind, MAX_NAME, canContain, parentRule } from '@/lib/places/kinds'
import { validateGeoJSONPolygon, ringToGeoJSON, storableAcres } from '@/lib/places/geo'
import { MAX_LOOP_SELF_CROSSINGS } from '@/lib/jobs/boundary'
import { live } from '@/lib/ledger-effective'
import { liveOnly } from '@/lib/trash'

// Places — the named spots on the outfit (031).
//
// GET  /api/places   → { places: [{id, name, kind}] } for the ranch
// POST /api/places   → { id?, name, kind?, geometry?, parent_id?, capture? }
//                      → { place, parent, siblings, consequence } (201; 200 on a replayed id)
//
// AUTH via lib/auth-user sessionUser(req): cookies first, then a Bearer JWT.
// Both come back as a USER-SCOPED client, so the 043 membership policies stay
// the scope (no user_id filters here) — this is not a service-role door. The
// Bearer leg is why the isolation suite can reach these routes at all; the
// older cookie-only pattern 401s every machine caller, which is exactly what
// it did here until the suite covered places.
//
// SLICE 1 CHANGE — `kind` and `geometry` are now accepted and persisted.
// Before this, the only caller (LogIt.tsx) posted { name } alone and every
// place on production landed as 'field', "Preston's house" included. `kind`
// still DEFAULTS to 'field' so that caller is unchanged and the record sheet
// keeps working exactly as it did; what is new is that a caller can say
// otherwise. geometry stays optional — a place named in the record sheet with
// no shape is still a legitimate place, and always will be.
//
// Acreage is NEVER taken from the client: it is computed here from the
// geometry the client sent, by the same shoelace the map draws against.

export async function GET(req: NextRequest) {
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { supabase } = session

  // LIVE ONLY. This is the picker a person chooses from when logging work, and
  // you cannot do new work at a place that has been retired. History keeps
  // naming retired places — every by-id name resolver is deliberately
  // unfiltered — and the correction form offers them flagged
  // (lib/activity filterOptions), which is the same split herd_lots uses.
  // Tolerant of a database that has not run 057 yet (040's precedent, and the
  // same shape lib/places/rows.ts uses for `acres`): ask for live places, and if
  // `retired_at` does not exist, ask again without the filter. Every place is
  // live on such a database, so the unfiltered answer is the correct one.
  const livePlaces = await liveOnly(supabase.from('places').select('id, name, kind').is('retired_at', null)).order('name', { ascending: true })
  const { data, error } = livePlaces.error
    ? await supabase.from('places').select('id, name, kind').order('name', { ascending: true })
    : livePlaces
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 8B.4 — the picker is what you reach for while standing somewhere, so it is
  // ordered by what you last used, not by the alphabet. Places never used yet
  // keep their name order at the back so the list stays findable.
  //
  // One extra read, capped, and TOLERANT: if it fails the picker still answers
  // in name order rather than not answering. An ordering is a convenience; the
  // list is not.
  const places = (data ?? []) as { id: string; name: string; kind: string }[]
  try {
    const { data: recent } = await live(supabase.from('events').select('ts, payload')).eq('payload->>source', 'manual').order('ts', { ascending: false }).limit(400)
    const lastUsed = new Map<string, string>()
    for (const r of (recent ?? []) as { ts: string; payload: Record<string, unknown> }[]) {
      for (const k of ['place_id', 'from_place_id', 'to_place_id', 'stock_place_id']) {
        const v = r.payload?.[k]
        if (typeof v === 'string' && v && !lastUsed.has(v)) lastUsed.set(v, r.ts)
      }
    }
    places.sort((a, b) => {
      const at = lastUsed.get(a.id) ?? '', bt = lastUsed.get(b.id) ?? ''
      if (at && bt) return bt.localeCompare(at)
      if (at) return -1
      if (bt) return 1
      return a.name.localeCompare(b.name)
    })
  } catch { /* name order stands */ }

  return NextResponse.json({ places })
}

export async function POST(req: NextRequest) {
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { user, supabase } = session

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  // Block 7A: a captured place carries a CLIENT-MINTED id, the same way every
  // entry through /api/log does, so a retry after a timed-out-but-landed save
  // can never make two places. A second arrival of the same id is answered
  // 200 with the row that already landed (see the insert below).
  const clientId = typeof body.id === 'string' && UUID.test(body.id) ? body.id : null
  if (body.id != null && !clientId) return NextResponse.json({ error: 'id must be a UUID' }, { status: 400 })
  if (body.kind != null && typeof body.kind !== 'string') {
    return NextResponse.json({ error: 'kind must be a string' }, { status: 400 })
  }
  // Free text, not an enum (031:46) — PLACE_KINDS is what the UI offers, not
  // what the column accepts. Lowercased so 'Field' and 'field' are one kind.
  const kind = normalizeKind(body.kind)

  // Optional shape at create time. Absent → an undrawn place, as before.
  let geometry: unknown = null
  let acres: number | null = null
  let geometry_provenance: unknown = null
  if (body.geometry != null) {
    // A RIDDEN ring gets the driven-lap tolerance, a tap-drawn one gets zero.
    // Same rule boundary.ts has always applied to a swather lap: scatter nicks
    // a corner, the shape is still simple. Reading `capture.source` here keeps
    // the decision with the thing that knows how the ring was made.
    const ridden = (body.capture as { source?: unknown } | null)?.source === 'ridden'
    const v = validateGeoJSONPolygon(body.geometry, ridden ? MAX_LOOP_SELF_CROSSINGS : 0)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    acres = storableAcres(v.acres)
    if (acres == null) return NextResponse.json({ error: 'That shape could not be measured, so it was not saved.' }, { status: 400 })
    geometry = ringToGeoJSON(v.ring)
    geometry_provenance = { source: 'drawn', created_at: new Date().toISOString(), corners: v.ring.length - 1 }

    // Block 8 — a captured place carries its EVIDENCE (8.6). The track that
    // produced the polygon rides along in provenance: the same column that
    // already says how a shape came to be, so no migration and no new table.
    // It is ranch-scoped by the same RLS as the place, and it is deliberately
    // NOT in the places list read — see the SELECT in this file. This is the
    // evidence behind one polygon, never a record of where a person went.
    const cap = body.capture
    if (cap && typeof cap === 'object') {
      const c = cap as Record<string, unknown>
      const src = c.source === 'ridden' || c.source === 'dropped' ? c.source : null
      if (src) {
        geometry_provenance = {
          source: src,
          created_at: new Date().toISOString(),
          corners: v.ring.length - 1,
          // The grade the geometry gave it. 'snapped' means the loop closed on
          // the guess rather than a true tie, and the place is labelled for it.
          ...(typeof c.status === 'string' ? { status: c.status } : {}),
          ...(c.snapped === true ? { snapped: true } : {}),
          ...(c.closedByHand === true ? { closed_by_hand: true } : {}),
          // Block 21 — a hand-closed ride whose joined track folded over
          // itself is stored as the outer edge of the ride, and says so.
          ...(c.outline === 'outer_edge' ? { outline: 'outer_edge' } : {}),
          ...(typeof c.accuracyM === 'number' ? { accuracy_m: Math.round(c.accuracyM * 10) / 10 } : {}),
          // Block 7A — a dropped pin may have been DRAGGED. Provenance says so
          // plainly: the fix the phone gave (never moved), where the pin ended
          // up, how far that is, and adjusted: true. An undragged pin records
          // adjusted: false with the same fix, so the two are never confused.
          ...(src === 'dropped' ? pinRecord(c) : {}),
          ...(typeof c.rejected === 'number' ? { rejected_fixes: c.rejected } : {}),
          ...(Array.isArray(c.gaps) ? { gaps: c.gaps.slice(0, 50) } : {}),
          ...(Array.isArray(c.track) ? { track: (c.track as unknown[]).slice(0, 5000) } : {}),
        }
      }
    }
  }

  const ranch_id = await resolveRanchId(supabase, user.id)

  // Block 7A — the parent, checked BEFORE the insert, on the caller's client.
  // Three questions, three refusals:
  //   · visible to this person? Under the membership policies a place on
  //     another ranch is simply not there, and the answer never says which —
  //     migration 068's trigger holds the same line at the database.
  //   · live? A retired or trashed place is off every picker, this one too.
  //   · may a place of THIS kind sit inside a place of THAT kind? The table in
  //     lib/places/kinds.ts (pasture → field → stackyard → stack) decides, and
  //     the refusal quotes its rule.
  let parent: { id: string; name: string; kind: string } | null = null
  if (body.parent_id != null) {
    if (typeof body.parent_id !== 'string' || !body.parent_id) {
      return NextResponse.json({ error: 'parent_id must be an id' }, { status: 400 })
    }
    const { data: p } = await liveOnly(supabase.from('places').select('id, name, kind, retired_at').eq('id', body.parent_id)).maybeSingle()
    const row = p as { id: string; name: string; kind: string; retired_at: string | null } | null
    if (!row) return NextResponse.json({ error: 'No such place to sit inside.' }, { status: 400 })
    if (row.retired_at) return NextResponse.json({ error: `${row.name} is retired, so nothing new can sit inside it.` }, { status: 400 })
    if (!canContain(row.kind, kind)) {
      return NextResponse.json({ error: `${parentRule(kind)} ${row.name} is a ${row.kind.replace(/_/g, ' ')}.` }, { status: 400 })
    }
    parent = { id: row.id, name: row.name, kind: row.kind }
  }

  // The slice-1 columns are touched ONLY when a shape came with the request.
  // A place named from the record sheet inserts exactly the row it always did,
  // so that path keeps working on a deploy that lands before migration 056 is
  // run by hand. Drawing, which genuinely needs the columns, fails loudly.
  // Block 27: a place ridden at dawn and sent at noon was made at dawn — the
  // outbox says when; the row and its evidence both carry it.
  let madeAt: string
  try { madeAt = parseCreatedAt(body.created_at) } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    throw err
  }
  if (geometry_provenance && typeof geometry_provenance === 'object') (geometry_provenance as Record<string, unknown>).created_at = madeAt
  const row: Record<string, unknown> = { user_id: user.id, ranch_id, name, kind, geometry, created_at: madeAt }
  if (clientId) row.id = clientId
  if (parent) row.parent_id = parent.id

  // 7D.4 — a ranch's FIRST place is pinned to Weather as it is created.
  // Without this a new ranch draws its first pasture, opens Weather and finds
  // nothing, because nothing has been recorded there yet: an empty Weather on
  // day one reads as broken. Only the first.
  if (ranch_id) {
    const { count } = await supabase.from('places').select('id', { count: 'exact', head: true }).eq('ranch_id', ranch_id)
    if ((count ?? 0) === 0) row.pinned_at = new Date().toISOString()
  }

  if (geometry) {
    row.acres = acres
    row.geometry_provenance = geometry_provenance
  }
  const cols = geometry
    ? 'id, name, kind, geometry, acres, ranch_id, created_at'
    : 'id, name, kind, geometry, ranch_id, created_at'

  const { data: place, error } = await supabase
    .from('places')
    .insert(row)
    .select(cols)
    .single()
  if (error) {
    // The replay: this id already landed (a retry after a save that timed out
    // on the way back). Answer with what is there, and say it is a replay.
    if (error.code === '23505' && clientId) {
      const { data: existing } = await supabase.from('places').select(cols).eq('id', clientId).maybeSingle()
      if (existing) return NextResponse.json({ place: existing, duplicate: true, ...(await answerFor(supabase, ranch_id, parent)) }, { status: 200 })
    }
    // 068's guard says no in a sentence a person can read; pass it through as
    // the refusal it is, not as a server fault.
    if (error.code === '23514') return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ place, ...(await answerFor(supabase, ranch_id, parent)) }, { status: 201 })
}

// The pin's record, taken from the client's capture but re-typed here: only
// finite numbers survive, and only the keys named. Nothing else the client
// sends about the pin is stored.
function pinRecord(c: Record<string, unknown>): Record<string, unknown> {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const fix = c.fix as Record<string, unknown> | undefined
  const pos = c.position as Record<string, unknown> | undefined
  const fLat = num(fix?.lat), fLng = num(fix?.lng), fAcc = num(fix?.accuracy_m)
  const pLat = num(pos?.lat), pLng = num(pos?.lng)
  const out: Record<string, unknown> = { adjusted: c.adjusted === true }
  if (fLat != null && fLng != null) out.fix = { lat: +fLat.toFixed(6), lng: +fLng.toFixed(6), ...(fAcc != null ? { accuracy_m: Math.round(fAcc * 10) / 10 } : {}) }
  if (pLat != null && pLng != null) out.position = { lat: +pLat.toFixed(6), lng: +pLng.toFixed(6) }
  const moved = num(c.moved_m)
  if (moved != null) out.moved_m = Math.round(moved * 10) / 10
  return out
}

type SessionClient = NonNullable<Awaited<ReturnType<typeof sessionUser>>>['supabase']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Block 7A — THE ANSWER, NOT A RECEIPT. A saved place is answered with what it
// changed: "in North Pasture · 4 places in it now", or "12 places on the
// ranch now" when it stands on its own. The count is taken AFTER the insert on
// the caller's client, so it is the count this person can see, and it includes
// the place just made. The shape matches /api/log's consequence so the outbox
// receipt prints it with no special case.
async function answerFor(supabase: SessionClient, ranchId: string | null, parent: { id: string; name: string; kind: string } | null) {
  let siblings = 0
  try {
    const q = parent
      ? liveOnly(supabase.from('places').select('id', { count: 'exact', head: true }).eq('parent_id', parent.id)).is('retired_at', null)
      : liveOnly(supabase.from('places').select('id', { count: 'exact', head: true }).eq('ranch_id', ranchId ?? '')).is('retired_at', null)
    const { count } = await q
    siblings = count ?? 0
  } catch { siblings = 0 }
  const line = parent
    ? `${siblings} ${siblings === 1 ? 'place' : 'places'} in ${parent.name} now`
    : `${siblings} ${siblings === 1 ? 'place' : 'places'} on the ranch now`
  return { parent: parent ? { id: parent.id, name: parent.name, kind: parent.kind } : null, siblings, consequence: { lines: [line] } }
}
