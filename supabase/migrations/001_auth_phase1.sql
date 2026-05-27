-- ============================================================
-- 001_auth_phase1.sql
-- Adds operations table and migrates user_watchlist to real auth.
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1. Operations table (one per user for now)
create table if not exists public.operations (
  id         serial   primary key,
  user_id    uuid     not null references auth.users (id) on delete cascade,
  name       text     not null,
  created_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists operations_user_idx on public.operations (user_id);

-- 2. Null out all existing anonymous watchlist rows.
--    Every existing user_id is a localStorage UUID — none exist in auth.users.
update public.user_watchlist set user_id = null;

-- 3. Drop NOT NULL so the column can hold null (anonymous rows stay as null).
alter table public.user_watchlist
  alter column user_id drop not null;

-- 4. Add FK to auth.users (nulls are allowed; only non-null values are enforced).
alter table public.user_watchlist
  add constraint user_watchlist_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;
