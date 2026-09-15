import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { sessionUser } from '@/lib/auth-user'
import { normalizeKind, MAX_NAME, canContain, parentRule, kindLabel } from '@/lib/places/kinds'
import { validateGeoJSONPolygon, ringToGeoJSON, storableAcres } from '@/lib/places/geo'
import { staleEdit, retiredWhileOpen } from '@/lib/stale-edit'
import { trashRow, liveOnly } from '@/lib/trash'

// One place (places, slice 1).
//
//   GET    /api/places/[id]  → { place }
//   PATCH  /api/places/[id]  → { name?, kind?, geometry?, parent_id?, retired?,
//                                pinned?, expected_updated_at? } → { place }
//                              parent_id and kind are judged against each other
//                              and against the kind table (Block 7A, below).
//   DELETE /api/places/[id]  → { place }   to the trash; Undo / /account/trash brings it back.
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
    patch.pinned_at = body.pinned ? new Date().toISOString() : null
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

  // ── Block 7A: the parent, and the kind — checked against each other ────────
  //
  // 056 capped the hierarchy at two levels here. Block 7A replaces that with
  // the kind table in lib/places/kinds.ts (pasture → field → stackyard →
  // stack; gate / tank / yard inside a pasture or a field), so depth is
  // whatever the kinds allow and nothing else. Three things can go wrong and
  // each gets its own sentence:
  //   · the parent is not visible, not live, or of a kind this place cannot
  //     sit inside;
  //   · the parent is this place or one of its own descendants (068's trigger
  //     also refuses this; the walk here is so the answer is a sentence, not
  //     a 500);
  //   · the KIND is changing to one its current parent cannot hold, or one
  //     that cannot hold the places already inside it — "a field with three
  //     stacks in it cannot become a stack".
  // The current row is read first, on the caller's client, so every rule is
  // judged against what is actually there rather than what the body claims.
  const wantsParent = 'parent_id' in body
  const wantsKind = 'kind' in body
  if (wantsParent || wantsKind) {
    const { data: curRow } = await supabase.from('places').select('id, kind, parent_id').eq('id', id).maybeSingle()
    const cur = curRow as { id: string; kind: string; parent_id: string | null } | null
    if (!cur) return NextResponse.json({ error: 'No such place' }, { status: 404 })
    const nextKind = wantsKind ? (patch.kind as string) : cur.kind

    let nextParentId: string | null = cur.parent_id
    if (wantsParent) {
      const parent = body.parent_id
      if (parent === null) {
        nextParentId = null
      } else if (typeof parent !== 'string' || !parent) {
        return NextResponse.json({ error: 'parent_id must be an id or null' }, { status: 400 })
      } else if (parent === id) {
        return NextResponse.json({ error: 'A place cannot contain itself.' }, { status: 400 })
      } else {
        nextParentId = parent
      }
    }

    if (nextParentId && (wantsParent || wantsKind)) {
      const { data: p } = await liveOnly(supabase.from('places').select('id, name, kind, parent_id, retired_at').eq('id', nextParentId)).maybeSingle()
      const par = p as { id: string; name: string; kind: string; parent_id: string | null; retired_at: string | null } | null
      if (!par) return NextResponse.json({ error: 'No such place to sit inside.' }, { status: 400 })
      if (par.retired_at) return NextResponse.json({ error: `${par.name} is retired, so nothing can sit inside it.` }, { status: 400 })
      if (!canContain(par.kind, nextKind)) {
        return NextResponse.json({ error: `${parentRule(nextKind)} ${par.name} is a ${kindLabel(par.kind).toLowerCase()}.` }, { status: 400 })
      }
      // No loops: walk up from the parent; reaching this row means the parent
      // is inside it already.
      let cursor: string | null = par.parent_id
      for (let steps = 0; cursor && steps < 64; steps++) {
        if (cursor === id) return NextResponse.json({ error: `${par.name} is already inside this place, so this place cannot sit inside it.` }, { status: 400 })
        const { data: up } = await supabase.from('places').select('parent_id').eq('id', cursor).maybeSingle()
        cursor = (up as { parent_id: string | null } | null)?.parent_id ?? null
      }
    }

    if (wantsKind && nextKind !== cur.kind) {
      // The places already inside this one must still be allowed inside its new kind.
      const { data: kidRows } = await liveOnly(supabase.from('places').select('kind').eq('parent_id', id)).is('retired_at', null)
      const kids = (kidRows ?? []) as { kind: string }[]
      const blocked = kids.filter(k => !canContain(nextKind, k.kind))
      if (blocked.length > 0) {
        const n = blocked.length
        return NextResponse.json({ error: `${n} ${n === 1 ? 'place' : 'places'} inside it cannot sit inside a ${kindLabel(nextKind).toLowerCase()}. Move ${n === 1 ? 'it' : 'them'} out first.` }, { status: 400 })
      }
    }

    if (wantsParent) patch.parent_id = nextParentId
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
  // 068's guard refuses in a sentence; pass it through as a refusal, not a fault.
  if (error && error.code === '23514') return NextResponse.json({ error: error.message }, { status: 400 })
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

// ─── DELETE — to the trash, always (Block 13) ─────────────────────────────────
//
// 057 made this verb mean RETIRE; 7D.3 made it a real delete that refused when
// anything pointed at the place; 8B.2 added a cascade that deleted the entries
// too; 12.4 sent the row to the trash. Block 13 keeps only the last of those.
//
//   DELETE → the row gets deleted_at, and that is all that happens.
//
// Nothing else is refused, counted, or cascaded. Every entry that named the
// place keeps naming it — events.payload->>place_id has no foreign key and is
// not touched — and every reader that resolves a place name now shows a
// deleted one as gone rather than blank (lib/activity.ts namesFor). The undo
// strip is the safety: ten seconds, one tap, and POST /api/trash puts the row
// back with everything still pointing at it. /account/trash holds it seven days.
//
// The write is a service-role UPDATE after the caller's own client has read
// the row (lib/trash.ts trashRow): RLS is the membership gate; 062 closed the
// client delete door and it stays closed.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const session = await sessionUser(req)
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const { supabase } = session

  const { data: place } = await supabase.from('places').select(SELECT).eq('id', id).maybeSingle()
  if (!place) return NextResponse.json({ error: 'No such place' }, { status: 404 })

  const t = await trashRow(supabase, session.user.id, 'places', id)
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status })
  return NextResponse.json({ deleted: true, trashed: true, place })
}
