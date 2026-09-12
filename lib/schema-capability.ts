import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Does the database have this migration yet? (Block 7D) ────────────────────
//
// TEMPORARY, AND MEANT TO BE DELETED. Migrations are run by hand, so a deploy
// can reach production minutes or days before its SQL does. 059 set the
// pattern — lib/program-alerts.ts treats a missing table as "nothing
// dismissed" — and this is the same idea for two columns the ledger reads on
// every page.
//
// Without 061 (events.deleted_at) every `live` filter would be a 42703 and the
// Activity record, the hay balance and Today would all fail at once. That is a
// far worse outcome than the feature simply not being there yet, so the filter
// is skipped and every entry reads as live — which is exactly true of a
// database where nothing can have been deleted.
//
// Without 062 (places.pinned_at) the Weather list falls back to what it does
// today: every live place, rather than none.
//
// Probed ONCE per process and cached. The answer cannot go from true to false
// in a running process, and when it goes false → true the next deploy (or any
// cold start) picks it up. A probe that itself fails is treated as "not there"
// — the degraded path is always the safe one.
//
// WHEN 061 AND 062 ARE APPLIED, DELETE THIS FILE and the `on` arguments in
// lib/ledger-effective.ts. It has no other purpose.

let eventDeletion: boolean | null = null
let placePin: boolean | null = null

async function probe(supabase: SupabaseClient, table: string, column: string): Promise<boolean> {
  try {
    const { error } = await supabase.from(table).select(column).limit(1)
    return !error
  } catch {
    return false
  }
}

/** True when 061 has been applied — events.deleted_at exists. */
export async function hasEventDeletion(supabase: SupabaseClient): Promise<boolean> {
  if (eventDeletion === null) eventDeletion = await probe(supabase, 'events', 'deleted_at')
  return eventDeletion
}

/** True when 062 has been applied — places.pinned_at exists. */
export async function hasPlacePin(supabase: SupabaseClient): Promise<boolean> {
  if (placePin === null) placePin = await probe(supabase, 'places', 'pinned_at')
  return placePin
}
