import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { effective } from '@/lib/ledger-effective'
import { MANUAL_EVENT_TYPES } from '@/lib/manual-log'
import { placeRing } from '@/lib/places/anchor'
import type { LatLng } from '@/lib/places/geo'
import { liveOnly } from '../trash'

// ─── The places list's rows (Block 6A · shapes in slice 1) ────────────────────
// name · type · last recorded work · last recorded rain — the last two only
// when a line exists (through the correction chain). A place with no rain
// reading shows no rain; zero is never inferred from silence.
//
// Slice 1 adds the shape and its acreage, both nullable and both silent when
// absent: an undrawn place is a legitimate place and says nothing about acres.

export interface PlaceRow {
  id: string
  name: string
  kind: string
  retiredAt: string | null
  /** Block 7A: the place this one sits inside, or null. Resolved against the LIVE list by the page. */
  parentId: string | null
  lastWork: { ts: string; type: string } | null
  lastRain: { ts: string; inches: number } | null
  ring: LatLng[] | null
  acres: number | null
}

/** Live rows first, retired kept separate — never dropped (they must stay reachable). */
export interface PlaceRows { live: PlaceRow[]; retired: PlaceRow[] }

export async function placeRows(supabase: SupabaseClient): Promise<PlaceRows> {
  const list = await selectPlaces(supabase)
  const shaped = list.map(pl => ({ ...pl, ring: placeRing(pl.geometry), acres: typeof pl.acres === 'number' ? pl.acres : null }))
  if (shaped.length === 0) return { live: [], retired: [] }
  // 7D: skip the deleted filter on a database without 061 (temporary).
  const { data: events } = await effective(supabase.from('events').select('id, type, ts, payload').in('type', MANUAL_EVENT_TYPES.filter(t => t !== 'bunch_seen')))   // Block 30: a sighting is not work.eq('payload->>source', 'manual'))
    .order('ts', { ascending: false }).limit(1000)
  const work = new Map<string, { ts: string; type: string }>()
  const rain = new Map<string, { ts: string; inches: number }>()
  for (const r of (events ?? []) as { id: string; type: string; ts: string; payload: Record<string, unknown> }[]) {
    const p = r.payload
    const named = [p.place_id, p.from_place_id, p.to_place_id].filter((v): v is string => typeof v === 'string' && !!v)
    for (const pid of named) {
      if (!work.has(pid)) work.set(pid, { ts: r.ts, type: r.type })
      if (r.type === 'rain' && p.place_id === pid && !rain.has(pid) && typeof p.inches === 'number') rain.set(pid, { ts: r.ts, inches: p.inches })
    }
  }
  // 8B.4 — ORDER BY WHAT YOU'D REACH FOR. Alphabetical is an ordering of
  // names, not of a ranch: "Audit pen" outranks "Home pasture" for no reason
  // anyone standing in a field would recognise. Most-recently-used first, and
  // places with no activity fall to the back in name order so the list is
  // still findable once you are past the ones you use. Same principle as the
  // Weather fallback picking by evidence rather than alphabetically.
  const rows: PlaceRow[] = shaped.map(pl => ({
    id: pl.id, name: pl.name, kind: pl.kind, ring: pl.ring, acres: pl.acres,
    retiredAt: pl.retired_at ?? null,
    parentId: pl.parent_id ?? null,
    lastWork: work.get(pl.id) ?? null,
    lastRain: rain.get(pl.id) ?? null,
  }))
  const byUse = (a: PlaceRow, b: PlaceRow) => {
    const at = a.lastWork?.ts ?? '', bt = b.lastWork?.ts ?? ''
    if (at && bt) return bt.localeCompare(at)        // most recent first
    if (at) return -1                                 // used beats unused
    if (bt) return 1
    return a.name.localeCompare(b.name)               // never used → findable
  }
  return { live: rows.filter(r => !r.retiredAt).sort(byUse), retired: rows.filter(r => r.retiredAt).sort(byUse) }
}

