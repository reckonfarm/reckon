-- ============================================================
-- 020_operation_profile.sql
-- Ranch operation profile — ONE row per user.
--
-- WHAT THIS IS: user-owned, PRIVATE operation data — the producer's herd
-- groups, crops/acreage, and the county their operation works out of. A
-- producer reads and writes ONLY their own row. Brand-new table; additive
-- only — this migration creates a new table and touches NOTHING else.
--
-- RLS POSTURE — REAL RLS *WITH* POLICIES (a NEW posture for a table here):
--   The snapshot tables (012 cattle, 018 lfp, 019 news) are global/public and
--   use RLS-ON-WITH-NO-POLICIES (deny anon, service-role only). This table is
--   the opposite: private per-user data, so it enables RLS AND adds four
--   owner-scoped policies (select/insert/update/delete, each gated on
--   user_id = auth.uid()). Until now only storage.objects (015) carried
--   table-level policies; this is the first regular table to.
--
-- ⚠️  ACCESS CLIENT — MUST be read/written via the user-scoped SSR/anon client
--   (lib/supabase-server.ts createClient — runs AS the user, respects RLS).
--   The service-role client (lib/supabase.ts createServiceClient) BYPASSES RLS,
--   so using it here silently defeats every policy below. Do not use it for
--   this table.
--
-- THIN BY DESIGN: typed columns only for what we query/filter on (owner +
-- county). The flexible operation detail lives in jsonb payloads (herd, crops),
-- exactly like the snapshot tables store their parsed payload as jsonb. Promote
-- a jsonb field to a typed column only when a query actually needs it.
--
-- Idempotent (create … if not exists; policies guarded by drop-if-exists) and
-- additive — safe to re-run, never destructive.
--
-- Run in the Supabase SQL editor.
-- ============================================================

-- 1) Table -------------------------------------------------------
create table if not exists public.operation_profiles (
  id          uuid        primary key default gen_random_uuid(),
  -- Owner. One profile per user; cascade-deletes with the auth user.
  user_id     uuid        not null references auth.users(id) on delete cascade,
  -- County the operation works out of. Reuses the home-county shape
  -- (profiles.home_county_fips): FIPS string FK to counties.fips, cleared
  -- (not cascaded) if that county row is ever removed. NOT the watchlist
  -- county_id serial.
  county_fips char(5)     references public.counties(fips) on delete set null,
  -- Herd groups: head count, weight class, type, sale window, ownership share,
  -- beginning/veteran flag. Schema-free for now — nullable, no typed internals.
  herd        jsonb       default null,
  -- Crops / acreage the producer carries (feeds the deadline countdown).
  -- Schema-free for now — nullable, no typed internals.
  crops       jsonb       default null,
  created_at  timestamptz not null default now(),
  -- Set by the APP on each write. This repo has no reusable updated_at trigger
  -- function, and this migration deliberately does NOT create one (no side
  -- effects); the SSR write path stamps updated_at = now() itself.
  updated_at  timestamptz not null default now(),
  -- One operation profile per user.
  unique (user_id)
);

-- 2) Index -------------------------------------------------------
-- Owner lookup (every read/write scopes by user_id).
create index if not exists operation_profiles_user_idx
  on public.operation_profiles (user_id);

-- 3) Row Level Security -----------------------------------------
alter table public.operation_profiles enable row level security;

-- Four owner-scoped policies for the authenticated role. Each is dropped first
-- so re-running this migration is idempotent (CREATE POLICY has no IF NOT
-- EXISTS form). A row is the user's own iff user_id = auth.uid().

drop policy if exists "own operation profile readable"  on public.operation_profiles;
create policy "own operation profile readable"
  on public.operation_profiles
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "own operation profile insertable" on public.operation_profiles;
create policy "own operation profile insertable"
  on public.operation_profiles
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own operation profile updatable"  on public.operation_profiles;
create policy "own operation profile updatable"
  on public.operation_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own operation profile deletable"  on public.operation_profiles;
create policy "own operation profile deletable"
  on public.operation_profiles
  for delete to authenticated
  using (user_id = auth.uid());
