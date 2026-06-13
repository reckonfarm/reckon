import 'server-only'

import { createClient } from './supabase-server'

// ─── Operation profile service (read/write path) ─────────────────────────────────
//
// User-owned, PRIVATE operation data (migration 020 — operation_profiles). One row
// per user: their herd groups, crops/acreage, and the county the operation works out
// of. A producer reads and writes ONLY their own row.
//
// ⚠️  CLIENT — DELIBERATE EXCEPTION TO HOUSE STYLE. This module uses the user-scoped
//   SSR client (lib/supabase-server.ts createClient — the cookie-bound @supabase/ssr
//   client that runs AS the signed-in user and RESPECTS RLS). It does NOT use the
//   service-role createServiceClient() that every other service in this repo uses.
//   The four RLS policies on operation_profiles (user_id = auth.uid()) ARE the access
//   control — so reads/writes carry no manual .eq('user_id', …) filter; the policy
//   scopes every query to the caller's own row. Service-role would bypass the policies
//   and silently defeat them. If you reach for createServiceClient here, that's the bug.
//
// HONEST RESULT (mirrors the discriminated, never-fabricate posture of
// lib/cattle-market-service.ts):
//   • signed-out / no session          → { status: 'unauthenticated' }
//   • signed-in, nothing entered yet    → { status: 'empty' }   (row absent, OR a row
//                                          exists but herd AND crops are both null)
//   • signed-in, real data present      → { status: 'ok', profile }
//   • read/write error                  → { status: 'data_unavailable' }
// 'empty' is never treated as a complete profile, and no values are ever invented for it.

// jsonb payloads (herd, crops) are schema-free for now (see migration 020) — typed as
// generic JSON until a query needs a field promoted to a typed column.
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface OperationProfile {
  id:          string
  user_id:     string
  county_fips: string | null
  herd:        Json
  crops:       Json
  created_at:  string
  updated_at:  string
}

// Caller-settable fields ONLY. user_id is taken from the session, never from input.
export interface OperationProfileInput {
  county_fips?: string | null
  herd?:        Json
  crops?:       Json
}

export type GetOperationProfileResult =
  | { status: 'ok'; profile: OperationProfile }
  | { status: 'empty' }
  | { status: 'unauthenticated' }
  | { status: 'data_unavailable' }

export type UpsertOperationProfileResult =
  | { status: 'ok'; profile: OperationProfile }
  | { status: 'unauthenticated' }
  | { status: 'data_unavailable' }

const PROFILE_COLUMNS = 'id, user_id, county_fips, herd, crops, created_at, updated_at'

// A row counts as "nothing entered yet" when both jsonb payloads are empty — so a
// freshly-created shell (or a row that only ever held a county) reads as 'empty', never
// as a complete profile.
function isEmptyProfile(p: OperationProfile): boolean {
  return p.herd == null && p.crops == null
}

// ─── Read ─────────────────────────────────────────────────────────────────────────
// RLS scopes the SELECT to the caller's own row automatically (unique user_id ⇒ at
// most one visible row), so there is no manual owner filter here on purpose.
export async function getOperationProfile(): Promise<GetOperationProfileResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'unauthenticated' }

  const { data, error } = await supabase
    .from('operation_profiles')
    .select(PROFILE_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[operation-profile] read failed:', error.message)
    return { status: 'data_unavailable' }
  }

  const profile = data as OperationProfile | null
  if (!profile || isEmptyProfile(profile)) return { status: 'empty' }

  return { status: 'ok', profile }
}

// ─── Write ──────────────────────────────────────────────────────────────────────
// Inserts-or-updates the caller's single row. user_id comes from the SESSION (the
// caller cannot set it); updated_at is stamped here because the table has no trigger.
// Only county_fips / herd / crops are writable, and only the keys actually present in
// `input` are written — so a PATCH of just `herd` leaves crops/county_fips untouched.
export async function upsertOperationProfile(
  input: OperationProfileInput,
): Promise<UpsertOperationProfileResult> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'unauthenticated' }

  // Build the payload from the session id + only the provided writable keys. user_id
  // is bound from auth, never from input — the conflict target, so the upsert resolves
  // to UPDATE on the caller's existing row (or INSERT their first one). RLS's WITH CHECK
  // (user_id = auth.uid()) is the backstop: a mismatched user_id would be rejected.
  const payload: Record<string, unknown> = {
    user_id:    user.id,
    updated_at: new Date().toISOString(),
  }
  if ('county_fips' in input) payload.county_fips = input.county_fips
  if ('herd'        in input) payload.herd        = input.herd
  if ('crops'       in input) payload.crops       = input.crops

  const { data, error } = await supabase
    .from('operation_profiles')
    .upsert(payload, { onConflict: 'user_id' })
    .select(PROFILE_COLUMNS)
    .maybeSingle()

  if (error || !data) {
    console.error('[operation-profile] upsert failed:', error?.message ?? 'no row returned')
    return { status: 'data_unavailable' }
  }

  return { status: 'ok', profile: data as OperationProfile }
}
