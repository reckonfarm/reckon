-- ============================================================
-- 034_ranch_scope.sql
-- Ranch scoping — one outfit, one shared ledger. Dryline sells to ranches,
-- not individuals: everyone on a ranch sees every device, event, and place
-- on that ranch, no exceptions. Executed now while the ledger holds 2
-- devices / 18 events / 0 places — the cheapest this migration will ever be.
--
-- WHAT THIS ADDS (and nothing else):
--   • ranches       — one row per outfit.
--   • ranch_members — (ranch_id, user_id) + role + alert_prefs jsonb. Adding
--     a person is ONE INSERT here. No invite UI, no ranch switcher, no roles
--     LOGIC tonight — `role` is seed data no code reads yet; alert_prefs is
--     the parking spot for the later per-person notification session.
--   • ranch_id (nullable) on devices / events / places + the transition RLS.
--
-- ranch_id goes on events DIRECTLY, not inherited through device_id: that FK
-- is ON DELETE SET NULL, so an orphaned event has nothing to inherit from.
--
-- TRANSITION POSTURE (deliberate, temporary):
--   • ranch_id is NULLABLE everywhere — no NOT NULL in this pass. Every
--     policy therefore keeps the 031 owner leg OR'd with the ranch leg, so
--     unstamped rows stay visible to their owner. Tightening (NOT NULL,
--     dropping the owner leg, dedup index → (ranch_id, dedup_key)) is a
--     LATER migration, after the transition proves out.
--   • events stay APPEND-ONLY for clients: select + insert policies only,
--     exactly 031's tamper-resistant posture. Still no update/delete.
--   • The OR'd INSERT with check means a member can insert ledger rows
--     carrying another member's user_id within their own ranch — accepted:
--     within-outfit trust, and hardware writes come through the service-role
--     ingest route anyway. user_id's meaning shifts from "visible-to" to
--     "recorded-by"; ranch_id is now the visibility scope.
--
-- ⚠️  THE SILENT-EMPTY-APP TRAP (do not remove "own membership readable"):
--   the ranch legs below subquery public.ranch_members, and policy subqueries
--   run AS THE QUERYING USER, subject to ranch_members' OWN RLS. Without the
--   self-read policy that subquery returns zero rows for everyone and every
--   ledger surface goes dark — empty, not erroring. If /devices ever renders
--   blank for a signed-in owner, check that policy FIRST.
--
-- ⚠️  ACCESS CLIENTS: unchanged. User surfaces read via the user-scoped SSR
--   client (lib/supabase-server.ts) with NO user_id filters — the policy IS
--   the scope, which is why this file is almost the whole feature. Ingest and
--   the alert cron write via the service-role client, bypassing RLS; ingest
--   learns to stamp ranch_id in the companion code commit, alert-service in a
--   deferred later session (its rows stay ranch_id null → owner-visible only).
--
-- Idempotent (create … if not exists; add column if not exists; policies
-- drop-guarded under old AND new names; seed/backfill conflict- and
-- null-guarded), additive only, non-orphaning (ranch FKs default NO ACTION —
-- deleting an outfit that still owns ledger rows must be a deliberate
-- multi-step act, never a silent unscoping; memberships cascade with their
-- ranch and with their auth.users row per the §4 instant-total-delete
-- promise), and order-independent (depends only on 031's tables + auth.users;
-- re-runnable at any time). devices_bak_20260802 / events_bak_20260802 /
-- places_bak_20260802 are UNTOUCHED.
--
-- Run in the Supabase SQL editor.
-- ============================================================

-- 1) ranches -----------------------------------------------------
create table if not exists public.ranches (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  created_at  timestamptz not null default now()
);

-- 2) ranch_members -----------------------------------------------
create table if not exists public.ranch_members (
  ranch_id    uuid        not null references public.ranches(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  -- 'owner' | 'member' | … — text, NOT an enum; no code reads this yet.
  role        text        not null default 'member',
  -- Per-person notification preferences land here in the later alerts
  -- session; '{}' until then.
  alert_prefs jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  primary key (ranch_id, user_id)
);

-- The policy subqueries below filter this table by user_id; the composite PK
-- leads on ranch_id and doesn't serve that lookup.
create index if not exists ranch_members_user_idx on public.ranch_members (user_id);

-- 3) ranch_id on the ledger --------------------------------------
alter table public.devices add column if not exists ranch_id uuid references public.ranches(id);
alter table public.events  add column if not exists ranch_id uuid references public.ranches(id);
alter table public.places  add column if not exists ranch_id uuid references public.ranches(id);

create index if not exists devices_ranch_idx on public.devices (ranch_id);
create index if not exists places_ranch_idx  on public.places  (ranch_id);
-- Mirrors 031's events_user_ts_idx: the ranch-wide Activity feed is this
-- exact scan (ranch, newest first).
create index if not exists events_ranch_ts_idx on public.events (ranch_id, ts desc);

-- 4) Seed + backfill ---------------------------------------------
-- Fixed literal id (not gen_random_uuid()) so re-running can never mint a
-- second Kiehl Ranch.
insert into public.ranches (id, name)
values ('b5a0c9d4-7e31-4b8a-9f26-3c1d8e5a7f90', 'Kiehl Ranch')
on conflict (id) do nothing;