// TOLERANT READ, on 040's precedent (lib/jobs/annotations.ts fetchFieldsCut):
// before migration 056 is applied `acres` does not exist, and asking for it
// fails the WHOLE select — which would empty the places list and make it look
// like the outfit has no ground. So ask for it, and if the column isn't there
// yet, ask again without it. The acreage simply stays invisible until the
// migration runs; nothing else on the page changes.
async function selectPlaces(supabase: SupabaseClient) {
  type Row = { id: string; name: string; kind: string; geometry: unknown; acres: number | null; retired_at: string | null; parent_id: string | null }
  const full = await liveOnly(supabase.from('places').select('id, name, kind, geometry, acres, retired_at, parent_id')).order('name', { ascending: true })
  if (!full.error) return (full.data ?? []) as Row[]
  const legacy = await supabase.from('places').select('id, name, kind, geometry').order('name', { ascending: true })
  return ((legacy.data ?? []) as Omit<Row, 'acres' | 'retired_at' | 'parent_id'>[]).map(r => ({ ...r, acres: null, retired_at: null, parent_id: null }))
}

// ─── The hierarchy (Block 7A) ─────────────────────────────────────────────────
//
// pastures at the top, fields and stacks nested under whatever holds them, and
// everything that stands on its own in "Unplaced" at the bottom. NEVER HIDE A
// PLACE: a row whose parent is not on the live list (retired, trashed, or
// simply not visible) is shown at the top level rather than lost under a
// parent that is not there. A visited set bounds the walk, so even a loop that
// somehow reached the table (068 refuses one) renders every row once.
//
// "Top" is any live place that is a pasture OR holds other places — a
// parentless field with three stacks in it is a hierarchy of its own, and it
// belongs with the pastures, not in Unplaced. Unplaced = parentless, childless,
// not a pasture. Within every group the rows keep placeRows' order: most
// recently used first, then by name.

export interface PlaceNode extends PlaceRow {
  children: PlaceNode[]
  depth: number
}

export interface PlaceTree {
  /** Pastures and any other place that holds others, each with its subtree. */
  top: PlaceNode[]
  /** Parentless, childless, not a pasture. */
  unplaced: PlaceNode[]
}

export function placeTree(live: PlaceRow[]): PlaceTree {
  const byId = new Map(live.map(r => [r.id, r]))
  const kids = new Map<string, PlaceRow[]>()
  for (const r of live) {
    const pid = r.parentId && byId.has(r.parentId) && r.parentId !== r.id ? r.parentId : null
    if (pid) kids.set(pid, [...(kids.get(pid) ?? []), r])
  }
  const seen = new Set<string>()
  const build = (r: PlaceRow, depth: number): PlaceNode => {
    seen.add(r.id)
    const children = (kids.get(r.id) ?? []).filter(c => !seen.has(c.id)).map(c => build(c, depth + 1))
    return { ...r, children, depth }
  }
  const roots = live.filter(r => !(r.parentId && byId.has(r.parentId) && r.parentId !== r.id))
  const top: PlaceNode[] = []
  const unplaced: PlaceNode[] = []
  for (const r of roots) {
    if (seen.has(r.id)) continue
    const node = build(r, 0)
    if (r.kind === 'pasture' || node.children.length > 0) top.push(node)
    else unplaced.push(node)
  }
  // Anything a loop kept out of both lists (unreachable from any root) still
  // gets a row. 068 makes this impossible; the rule is "never hide a place".
  for (const r of live) if (!seen.has(r.id)) unplaced.push(build(r, 0))
  return { top, unplaced }
}

/** "3 stacks and a field in it" — what a parent holds, counted by kind, for a row or a page. */
export function childrenSummary(children: { kind: string }[], kindLabel: (k: string) => string): string | null {
  if (children.length === 0) return null
  const counts = new Map<string, number>()
  for (const c of children) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1)
  const parts = [...counts.entries()].map(([k, n]) => {
    const label = kindLabel(k).toLowerCase()
    return n === 1 ? `a ${label}` : `${n} ${label}s`
  })
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${list} in it`
}
