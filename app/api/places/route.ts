import { sessionUser } from '@/lib/auth-user'
import { resolveRanchId } from '@/lib/ranch-membership'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { normalizeKind, MAX_NAME } from '@/lib/places/kinds'
import { validateGeoJSONPolygon, ringToGeoJSON, storableAcres } from '@/lib/places/geo'
import { hasPlacePin, hasEventDeletion } from '@/lib/schema-capability'
import { MAX_LOOP_SELF_CROSSINGS } from '@/lib/jobs/boundary'

// Places — the named spots on the outfit (031).
//
// GET  /api/places   → { places: [{id, name, kind}] } for the ranch
// POST /api/places   → { name, kind?, geometry? } → { place } (201)
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
  const live = await supabase.from('places').select('id, name, kind').is('retired_at', null).order('name', { ascending: true })
  const { data, error } = live.error
    ? await supabase.from('places').select('id, name, kind').order('name', { ascending: true })
    : live
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
    const canDel = await hasEventDeletion(supabase)
    let q = supabase.from('events').select('ts, payload').eq('payload->>source', 'manual')
    if (canDel) q = q.is('deleted_at', null)
    const { data: recent } = await q.order('ts', { ascending: false }).limit(400)
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
          ...(typeof c.accuracyM === 'number' ? { accuracy_m: Math.round(c.accuracyM * 10) / 10 } : {}),
          ...(typeof c.rejected === 'number' ? { rejected_fixes: c.rejected } : {}),
          ...(Array.isArray(c.gaps) ? { gaps: c.gaps.slice(0, 50) } : {}),
          ...(Array.isArray(c.track) ? { track: (c.track as unknown[]).slice(0, 5000) } : {}),
        }
      }
    }
  }

  const ranch_id = await resolveRanchId(supabase, user.id)

  // The slice-1 columns are touched ONLY when a shape came with the request.
  // A place named from the record sheet inserts exactly the row it always did,
  // so that path keeps working on a deploy that lands before migration 056 is
  // run by hand. Drawing, which genuinely needs the columns, fails loudly.
  const row: Record<string, unknown> = { user_id: user.id, ranch_id, name, kind, geometry }

  // Field systems (Aug 10, and PK's ruling): a named area can contain fields,
  // and 056 already carries parent_id. Threaded through capture now with NO UI
  // in this block — cheap insurance against designing it out, which is exactly
  // what a flat capture flow would have done.
  if (typeof body.parent_id === 'string' && body.parent_id) row.parent_id = body.parent_id

  // 7D.4 — a ranch's FIRST place is pinned to Weather as it is created.
  // Without this a new ranch draws its first pasture, opens Weather and finds
  // nothing, because nothing has been recorded there yet: an empty Weather on
  // day one reads as broken. Only the first, and only when the column exists;
  // on a database without 062 the key is simply not set.
  if (ranch_id && await hasPlacePin(supabase)) {
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ place }, { status: 201 })
}
