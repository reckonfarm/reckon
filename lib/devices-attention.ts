import type { SupabaseClient } from '@supabase/supabase-js'

// ─── "Check device" (Block 6A) ────────────────────────────────────────────────
// A Needs-attention row for a device that has a KNOWN expected check-in cadence
// and has missed it. The model holds no cadence today: devices carry a type,
// a last_seen, a battery, and nothing that says how often they are meant to
// report. So the table below is empty on purpose, and this returns no rows —
// "unknown cadence → no row". When a product line gets a cadence (a Sentinel
// on mains that reports hourly, say), it goes here as a fact, not a guess.
export const CHECK_IN_CADENCE_MS: Readonly<Partial<Record<string, number>>> = {}

export interface DeviceAttention { id: string; name: string; type: string; lastSeen: string | null; expectedEveryMs: number }

export async function devicesNeedingAttention(supabase: SupabaseClient): Promise<DeviceAttention[]> {
  const types = Object.keys(CHECK_IN_CADENCE_MS)
  if (types.length === 0) return []
  const { data } = await supabase.from('devices').select('id, name, type, last_seen').in('type', types)
  const now = Date.now()
  return ((data ?? []) as { id: string; name: string; type: string; last_seen: string | null }[])
    .filter(d => { const every = CHECK_IN_CADENCE_MS[d.type]; return every != null && (!d.last_seen || now - Date.parse(d.last_seen) > every) })
    .map(d => ({ id: d.id, name: d.name, type: d.type, lastSeen: d.last_seen, expectedEveryMs: CHECK_IN_CADENCE_MS[d.type]! }))
}
