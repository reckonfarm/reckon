import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { createServiceClient } from '@/lib/supabase'
import { placeReferences, refsSentence, planPlaceCascade, cascadeSentence } from '@/lib/places/references'
import { applySplit, cascadeAvailable } from '@/lib/cascade'
import { resolveRanchId } from '@/lib/ranch-membership'
import { hasPlacePin } from '@/lib/schema-capability'
import { normalizeKind, MAX_NAME } from '@/lib/places/kinds'
import { validateGeoJSONPolygon, ringToGeoJSON, storableAcres } from '@/lib/places/geo'
import { staleEdit, retiredWhileOpen } from '@/lib/stale-edit'

// One place (places, slice 1).
//
//   GET    /api/places/[id]  → { place }
//   PATCH  /api/places/[id]  → { name?, kind?, geometry?, parent_id?, retired?,
//                                expected_updated_at? } → { place }
//   DELETE /api/places/[id]  → { place }   RETIRES it. Nothing is deleted.
//
// AUTH via lib/auth-user sessionUser(req) — cookies first, then a Bearer JWT,
// both returning a user-scoped client. The older cookie-only pattern this
// route was first written with 401s every machine caller, so the isolation
// suite could not reach it; places is a write surface now and the suite has to
// be able to.
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
// THE VERB IS DELETE, THE EFFECT IS RETIRE. events.payload->>place_id has no
// foreign key, no index and no constraint across 9,186 rows: a hard delete
// leaves 40 manual entries pointing at nothing and silently loses their WHERE.
// A retired place keeps resolving its name in that history and leaves every
// picker. Doctrine agrees — "Disable, don't delete" (docs/01:31).
//
// UN-RETIRE IS `PATCH { retired: false }`, NOT a second DELETE-shaped route.
// Retiring is the destructive-feeling act and gets the destructive-looking
// verb; putting a place back is an ordinary edit of its state, and that is
// what PATCH is for. It also matches the one reversible flag this repo already
// has — job dismiss is `PATCH { dismissed: boolean }`, never DELETE twice.
//
// CONCURRENCY: pass `expected_updated_at` and the write carries
// `.eq('updated_at', …)`. Two people editing the same place cannot both win;
// the loser is told who changed it and when, in the words lib/stale-edit.ts
// holds for both this and herd_lots. Omitting it is allowed and means
// last-write-wins — the record sheet's inline create has no form to go stale.
//
// A RETIRED PLACE IS NOT EDITABLE except to un-retire it, mirroring
// lib/herd-lots.ts updateLot's `.is('retired_at', null)`.
//
// AND GEOMETRY IS SET-ONCE — see the block in PATCH below.

const SELECT = 'id, name, kind, geometry, acres, parent_id, geometry_provenance, created_at, updated_at, updated_by, retired_at, retired_by, revision'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { supabase } = session

  const { data, error } = await supabase.from('places').select(SELECT).eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'No such place' }, { status: 404 })
  return NextResponse.json({ place: data })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { supabase } = session

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // updated_at is NOT set here. 057 gives places the trigger herd_lots has had
  // since 051, so the database bumps the token on every UPDATE — measured
  // beforehand: without it, a write that omits the column leaves it completely
  // unchanged, which would make every staleness check below a no-op the first
  // time some other writer forgot. One source of truth, and it is the database.
  const patch: Record<string, unknown> = { updated_by: session.user.id }

  // Un-retire is the one edit a retired place accepts, so it is read first.
  let unretiring = false
  if ('retired' in body) {
    if (typeof body.retired !== 'boolean') {
      return NextResponse.json({ error: 'retired must be true or false' }, { status: 400 })
    }
    if (body.retired) {
      patch.retired_at = new Date().toISOString()
      patch.retired_by = session.user.id
    } else {
      unretiring = true
      patch.retired_at = null
      patch.retired_by = null
    }
  }

  // 7D.4 — the pin. A place earns its row on Weather by having a rain reading,
  // a device, or this. Tolerated on a database without 062: the write is simply
  // dropped rather than 400-ing, so the button is inert instead of broken.
  if ('pinned' in body) {
    if (typeof body.pinned !== 'boolean') {
      return NextResponse.json({ error: 'pinned must be true or false' }, { status: 400 })
    }
    if (await hasPlacePin(supabase)) patch.pinned_at = body.pinned ? new Date().toISOString() : null
  }

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
    const acres = storableAcres(v.acres)
    if (acres == null) return NextResponse.json({ error: 'That shape could not be measured, so it was not saved.' }, { status: 400 })
    patch.geometry = ringToGeoJSON(v.ring)
    patch.acres = acres
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

  // The concurrency token the editor was looking at, if their form carried one.
  const expected = typeof body.expected_updated_at === 'string' && body.expected_updated_at
    ? body.expected_updated_at
    : null

  // Set-once is enforced IN THE WRITE, not by a read-then-write: `is('geometry',
  // null)` makes "only if still undrawn" part of the statement, so two people
  // drawing the same place at the same moment can't both win. The loser gets
  // the 409 below, having changed nothing — name and kind included, since the
  // whole patch is one statement.
  let write = supabase.from('places').update(patch).eq('id', id)
  // Three guards that answer three different questions, all in the statement so
  // none of them can lose a race: is this still the row I read · is this still
  // undrawn · is this still live.
  if (expected) write = write.eq('updated_at', expected)
  if (settingGeometry) write = write.is('geometry', null)
  if (!unretiring) write = write.is('retired_at', null)

  const { data, error } = await write.select(SELECT).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (data) return NextResponse.json({ place: data })

  // Zero rows has four causes and they need four different sentences. Re-read
  // under the same policies: whatever is visible tells us which guard bit.
  const { data: cur } = await supabase
    .from('places')
    .select('id, geometry, updated_at, updated_by, retired_at')
    .eq('id', id)
    .maybeSingle()
  const row = cur as { geometry: unknown; updated_at: string; updated_by: string | null; retired_at: string | null } | null

  // Not visible at all: another ranch's place, or none. Same answer for both —
  // it isn't there for you, and we never confirm that it exists elsewhere.
  if (!row) return NextResponse.json({ error: 'No such place' }, { status: 404 })

  if (!unretiring && row.retired_at) {
    return NextResponse.json({ error: retiredWhileOpen('place') }, { status: 404 })
  }
  if (settingGeometry && row.geometry != null) {
    return NextResponse.json({ error: 'This place already has a shape, and redrawing one is not in yet.' }, { status: 409 })
  }
  if (expected && row.updated_at !== expected) {
    const stale = await staleEdit('place', row)
    return NextResponse.json({ error: stale.error, code: 'stale', changed_by: stale.changed_by, changed_at: stale.changed_at }, { status: 409 })
  }
  // Visible, live, and the token matched — nothing left that could have
  // stopped it. Say so honestly rather than inventing a cause.
  return NextResponse.json({ error: 'That change could not be saved. Open the place again and retry.' }, { status: 409 })
}

