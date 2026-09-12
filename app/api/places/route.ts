import { sessionUser } from '@/lib/auth-user'
import { resolveRanchId } from '@/lib/ranch-membership'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { normalizeKind, MAX_NAME } from '@/lib/places/kinds'
import { validateGeoJSONPolygon, ringToGeoJSON, storableAcres } from '@/lib/places/geo'
import { hasPlacePin } from '@/lib/schema-capability'

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
  return NextResponse.json({ places: data ?? [] })
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
    const v = validateGeoJSONPolygon(body.geometry)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    acres = storableAcres(v.acres)
    if (acres == null) return NextResponse.json({ error: 'That shape could not be measured, so it was not saved.' }, { status: 400 })
    geometry = ringToGeoJSON(v.ring)
    geometry_provenance = { source: 'drawn', created_at: new Date().toISOString(), corners: v.ring.length - 1 }
  }

  const ranch_id = await resolveRanchId(supabase, user.id)

  // The slice-1 columns are touched ONLY when a shape came with the request.
  // A place named from the record sheet inserts exactly the row it always did,
  // so that path keeps working on a deploy that lands before migration 056 is
  // run by hand. Drawing, which genuinely needs the columns, fails loudly.
  const row: Record<string, unknown> = { user_id: user.id, ranch_id, name, kind, geometry }

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
