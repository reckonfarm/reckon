-- ============================================================
-- 050_lots_to_ranch.sql
-- Block 4A — cattle lots (and the herd value history) belong to the RANCH.
--
-- DEFECT (production ledger audit, 2026-09-07): operation_profiles holds the
-- herd's lots in one row PER USER under `user_id = auth.uid()` policies, so a
-- hand sees no lots — no "Fed to" control — and every ledger line resolves
-- lot NAMES from the caller's own row, so a hand's feeding loses its lot name
-- for everyone. herd_estimate_history has the same shape.
--
-- FIX SHAPE: add ranch_id to both, backfill from the writer's FIRST
-- membership, make the ranch the unit of uniqueness, and replace the
-- user-scoped policies with the 043 membership shape (SELECT / UPDATE /
-- DELETE through ranch_members; INSERT with-check membership AND user_id =
-- auth.uid()). user_id stays as authorship (who last wrote the row), never
-- as a grant.
--
-- DEPLOY ORDER: this file is safe to run BEFORE the 4A code deploys — the old
-- code's upsert (on conflict user_id) keeps working because unique(user_id)
-- is kept for now; the old cron's upsert (user_id, snapshot_date) likewise.
-- A follow-up drops both once the 4A code is live and the cron writes by
-- ranch. Idempotent; re-runnable; needs 034 + 043.
-- ============================================================

-- 0) PRE-FLIGHT — paste the counts back. Measured with the service role on
--    2026-09-07 before writing this file:
--      auth users 10 · ranch_members 4 · users on more than one ranch: 0
--      operation_profiles 3 rows: PK → Kiehl Ranch (1 lot, no county);
--        Test Ranch owner → Test Ranch (2 lots, 30069); the +test scratch
--        account has an EMPTY profile and NO membership → stays ranch_id null
--        (unreachable by any member policy; it is the deliberate negative test)
--      no ranch would receive two profile rows
--      herd_estimate_history 57 rows, one user (PK), 2026-06-17 → 2026-09-04;
--        no (ranch, day) pair with rows from two users; none without membership
select count(*) as profile_rows from public.operation_profiles;
select count(*) as history_rows, count(distinct user_id) as history_users from public.herd_estimate_history;
-- Expect 0 rows: a user with memberships on more than one ranch (backfill picks the first by created_at).
select user_id, count(*) from public.ranch_members group by user_id having count(*) > 1;
-- Expect 0 rows: a ranch that would receive more than one profile row.
select m.ranch_id, count(*) from public.operation_profiles p
  join lateral (select ranch_id from public.ranch_members r where r.user_id = p.user_id order by r.created_at asc limit 1) m on true
  group by m.ranch_id having count(*) > 1;

-- 1) operation_profiles.ranch_id ---------------------------------------------
alter table public.operation_profiles
  add column if not exists ranch_id uuid references public.ranches(id) on delete cascade;

update public.operation_profiles p
   set ranch_id = m.ranch_id
  from lateral (select ranch_id from public.ranch_members r where r.user_id = p.user_id order by r.created_at asc limit 1) m
 where p.ranch_id is null;

-- One herd per ranch. A plain UNIQUE (nulls are distinct, so the membership-less
-- scratch row is allowed) — plain rather than partial so PostgREST's
-- `on_conflict=ranch_id` can infer it. unique(user_id) STAYS until the 4A code is
-- live (the deployed upsert conflicts on it); the follow-up drops it.
alter table public.operation_profiles drop constraint if exists operation_profiles_ranch_uniq;
alter table public.operation_profiles add constraint operation_profiles_ranch_uniq unique (ranch_id);
create index if not exists operation_profiles_ranch_idx on public.operation_profiles (ranch_id);

drop policy if exists "own operation profile readable"   on public.operation_profiles;
drop policy if exists "own operation profile insertable" on public.operation_profiles;
drop policy if exists "own operation profile updatable"  on public.operation_profiles;
drop policy if exists "own operation profile deletable"  on public.operation_profiles;
drop policy if exists "member operation profile readable"   on public.operation_profiles;
drop policy if exists "member operation profile insertable" on public.operation_profiles;
drop policy if exists "member operation profile updatable"  on public.operation_profiles;
drop policy if exists "member operation profile deletable"  on public.operation_profiles;

create policy "member operation profile readable"
  on public.operation_profiles for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

create policy "member operation profile insertable"
  on public.operation_profiles for insert to authenticated
  with check (
    ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
    and user_id = auth.uid()
  );

create policy "member operation profile updatable"
  on public.operation_profiles for update to authenticated
  using      (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()))
  with check (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

create policy "member operation profile deletable"
  on public.operation_profiles for delete to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- 2) herd_estimate_history.ranch_id ------------------------------------------
alter table public.herd_estimate_history
  add column if not exists ranch_id uuid references public.ranches(id) on delete cascade;

update public.herd_estimate_history h
   set ranch_id = m.ranch_id
  from lateral (select ranch_id from public.ranch_members r where r.user_id = h.user_id order by r.created_at asc limit 1) m
 where h.ranch_id is null;

-- One snapshot per ranch per day — a plain UNIQUE (inferable by on_conflict); the
-- old (user_id, snapshot_date) unique stays until the cron writes by ranch, then
-- the follow-up drops it.
alter table public.herd_estimate_history drop constraint if exists herd_estimate_history_ranch_day_uniq;
alter table public.herd_estimate_history add constraint herd_estimate_history_ranch_day_uniq unique (ranch_id, snapshot_date);
create index if not exists herd_estimate_history_ranch_idx
  on public.herd_estimate_history (ranch_id, snapshot_date desc);

drop policy if exists "own herd estimate history readable"    on public.herd_estimate_history;
drop policy if exists "member herd estimate history readable" on public.herd_estimate_history;
create policy "member herd estimate history readable"
  on public.herd_estimate_history for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));
-- (still no client INSERT / UPDATE / DELETE: the cron writes with the service role)

-- 3) Verify (paste back) -----------------------------------------------------
-- (a) Expect: every profile whose user has a membership carries ranch_id
--     (2 stamped, 1 null = the membership-less scratch profile); every history
--     row stamped (57).
select count(*) filter (where ranch_id is not null) as profiles_stamped,
       count(*) filter (where ranch_id is null)     as profiles_unscoped
  from public.operation_profiles;
select count(*) filter (where ranch_id is not null) as history_stamped,
       count(*) filter (where ranch_id is null)     as history_unscoped
  from public.herd_estimate_history;
-- (b) Expect exactly 4 "member …" policies on operation_profiles ({authenticated}),
--     1 on herd_estimate_history, and NO policy whose qual mentions user_id = auth.uid() alone.
-- (c) Expect the two unique constraints.
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conname in ('operation_profiles_ranch_uniq', 'herd_estimate_history_ranch_day_uniq');
select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public' and tablename in ('operation_profiles', 'herd_estimate_history')
 order by tablename, cmd, policyname;
