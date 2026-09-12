import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase'

// ─── Deleting a thing and everything recorded at it (Block 8B.2) ──────────────
//
// PK's ruling: one decision, both numbers up front, no second prompt, no
// constraint error, and never a place left that cannot be removed.
//
// Every entry goes through the SAME two-path rule 7D.1 established — a clean
// row is hard-deleted, anything in a correction chain keeps its row with a
// deletion record — and the parent deletes once nothing live points at it.
//
// BATCHED, not a loop over lib/deletion.ts. That module re-plans per entry,
// which is right for one tap on one entry and wrong here: a device can carry
// thousands of observations, and asking "has another member seen this" once
// per row would be thousands of round trips to answer a question whose answer
// cannot change during the operation. The classification is identical; only
// the number of queries differs.

export interface CascadeSplit {
  /** Rows that will be removed outright. */
  hard: number
  /** Rows that stay, with who deleted them and when. */
  record: number
  /** Devices that will be detached (their place_id is ON DELETE SET NULL). */
  devices: number
  total: number
}

interface Row {
  id: string
  user_id: string
  supersedes_event_id: string | null
  superseded_by: string | null
  ingested_at: string
}

const COLS = 'id, user_id, supersedes_event_id, superseded_by, ingested_at'

/**
 * Which of these events can be removed outright, and which must keep a record.
 *
 * The "seen by another member" question is asked ONCE for the ranch and then
 * applied to every row, because it is a fact about the ranch's readers rather
 * than about any one entry.
 */
export async function splitEvents(supabase: SupabaseClient, userId: string, ranchId: string, rows: Row[]): Promise<{ hard: string[]; record: string[] }> {
  const db = createServiceClient()
  let latestOtherSeen: string | null = null
  try {
    const { data } = await db.from('ranch_members').select('user_id, last_seen_at').eq('ranch_id', ranchId)
    for (const m of (data ?? []) as { user_id: string; last_seen_at: string | null }[]) {
      if (m.user_id === userId || !m.last_seen_at) continue
      if (!latestOtherSeen || m.last_seen_at > latestOtherSeen) latestOtherSeen = m.last_seen_at
    }
  } catch {
    // Fails CLOSED, exactly as 7D does: unreadable means "assume seen", so
    // nothing is destroyed on the strength of a question we could not ask.
    latestOtherSeen = new Date().toISOString()
  }

  // A row that something else supersedes is in a chain from the other side, so
  // ask the table once rather than trusting the stamped column alone.
  const ids = rows.map(r => r.id)
  const pointedAt = new Set<string>()
  if (ids.length > 0) {
    const { data } = await supabase.from('events').select('supersedes_event_id').in('supersedes_event_id', ids)
    for (const r of (data ?? []) as { supersedes_event_id: string | null }[]) if (r.supersedes_event_id) pointedAt.add(r.supersedes_event_id)
  }

  const hard: string[] = []
  const record: string[] = []
  for (const r of rows) {
    const inChain = !!r.supersedes_event_id || !!r.superseded_by || pointedAt.has(r.id)
    const mine = r.user_id === userId
    const unseen = !latestOtherSeen || r.ingested_at > latestOtherSeen
    if (!inChain && mine && unseen) hard.push(r.id)
    else record.push(r.id)
  }
  return { hard, record }
}

/** Apply the split. Two statements, whatever the size of the cascade. */
export async function applySplit(userId: string, hard: string[], record: string[]): Promise<{ ok: boolean }> {
  const db = createServiceClient()
  if (record.length > 0) {
    const { error } = await db.from('events')
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .in('id', record).is('deleted_at', null)
    if (error) return { ok: false }
  }
  if (hard.length > 0) {
    const { error } = await db.from('events').delete().in('id', hard)
    // A 23503 here would mean the chain check missed something. Rather than
    // surface a constraint error — which PK must never see — fall back to the
    // record path for the whole batch: the entries still leave his view.
    if (error) {
      const { error: back } = await db.from('events')
        .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
        .in('id', hard).is('deleted_at', null)
      if (back) return { ok: false }
    }
  }
  return { ok: true }
}

export { type Row as CascadeRow, COLS as CASCADE_COLS }
