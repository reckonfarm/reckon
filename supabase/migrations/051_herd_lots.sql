-- ============================================================
-- 051_herd_lots.sql
-- Block 4B — cattle lots become real rows.
--
-- REVERSES the 023 decision (lots as typed jsonb on operation_profiles.herd) on
-- PK's call, 2026-09-07, while the herd is three lots: a blob edited by two
-- members is last-writer-wins on the WHOLE herd (the shared-attribution defect
-- class 4A just fixed), a lot cannot carry its own history or be retired, and
-- events.payload.herd_lot_id cannot be a foreign key. One row per lot fixes
-- all three: two members editing DIFFERENT lots touch different rows, and a
-- same-lot edit is guarded by updated_at (the route compares what the editor
-- last saw and answers 409 on a stale write).
--
-- Rows are RETIRED, never deleted, by clients: a lot the ledger has fed stays
-- resolvable forever (retired_at set; reads filter it out). Only the service
-- role deletes (test teardown, cascade on ranch delete).
--
-- RLS: the 043 membership shape. SELECT / UPDATE through ranch_members; INSERT
-- with-check membership AND created_by = auth.uid(); NO client DELETE policy.
--
-- Backfill: every lot in every ranch-scoped blob becomes a row with its existing
-- id (pre-flight: all three ids are uuids, every herd_lot_id the ledger references
-- is among them). The blob column stays untouched — the code deployed BEFORE 4B
-- keeps reading it; 4B's code reads the rows; a follow-up nulls the blob.
--
-- Idempotent, additive, order-independent (needs 034 + 050). Run in the SQL
-- editor AFTER the dry run (scripts/dry-run-migration.ts).
-- ============================================================

-- 0) PRE-FLIGHT (paste back) — measured with the service role 2026-09-07:
--      3 lots across 2 ranch-scoped blobs (Kiehl 1, Test Ranch 2), all uuid ids,
--      uniform keys; 30 hay_fed events, 24 carry herd_lot_id, 3 distinct ids, 0 unknown.
--    Expect: lots_in_blobs = 3; non_uuid_ids = 0; referenced_ids_missing = 0.
select count(*) as lots_in_blobs
  from public.operation_profiles p, jsonb_array_elements(coalesce(p.herd->'lots', '[]'::jsonb)) l
 where p.ranch_id is not null;
select count(*) as non_uuid_ids
  from public.operation_profiles p, jsonb_array_elements(coalesce(p.herd->'lots', '[]'::jsonb)) l
 where p.ranch_id is not null
   and (l->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
select count(distinct e.payload->>'herd_lot_id') as referenced_ids_missing
  from public.events e
 where e.type = 'hay_fed' and e.payload->>'herd_lot_id' is not null
   and not exists (
     select 1 from public.operation_profiles p, jsonb_array_elements(coalesce(p.herd->'lots', '[]'::jsonb)) l
      where l->>'id' = e.payload->>'herd_lot_id');

-- 1) The table ---------------------------------------------------------------
create table if not exists public.herd_lots (
  id            uuid        primary key default gen_random_uuid(),
  ranch_id      uuid        not null references public.ranches(id) on delete cascade,
  class         text        not null,
  name          text,                                   -- what the producer calls the bunch; null = the class label
  head_count    integer     not null,
  avg_weight    numeric(8,2) not null,
  weight_unit   text        not null default 'lb',
  frame         text        not null default 'Medium and Large',
  weaned        boolean     not null default true,
  sale_windows  jsonb       not null default '[]'::jsonb,
  created_by    uuid        references auth.users(id) on delete set null,   -- authorship, never a grant
  updated_by    uuid        references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),    -- the optimistic-concurrency token; bumped by trigger
  retired_at    timestamptz,                            -- set instead of deleting; the ledger keeps resolving the name
  retired_by    uuid        references auth.users(id) on delete set null,
  constraint herd_lots_class_check       check (class in ('steers', 'heifers', 'yearlings', 'cows', 'bulls', 'old_cows')),
  constraint herd_lots_name_len_check    check (name is null or char_length(name) <= 40),
  constraint herd_lots_head_check        check (head_count > 0),
  constraint herd_lots_weight_check      check (avg_weight > 0),
  constraint herd_lots_unit_check        check (weight_unit in ('lb', 'cwt')),
  constraint herd_lots_frame_check       check (frame in ('Large', 'Medium and Large', 'Medium', 'Small')),
  constraint herd_lots_windows_check     check (jsonb_typeof(sale_windows) = 'array')
);

create index if not exists herd_lots_ranch_live_idx on public.herd_lots (ranch_id) where retired_at is null;
create index if not exists herd_lots_ranch_idx      on public.herd_lots (ranch_id, created_at);

-- updated_at is the concurrency token: the database bumps it on every UPDATE so a
-- client cannot forget to.
create or replace function public.herd_lots_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists herd_lots_touch_updated_at on public.herd_lots;
create trigger herd_lots_touch_updated_at
  before update on public.herd_lots
  for each row execute function public.herd_lots_touch_updated_at();

-- 2) RLS — membership is the gate (043 shape); no client DELETE ----------------
alter table public.herd_lots enable row level security;
drop policy if exists "member herd lots readable"   on public.herd_lots;
drop policy if exists "member herd lots insertable" on public.herd_lots;
drop policy if exists "member herd lots updatable"  on public.herd_lots;

create policy "member herd lots readable"
  on public.herd_lots for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

create policy "member herd lots insertable"
  on public.herd_lots for insert to authenticated
  with check (
    ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
    and created_by = auth.uid()
  );

create policy "member herd lots updatable"
  on public.herd_lots for update to authenticated
  using      (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()))
  with check (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- 3) Backfill — every lot in every ranch-scoped blob, keeping its id ---------
insert into public.herd_lots (id, ranch_id, class, name, head_count, avg_weight, weight_unit, frame, weaned, sale_windows, created_by, updated_by, created_at, updated_at)
select (l->>'id')::uuid,
       p.ranch_id,
       l->>'class',
       nullif(btrim(l->>'name'), ''),
       (l->>'head_count')::integer,
       (l->>'avg_weight')::numeric,
       coalesce(l->>'weight_unit', 'lb'),
       coalesce(l->>'frame', 'Medium and Large'),
       coalesce((l->>'weaned')::boolean, true),
       coalesce(l->'sale_windows', '[]'::jsonb),
       p.user_id, p.user_id,
       coalesce((l->>'created_at')::timestamptz, now()),
       coalesce((l->>'updated_at')::timestamptz, now())
  from public.operation_profiles p, jsonb_array_elements(coalesce(p.herd->'lots', '[]'::jsonb)) l
 where p.ranch_id is not null
on conflict (id) do nothing;

-- 4) Verify (paste back) -----------------------------------------------------
-- (a) Expect 3 rows, none retired, ids matching the blobs' ids.
select count(*) as lots, count(*) filter (where retired_at is not null) as retired from public.herd_lots;
select h.ranch_id, h.id, h.class, h.name, h.head_count, h.avg_weight, h.weight_unit from public.herd_lots h order by h.ranch_id, h.created_at;
-- (b) Expect 3 policies (SELECT / INSERT / UPDATE, {authenticated}) and NO delete.
select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'herd_lots' order by cmd;
-- (c) Expect 0: a referenced lot the table does not hold.
select count(distinct e.payload->>'herd_lot_id') as referenced_ids_missing
  from public.events e
 where e.type = 'hay_fed' and e.payload->>'herd_lot_id' is not null
   and not exists (select 1 from public.herd_lots h where h.id::text = e.payload->>'herd_lot_id');