-- Membership seed — exactly two of the eight auth.users rows, per PK:
--   7c3aeaf8… kiehl.preston@gmail.com  (owner)
--   cdf21907… kiehlpatti@gmail.com     (member)
-- kiehl.preston+test@gmail.com (7622c25b…) is DELIBERATELY excluded — it is
-- the standing negative test: signed in, it must see none of this ranch.
insert into public.ranch_members (ranch_id, user_id, role) values
  ('b5a0c9d4-7e31-4b8a-9f26-3c1d8e5a7f90', '7c3aeaf8-a6b1-4fa1-a4c2-ee79abc0a1a4', 'owner'),
  ('b5a0c9d4-7e31-4b8a-9f26-3c1d8e5a7f90', 'cdf21907-d0c9-482d-bcc2-56229d48a235', 'member')
on conflict (ranch_id, user_id) do nothing;

-- Stamp the existing ledger (every live row belongs to 7c3aeaf8…, verified in
-- recon 2026-08-02). ranch_id-null-guarded so re-runs and later rows are
-- untouched; places is empty today but the statement keeps the file complete
-- and re-runnable. updated_at deliberately not bumped on devices — this is
-- scoping metadata, not a user edit.
update public.devices set ranch_id = 'b5a0c9d4-7e31-4b8a-9f26-3c1d8e5a7f90'
  where user_id = '7c3aeaf8-a6b1-4fa1-a4c2-ee79abc0a1a4' and ranch_id is null;
update public.events  set ranch_id = 'b5a0c9d4-7e31-4b8a-9f26-3c1d8e5a7f90'
  where user_id = '7c3aeaf8-a6b1-4fa1-a4c2-ee79abc0a1a4' and ranch_id is null;
update public.places  set ranch_id = 'b5a0c9d4-7e31-4b8a-9f26-3c1d8e5a7f90'
  where user_id = '7c3aeaf8-a6b1-4fa1-a4c2-ee79abc0a1a4' and ranch_id is null;

-- 5) RLS — new tables --------------------------------------------
-- Members may read their own ranch row; nothing user-facing writes either
-- table (membership management is a hand INSERT / service-role concern).
alter table public.ranches enable row level security;

drop policy if exists "member ranches readable" on public.ranches;
create policy "member ranches readable"
  on public.ranches for select to authenticated
  using (id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- THE load-bearing policy (see header trap note): every ranch leg below runs
-- its subquery under THIS table's RLS. Self-read only — a member sees their
-- own membership rows, not the roster; roster UI is a later concern.
alter table public.ranch_members enable row level security;

drop policy if exists "own membership readable" on public.ranch_members;
create policy "own membership readable"
  on public.ranch_members for select to authenticated
  using (user_id = auth.uid());

-- 6) RLS — transition policies on the ledger ---------------------
-- Replaces all ten 031 policies. Same shape everywhere:
--   owner leg (user_id = auth.uid())  — keeps nullable-ranch_id rows visible
--   OR ranch leg (ranch_id in my memberships) — the new shared scope.
-- Old "own …" names dropped alongside the new names so the file is
-- idempotent whether it runs after 031 or after itself.

-- places: full ranch-scoped CRUD (was owner-scoped CRUD).
drop policy if exists "own places readable"    on public.places;
drop policy if exists "ranch places readable"  on public.places;
create policy "ranch places readable"
  on public.places for select to authenticated
  using (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

drop policy if exists "own places insertable"   on public.places;
drop policy if exists "ranch places insertable" on public.places;
create policy "ranch places insertable"
  on public.places for insert to authenticated
  with check (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

drop policy if exists "own places updatable"   on public.places;
drop policy if exists "ranch places updatable" on public.places;
create policy "ranch places updatable"
  on public.places for update to authenticated
  using (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()))
  with check (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

drop policy if exists "own places deletable"   on public.places;
drop policy if exists "ranch places deletable" on public.places;
create policy "ranch places deletable"
  on public.places for delete to authenticated
  using (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- devices: full ranch-scoped CRUD — a member can rename or reassign the
-- outfit's hardware, not just see it.
drop policy if exists "own devices readable"    on public.devices;
drop policy if exists "ranch devices readable"  on public.devices;
create policy "ranch devices readable"
  on public.devices for select to authenticated
  using (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

drop policy if exists "own devices insertable"   on public.devices;
drop policy if exists "ranch devices insertable" on public.devices;
create policy "ranch devices insertable"
  on public.devices for insert to authenticated
  with check (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

drop policy if exists "own devices updatable"   on public.devices;
drop policy if exists "ranch devices updatable" on public.devices;
create policy "ranch devices updatable"
  on public.devices for update to authenticated
  using (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()))
  with check (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

drop policy if exists "own devices deletable"   on public.devices;
drop policy if exists "ranch devices deletable" on public.devices;
create policy "ranch devices deletable"
  on public.devices for delete to authenticated
  using (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- events: ranch-scoped read + insert ONLY — the ledger stays append-only for
-- clients (031/026 posture); corrections are NEW events, never rewrites.
drop policy if exists "own events readable"   on public.events;
drop policy if exists "ranch events readable" on public.events;
create policy "ranch events readable"
  on public.events for select to authenticated
  using (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

drop policy if exists "own events insertable"   on public.events;
drop policy if exists "ranch events insertable" on public.events;
create policy "ranch events insertable"
  on public.events for insert to authenticated
  with check (user_id = auth.uid()
     or ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));
