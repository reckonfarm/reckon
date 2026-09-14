-- ============================================================
-- 065_trash.sql
-- Block 12 (12.4) — deleted things go to a trash for 7 days, then gone.
--
-- PK's ruling: "Deleted things go to a trash for 7 days, then gone for good.
-- I never see the trash unless I go looking." Today only events have a place
-- to go (061's deleted_at). Places and lots are RETIRED — a different state:
-- out of the pickers, still on the ranch, restorable with one tap and meant
-- to be — and devices are hard-deleted through the service role, which is the
-- one thing a trash forbids.
--
-- So the three tables gain the same two columns events already carry, with
-- the same meaning: deleted_at set = in the trash, invisible everywhere except
-- /account/trash; null = live. Retirement is untouched and stays what it is.
--
-- WHAT RESTORING RESTORES. Clearing deleted_at. That is the whole of it for a
-- place, a lot or a device — their history never left, because every event
-- that named them still names them. For a group action it is also the head
-- counts, and that is migration 066's job (the head-count projection): this
-- file gives the trash a floor, 066 makes the cattle numbers follow it.
--
-- PURGE. purge_trash(days) hard-deletes anything whose deleted_at is older
-- than the window, in dependency order, through the same cascade rules 8B
-- established for places and devices. SECURITY DEFINER on purpose and
-- deliberately: it is called by the cron with the service role and by nothing
-- else; execute is revoked from every client role, so no session can reach it.
-- It reports what it removed so the cron result says so.
--
-- READ POLICIES ARE NOT CHANGED HERE. The application filters deleted_at the
-- way it already filters events (lib/ledger-effective live()); a trash row is
-- readable by its ranch so that /account/trash can list it and restore it.
--
-- Idempotent, additive, order-independent (needs 031, 051, 056, 061).
-- Validate with scripts/migrate-local.ts, then run in the SQL editor.
-- ============================================================

-- 0) PRE-FLIGHT (paste back) — expect three zeros: nothing is already in a trash.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'places'    and column_name = 'deleted_at') as places_has_col,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'herd_lots' and column_name = 'deleted_at') as lots_has_col,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'devices'   and column_name = 'deleted_at') as devices_has_col;

-- 1) The trash columns, same shape as 061 ------------------------------------
alter table public.places
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.herd_lots
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.devices
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

comment on column public.places.deleted_at    is 'Block 12: in the trash since. Null = live. Retired is a different state (retired_at).';
comment on column public.herd_lots.deleted_at is 'Block 12: in the trash since. Null = live. Retired is a different state (retired_at).';
comment on column public.devices.deleted_at   is 'Block 12: in the trash since. Null = live. Devices are no longer hard-deleted by clients.';

-- Live reads stay cheap: the live rows are the index, the trash is the exception.
create index if not exists places_ranch_live_idx    on public.places    (ranch_id) where deleted_at is null;
create index if not exists herd_lots_ranch_trash_idx on public.herd_lots (ranch_id) where deleted_at is null;
create index if not exists devices_ranch_live_idx   on public.devices   (ranch_id) where deleted_at is null;

-- 2) The purge --------------------------------------------------------------
-- Dependency order matters: an event in the trash may name a place or a lot
-- also in the trash; a device in the trash may own events. Events first, then
-- devices, then lots, then places — the reverse of how they refer to each other.
create or replace function public.purge_trash(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cut     timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_events  integer := 0;
  v_devices integer := 0;
  v_lots    integer := 0;
  v_places  integer := 0;
begin
  with gone as (delete from public.events    where deleted_at is not null and deleted_at < v_cut returning 1) select count(*) into v_events  from gone;
  with gone as (delete from public.devices   where deleted_at is not null and deleted_at < v_cut returning 1) select count(*) into v_devices from gone;
  with gone as (delete from public.herd_lots where deleted_at is not null and deleted_at < v_cut returning 1) select count(*) into v_lots    from gone;
  with gone as (delete from public.places    where deleted_at is not null and deleted_at < v_cut returning 1) select count(*) into v_places  from gone;
  return jsonb_build_object('cutoff', v_cut, 'events', v_events, 'devices', v_devices, 'lots', v_lots, 'places', v_places);
end $$;

comment on function public.purge_trash is
  'Block 12 (12.4): hard-deletes trash older than p_days, in dependency order. Cron-only: execute is revoked from every client role.';

revoke all on function public.purge_trash(integer) from public;
revoke all on function public.purge_trash(integer) from anon;
revoke all on function public.purge_trash(integer) from authenticated;

-- 3) Verify (paste back) -------------------------------------------------------
-- (a) Three tables, two columns each.
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name in ('places', 'herd_lots', 'devices') and column_name in ('deleted_at', 'deleted_by')
 order by table_name, column_name;

-- (b) The purge exists, is DEFINER (by design, see header), and no client role may execute it.
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'purge_trash';
select grantee, privilege_type
  from information_schema.role_routine_grants
 where routine_schema = 'public' and routine_name = 'purge_trash'
 order by grantee;

-- (c) Nothing was moved: every row still live.
select
  (select count(*) from public.places    where deleted_at is not null) as places_in_trash,
  (select count(*) from public.herd_lots where deleted_at is not null) as lots_in_trash,
  (select count(*) from public.devices   where deleted_at is not null) as devices_in_trash;
