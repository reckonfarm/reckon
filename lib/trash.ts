import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase'
import { resolveRanchId } from '@/lib/ranch-membership'

// ─── The trash (Block 12, 12.4) ───────────────────────────────────────────────
// Deleted things go here for 7 days, then gone for good; nobody sees it unless
// they go looking (/account/trash). One meaning across four tables: deleted_at
// set = in the trash, invisible everywhere else; null = live. Events had it
// since 061; migration 065 gives places, herd_lots and devices the same two
// columns. RETIRED is a different state and is untouched — out of the pickers,
// still on the ranch.
//
// WHY THE SERVICE ROLE FOR THE WRITE. places, devices and herd_lots have no
// client DELETE policy and gain none; a trash write is an UPDATE of a column
// the client could set through the member-update policy, but restore must also
// work on a row the client can no longer see through some readers, and both
// halves should be one path. So: the row is READ on the caller's own client
// first — RLS decides whether it exists to this person at all — and only then
// written with the service role, membership already proven. Same doctrine as
// lib/deletion.ts.
//

export const TRASH_TABLES = ['events', 'places', 'herd_lots', 'devices'] as const
export type TrashTable = (typeof TRASH_TABLES)[number]
export const isTrashTable = (v: unknown): v is TrashTable => typeof v === 'string' && (TRASH_TABLES as readonly string[]).includes(v)

/** Days a row stays in the trash before purge_trash() removes it. Matches 065's default. */
export const TRASH_DAYS = 7

/** Block 12: 065 is applied. The live filter is unconditional; the pre-065
 *  probe (hasTrash) is gone — it memoised a `false` per serverless process and
 *  kept reporting "not switched on" for the life of that instance after PK had
 *  run the migration. A probe that can be stale is worse than no probe. */
export function liveOnly<T extends { is(column: string, value: null): T }>(q: T): T {
  return q.is('deleted_at', null)
}

export type TrashResult = { ok: true } | { ok: false; status: 404 | 500 | 503; error: string }

/**
 * Puts a row in the trash. Reads it on the caller's client first (RLS is the
 * gate), then sets deleted_at / deleted_by with the service role.
 */
export async function trashRow(supabase: SupabaseClient, userId: string, table: TrashTable, id: string): Promise<TrashResult> {
  const { data } = await supabase.from(table).select('id').eq('id', id).maybeSingle()
  if (!data) return { ok: false, status: 404, error: 'That is not on your ranch.' }
  const { error } = await createServiceClient().from(table)
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', id).is('deleted_at', null)
  if (error) return { ok: false, status: 500, error: 'That could not be deleted just now.' }
  return { ok: true }
}

/**
 * Takes a row back out. The person must be a member of the row's ranch; the
 * caller's client proves that by being able to read the row at all, trash
 * included (read policies are membership, not liveness).
 */
export async function restoreRow(supabase: SupabaseClient, userId: string, table: TrashTable, id: string): Promise<TrashResult> {
  const ranchId = await resolveRanchId(supabase, userId)
  if (!ranchId) return { ok: false, status: 404, error: 'No ranch' }
  const { data } = await supabase.from(table).select('id, ranch_id').eq('id', id).maybeSingle()
  const row = data as { id: string; ranch_id: string | null } | null
  if (!row || row.ranch_id !== ranchId) return { ok: false, status: 404, error: 'That is not in your trash.' }
  const { error } = await createServiceClient().from(table)
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', id).not('deleted_at', 'is', null)
  if (error) return { ok: false, status: 500, error: 'That could not be restored just now.' }
  return { ok: true }
}

export interface TrashItem {
  table: TrashTable
  id: string
  label: string
  deletedAt: string
  /** 'YYYY-MM-DD' ranch day it will be purged. */
  goneOn: string
}

const dayKeyUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Everything in the caller's ranch's trash, newest first. Read on the caller's
 * client: RLS scopes it, and a member sees the whole ranch's trash because
 * deleting is a ranch act, not a private one.
 */
export async function listTrash(supabase: SupabaseClient): Promise<TrashItem[]> {
  const out: TrashItem[] = []
  const gone = (deletedAt: string) => dayKeyUTC(Date.parse(deletedAt) + TRASH_DAYS * 86_400_000)
  try {
    const [places, lots, devices, events] = await Promise.all([
      supabase.from('places').select('id, name, deleted_at').not('deleted_at', 'is', null),
      supabase.from('herd_lots').select('id, name, class, head_count, deleted_at').not('deleted_at', 'is', null),
      supabase.from('devices').select('id, name, deleted_at').not('deleted_at', 'is', null),
      supabase.from('events').select('id, type, ts, payload, deleted_at').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(200),
    ])
    for (const p of (places.data ?? []) as { id: string; name: string; deleted_at: string }[]) out.push({ table: 'places', id: p.id, label: `Place · ${p.name}`, deletedAt: p.deleted_at, goneOn: gone(p.deleted_at) })
    for (const l of (lots.data ?? []) as { id: string; name: string | null; class: string; head_count: number; deleted_at: string }[]) out.push({ table: 'herd_lots', id: l.id, label: `Bunch · ${l.name ?? l.class} · ${l.head_count} head`, deletedAt: l.deleted_at, goneOn: gone(l.deleted_at) })
    for (const d of (devices.data ?? []) as { id: string; name: string; deleted_at: string }[]) out.push({ table: 'devices', id: d.id, label: `Device · ${d.name}`, deletedAt: d.deleted_at, goneOn: gone(d.deleted_at) })
    for (const e of (events.data ?? []) as { id: string; type: string; ts: string; payload: Record<string, unknown> | null; deleted_at: string }[]) {
      const p = e.payload ?? {}
      const n = typeof p.bales === 'number' ? `${p.bales} bales` : typeof p.head === 'number' ? `${p.head} head` : typeof p.inches === 'number' ? `${p.inches}"` : typeof p.counted === 'number' ? `${p.counted} counted` : ''
      out.push({ table: 'events', id: e.id, label: `Entry · ${e.type.replace(/_/g, ' ')}${n ? ` · ${n}` : ''} · ${e.ts.slice(0, 10)}`, deletedAt: e.deleted_at, goneOn: gone(e.deleted_at) })
    }
  } catch { /* a reader that fails leaves the trash short, never the page broken */ }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}
