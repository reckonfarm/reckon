import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { normalizeKind, MAX_NAME } from '@/lib/places/kinds'
import { validateGeoJSONPolygon, ringToGeoJSON, roundAcres } from '@/lib/places/geo'

// One place (places, slice 1).
//
//   GET   /api/places/[id]  → { place }
//   PATCH /api/places/[id]  → { name?, kind?, geometry?, parent_id? } → { place }
//
// USER-SCOPED CLIENT, NO SERVICE ROLE. Unlike /api/ranch (ranches has no
// update policy, so a rename there has to go service-role after proving
// membership), places has had "member places updatable" since 043 — gated on
// `ranch_id in (select ranch_id from ranch_members where user_id = auth.uid())`
// in BOTH using and with_check, so a row can neither be read nor moved across
// ranches. The policy IS the authorization; a cross-ranch PATCH simply matches
// zero rows and 404s. Nothing here needs to bypass RLS, so nothing here does.
//
// PARTIAL: only keys actually present in the body are written. Sending
// { name } must never blank a shape someone spent a minute drawing.
//
// ACREAGE IS NEVER TAKEN FROM THE CLIENT. It is recomputed here from the
// geometry that was sent, by the same shoelace the map draws against
// (lib/places/geo.ts, sharing lib/jobs/boundary.ts's projection). A client
// that posts `acres` is ignored.
//
// NO DELETE, deliberately. events.payload->>place_id has no foreign key, no
// index and no constraint across 9,186 rows, so the first delete would orphan
// ledger references silently. Referential correctness there is its own work.
//
// AND GEOMETRY IS SET-ONCE — see the block in PATCH below.

const SELECT = 'id, name, kind, geometry, acres, parent_id, geometry_provenance, created_at, updated_at'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data, error } = await supabase.from('places').select(SELECT).eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'No such place' }, { status: 404 })
  return NextResponse.json({ place: data })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // 031's convention: updated_at is app-stamped, there is no trigger function
  // in this repo.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : ''
    if (!name) return NextResponse.json({ error: 'A place needs a name.' }, { status: 400 })
    patch.name = name
  }

  if ('kind' in body) {
    if (body.kind != null && typeof body.kind !== 'string') {
      return NextResponse.json({ error: 'kind must be a string' }, { status: 400 })
    }
    patch.kind = normalizeKind(body.kind)
  }

  // ── GEOMETRY IS SET-ONCE IN THIS SLICE ──────────────────────────────────────
  // An undrawn place can be given a shape. A place that HAS one keeps it: this
  // route will not overwrite a drawn shape, and will not clear one either.
  //
  // Why, and why now: changing a boundary is not an edit, it is a correction
  // to a fact other rows will come to depend on, and this codebase already has
  // a doctrine for that — the ledger never rewrites, a correction is a new row
  // that names what it replaced (054). A place has no such chain yet. Until it
  // does, a silent overwrite would erase the only record of what the ground
  // was, with nothing to point back at. Zero polygons exist in production
  // today, so this costs nothing to establish and everything to retrofit.
  //
  // Name and kind stay editable on a drawn place — set-once is about the
  // shape, not the row.
  const settingGeometry = 'geometry' in body
  if (settingGeometry) {
    if (body.geometry === null) {
      return NextResponse.json({ error: 'Clearing a shape is not something this can do yet.' }, { status: 400 })
    }
    const v = validateGeoJSONPolygon(body.geometry)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    patch.geometry = ringToGeoJSON(v.ring)
    patch.acres = roundAcres(v.acres)
    patch.geometry_provenance = {
      source: 'drawn',
      created_at: new Date().toISOString(),
      corners: v.ring.length - 1,
    }
  }

  if ('parent_id' in body) {
    const parent = body.parent_id
    if (parent === null) {
      patch.parent_id = null
    } else if (typeof parent !== 'string') {
      return NextResponse.json({ error: 'parent_id must be an id or null' }, { status: 400 })
    } else if (parent === id) {
      return NextResponse.json({ error: 'A place cannot contain itself.' }, { status: 400 })
    } else {
      // Two levels, enforced here rather than in the schema (056's header
      // says why). The parent must be visible to this person — RLS decides
      // that — and must itself be top-level.
      const { data: p } = await supabase.from('places').select('id, parent_id').eq('id', parent).maybeSingle()
      if (!p) return NextResponse.json({ error: 'No such place to sit inside.' }, { status: 400 })
      if (p.parent_id) {
        return NextResponse.json({ error: 'Places go two deep: that one is already inside another.' }, { status: 400 })
      }
      // …and this row must have no children of its own, or the pair would
      // make three levels.
      const { data: kids } = await supabase.from('places').select('id').eq('parent_id', id).limit(1)
      if ((kids ?? []).length > 0) {
        return NextResponse.json({ error: 'This place already contains others, so it cannot sit inside one.' }, { status: 400 })
      }
      patch.parent_id = parent
    }
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  }

  // Set-once is enforced IN THE WRITE, not by a read-then-write: `is('geometry',
  // null)` makes "only if still undrawn" part of the statement, so two people
  // drawing the same place at the same moment can't both win. The loser gets
  // the 409 below, having changed nothing — name and kind included, since the
  // whole patch is one statement.
  const write = supabase.from('places').update(patch).eq('id', id)
  const { data, error } = await (settingGeometry ? write.is('geometry', null) : write).select(SELECT).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    // Zero rows has two causes and they need different words. Re-read under
    // the same policies: if the row is visible, the guard is what stopped us.
    if (settingGeometry) {
      const { data: existing } = await supabase.from('places').select('id, geometry').eq('id', id).maybeSingle()
      if (existing && (existing as { geometry: unknown }).geometry != null) {
        return NextResponse.json({ error: 'This place already has a shape, and redrawing one is not in yet.' }, { status: 409 })
      }
    }
    // Otherwise the membership policy did not match — another ranch's place,
    // or none. Same answer for both: it isn't there for you.
    return NextResponse.json({ error: 'No such place' }, { status: 404 })
  }
  return NextResponse.json({ place: data })
}
