-- ============================================================
-- 049_invitations.sql
-- Phase A2 — the invite flow.
--
-- THE SECURITY SHAPE (043): ranch_members is the grant itself — every ledger
-- policy resolves through it. It keeps NO client INSERT / UPDATE / DELETE
-- policy, ever. Membership is written only by service-role routes after a
-- server validates an invite token. This file adds the invitations table
-- that those routes validate against, and constrains the two roles.
--
-- invitations: one row per invite. token_hash stores a SHA-256 of the token,
-- never the token — a database read must not yield a working invite. RLS on,
-- ONE policy: a member of the ranch can read that ranch's invitations. No
-- client write policy of any kind; all writes are service-role.
--
-- Idempotent, additive, order-independent (needs 034's ranches +
-- ranch_members). Run in the Supabase SQL editor.
-- ============================================================

-- 0) Pre-flight — expect 0 rows: every membership already holds one of the two roles
--    (verified 2026-09-06: Kiehl Ranch owner+member, Test Ranch owner+member).
select ranch_id, user_id, role from public.ranch_members where role not in ('owner', 'member');

-- 1) The two roles, now constrained (ranch_members.role was free text; nothing read it).
alter table public.ranch_members drop constraint if exists ranch_members_role_check;
alter table public.ranch_members add constraint ranch_members_role_check check (role in ('owner', 'member'));

-- 2) invitations -------------------------------------------------------------
create table if not exists public.invitations (
  id             uuid        primary key default gen_random_uuid(),
  ranch_id       uuid        not null references public.ranches(id) on delete cascade,
  invited_email  text        not null,
  role           text        not null default 'member',
  token_hash     text        not null,                       -- sha256 hex of the token; the token itself is never stored
  created_by     uuid        not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '7 days',
  accepted_at    timestamptz,
  accepted_by    uuid        references auth.users(id) on delete set null,
  revoked_at     timestamptz,
  constraint invitations_role_check        check (role in ('owner', 'member')),
  constraint invitations_email_normalized  check (invited_email = lower(btrim(invited_email)) and position('@' in invited_email) > 1),
  constraint invitations_token_hash_unique unique (token_hash)
);

-- One OPEN invite per person per ranch.
create unique index if not exists invitations_one_open_per_person
  on public.invitations (ranch_id, invited_email)
  where accepted_at is null and revoked_at is null;

create index if not exists invitations_ranch_idx on public.invitations (ranch_id);

alter table public.invitations enable row level security;

drop policy if exists "member invitations readable" on public.invitations;
create policy "member invitations readable"
  on public.invitations for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- 3) Verify (paste back) -----------------------------------------------------
-- (a) Expect exactly ONE row for invitations (SELECT, {authenticated}) and, for
--     ranch_members, exactly ONE row: the 034 "own membership readable" SELECT.
--     No INSERT / UPDATE / DELETE on either table — if any appears, stop.
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename in ('invitations', 'ranch_members')
order by tablename, cmd, policyname;

-- (b) Expect the partial unique index and the role constraint.
select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'invitations' order by indexname;
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.ranch_members'::regclass and conname = 'ranch_members_role_check';