// ─── DELETE = retire ──────────────────────────────────────────────────────────
// ─── DELETE — a real delete when nothing points at it (Block 7D.3) ───────────
//
// 057 made this verb mean RETIRE, because with no reference check a hard
// delete would have orphaned entries silently. 7D.3 does the check, so the
// verb means what it says:
//
//   nothing points at it  → the row is removed. One tap, gone.
//   something does        → 409, NOT deleted and NOT quietly retired, with a
//                           count of what still points at it. The caller can
//                           still retire it (PATCH { retired: true }); this
//                           route will not decide that for them.
//
// The counts come from lib/places/references.ts on the CALLER's client, so RLS
// scopes them: a place can never read as free-to-delete because the rows
// holding it belong to another ranch.
//
// The delete itself runs on the caller's client too. 062 revokes the client
// DELETE policy on places, so this is a service-role write after the
// membership check the caller's own read has already made — the same shape as
// the ranch-name write.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { supabase } = session

  // Read it through the caller's client first: RLS is the membership gate, and
  // a place on another ranch must be indistinguishable from one that is gone.
  const { data: place } = await supabase.from('places').select(SELECT).eq('id', id).maybeSingle()
  if (!place) return NextResponse.json({ error: 'No such place' }, { status: 404 })

  const refs = await placeReferences(supabase, id)
  const cascade = req.nextUrl.searchParams.get('cascade') === '1'

  if (refs.total > 0 && !cascade) {
    // 8B.2 — the refusal carries the PLAN, so the confirm can state both
    // numbers and offer the way through in the same breath. One tap, one
    // decision, no second prompt.
    const ranchId = await resolveRanchId(supabase, session.user.id)
    const plan = ranchId && await cascadeAvailable(supabase)
      ? await planPlaceCascade(supabase, session.user.id, ranchId, id)
      : null
    return NextResponse.json({
      error: 'still referenced',
      place,
      refs,
      message: refsSentence(refs),
      ...(plan ? {
        cascade: { hard: plan.hard.length, record: plan.record.length, devices: plan.devices },
        cascadeMessage: cascadeSentence(String((place as { name?: string }).name ?? 'this place'), refs, plan),
      } : {}),
    }, { status: 409 })
  }

  if (refs.total > 0 && cascade) {
    const ranchId = await resolveRanchId(supabase, session.user.id)
    if (!ranchId) return NextResponse.json({ error: 'No ranch' }, { status: 404 })
    if (!(await cascadeAvailable(supabase))) {
      return NextResponse.json({ error: 'Deleting entries is not switched on for this ranch yet.', code: 'no_deletion' }, { status: 503 })
    }
    // The entries first, then the place — so nothing live points at it by the
    // time it goes, and PK is never left with a place he cannot remove.
    const plan = await planPlaceCascade(supabase, session.user.id, ranchId, id)
    const applied = await applySplit(session.user.id, plan.hard, plan.record)
    if (!applied.ok) return NextResponse.json({ error: 'Those entries could not be deleted just now' }, { status: 500 })
  }

  const { error } = await createServiceClient().from('places').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'That place could not be deleted just now' }, { status: 500 })
  return NextResponse.json({ deleted: true, place, ...(cascade ? { cascaded: true } : {}) })
}
