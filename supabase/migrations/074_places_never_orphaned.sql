-- ============================================================
-- 074_places_never_orphaned.sql
-- Block 28 — a place history points at is never hard-deleted.
--
-- Deleting a place is already a trip to the trash (Block 13): DELETE sets
-- deleted_at and nothing else happens, the ten-second Undo puts it back, and
-- the trash page can put it back for seven days. The one hard delete left in
-- the system is purge_trash() at day seven — and it checked nothing. A place
-- that a move, a feeding, a bunch or a child place still points at would
-- have gone for good: the events' place ids would dangle, the bunch's and the
-- children's foreign keys would SET NULL, all without a word.
--
-- Now:
--   1. A REFERENCED place cannot be hard-deleted, by anyone. A BEFORE DELETE
--      trigger turns the delete into a soft delete and skips the row — for the
--      service role and for purge_trash alike (SECURITY DEFINER does not skip
--      triggers). An unreferenced place still goes for good at day seven.
--   2. purge_trash says the same thing in its own WHERE, so its count is
--      honest and it never even tries.
--   3. Where a bunch is (072) reads a trashed place as NO PLACE: the bunch
--      reads "no place recorded" while its place is in the trash, and its
--      place comes back when the place does. The projection is re-run for the
--      ranch's bunches whenever a place enters or leaves the trash.
--   4. The four untyped place ids in an event's payload get indexes, so the
--      reference check is a lookup and not a scan of the ledger.
--
-- REFERENCED means: a live event (deleted_at is null) names it under
-- place_id, from_place_id, to_place_id or stock_place_id; or a live bunch
-- stands there (herd_lots.place_id, deleted_at is null); or a live child place
-- sits inside it (places.parent_id, deleted_at is null). A device standing on
-- it is not history and does not count — the device detaches (031's SET NULL).
--
-- While here, the tie-break in lot_place_from_moves moves from arrival to
-- made-on-phone (073's created_at), as PK ruled: switched the next time one of
-- these functions is rewritten. No backfill; installing this changes no row.
--
-- Idempotent. Needs 065 (trash), 069 (herd_lots.place_id), 072, 073.
-- ============================================================

-- 1) The one predicate -----------------------------------------------------------
create or replace function public.place_is_referenced(p_place uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events e
     where e.deleted_at is null
       and (e.payload->>'place_id' = p_place::text
         or e.payload->>'from_place_id' = p_place::text
         or e.payload->>'to_place_id' = p_place::text
         or e.payload->>'stock_place_id' = p_place::text)
    union all
    select 1 from public.herd_lots l where l.place_id = p_place and l.deleted_at is null
    union all
    select 1 from public.places c where c.parent_id = p_place and c.deleted_at is null and c.id <> p_place
  )
$$;
comment on function public.place_is_referenced is
  'Block 28 (074): true when a live event names the place, a live bunch stands there, or a live child place sits inside it. The one definition of "history points at it".';
revoke all on function public.place_is_referenced(uuid) from public, anon, authenticated;
grant execute on function public.place_is_referenced(uuid) to service_role;   -- the trash page asks it, on the service client

-- 1b) PRE-FLIGHT (paste back) — read through the predicate just defined; writes nothing.
-- (a) places in the trash today, and how many of them something still points at.
select count(*) as trashed_places,
       count(*) filter (where public.place_is_referenced(id)) as trashed_and_referenced
  from public.places where deleted_at is not null;


-- 2) The indexes that make it a lookup ------------------------------------------
create index if not exists events_payload_place_idx       on public.events ((payload->>'place_id'))       where deleted_at is null;
create index if not exists events_payload_from_place_idx  on public.events ((payload->>'from_place_id'))  where deleted_at is null;
create index if not exists events_payload_to_place_idx    on public.events ((payload->>'to_place_id'))    where deleted_at is null;
create index if not exists events_payload_stock_place_idx on public.events ((payload->>'stock_place_id')) where deleted_at is null;

-- 3) The trigger: a referenced place is never hard-deleted --------------------------
create or replace function public.places_never_orphan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.place_is_referenced(old.id) then
    -- Into the trash instead (keeping its trash stamp if it has one), and the
    -- delete itself is skipped. RETURN NULL, never RAISE: purge_trash deletes
    -- in one statement per table, and a raise would abort the whole purge.
    update public.places set deleted_at = coalesce(old.deleted_at, now()), deleted_by = old.deleted_by
     where id = old.id and deleted_at is null;
    return null;
  end if;
  return old;
end $$;
comment on function public.places_never_orphan is
  'Block 28 (074): BEFORE DELETE — a place that history points at is soft-deleted instead and the delete is skipped. Returns trigger: cannot be called directly.';
revoke all on function public.places_never_orphan() from public, anon, authenticated;

drop trigger if exists places_never_orphan on public.places;
create trigger places_never_orphan
  before delete on public.places
  for each row execute function public.places_never_orphan();

-- 4) purge_trash says it too, so its count is honest --------------------------------
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
  v_kept    integer := 0;
begin
  -- Dependency order (065): the events, devices and bunches that point at a
  -- trashed place go first, so a place whose only references were themselves
  -- in the trash is free by the time its turn comes.
  with gone as (delete from public.events    where deleted_at is not null and deleted_at < v_cut returning 1) select count(*) into v_events  from gone;
  with gone as (delete from public.devices   where deleted_at is not null and deleted_at < v_cut returning 1) select count(*) into v_devices from gone;
  with gone as (delete from public.herd_lots where deleted_at is not null and deleted_at < v_cut returning 1) select count(*) into v_lots    from gone;
  -- Block 28: a place history points at stays in the trash, and is counted as kept.
  select count(*) into v_kept from public.places where deleted_at is not null and deleted_at < v_cut and public.place_is_referenced(id);
  with gone as (delete from public.places    where deleted_at is not null and deleted_at < v_cut and not public.place_is_referenced(id) returning 1) select count(*) into v_places from gone;
  return jsonb_build_object('cutoff', v_cut, 'events', v_events, 'devices', v_devices, 'lots', v_lots, 'places', v_places, 'places_kept', v_kept);
end $$;
comment on function public.purge_trash is
  'Block 12 (12.4) + Block 28 (074): hard-deletes trash older than p_days in dependency order — except a place history still points at, which is kept and counted as places_kept. Cron-only: execute is revoked from every client role.';
revoke all on function public.purge_trash(integer) from public, anon, authenticated;
grant execute on function public.purge_trash(integer) to service_role;   -- the cron's role, as 065 intended

-- 5) Where a bunch is: a trashed place is no place; made-on-phone breaks ties ------
create or replace function public.lot_place_from_moves(p_lot uuid)
returns uuid
language sql
-- Left volatile, as rebuild_lot_head is: called from a trigger, it must read the
-- ledger as it stands after the change, never an earlier snapshot.
security definer
set search_path = public
as $$
  select p.id
    from public.herd_lots l
    join lateral (
      select nullif(e.payload->>'to_place_id', '')::uuid as to_place
        from public.events e
       where e.type = 'cattle_moved'
         and e.ranch_id = l.ranch_id
         and e.payload->>'herd_lot_id' = l.id::text
         and nullif(e.payload->>'to_place_id', '') is not null
         and e.deleted_at is null and e.voided_at is null and e.superseded_by is null
       -- Block 27/28: ties by when the move was MADE, not when it arrived.
       order by e.ts desc, e.created_at desc, e.ingested_at desc
       limit 1
    ) m on true
    -- The latest live move decides, and only it. If the place it names is gone,
    -- in the trash, or not this ranch's, the answer is NULL — never the move
    -- before it. When the place comes back from the trash, so does this.
    left join public.places p on p.id = m.to_place and p.ranch_id = l.ranch_id and p.deleted_at is null
   where l.id = p_lot
$$;
comment on function public.lot_place_from_moves is
  'Block 25b (072) + 28 (074): where the ledger says a bunch is — the destination of its latest live cattle_moved (by ts, then created_at), on the bunch''s own ranch, and only while that place is not in the trash. NULL otherwise. Reads only.';
revoke all on function public.lot_place_from_moves(uuid) from public, anon, authenticated;

-- 6) A place entering or leaving the trash re-runs the ranch's bunches -------------
create or replace function public.places_trash_projects_bunch_place()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot uuid;
begin
  if (old.deleted_at is null) = (new.deleted_at is null) then return null; end if;
  for v_lot in select id from public.herd_lots where ranch_id = new.ranch_id and deleted_at is null loop
    perform public.rebuild_lot_place(v_lot);
  end loop;
  return null;
end $$;
comment on function public.places_trash_projects_bunch_place is
  'Block 28 (074): after a place enters or leaves the trash, rebuild the place of every live bunch on its ranch. Returns trigger: cannot be called directly.';
revoke all on function public.places_trash_projects_bunch_place() from public, anon, authenticated;

drop trigger if exists places_trash_projects_bunch_place on public.places;
create trigger places_trash_projects_bunch_place
  after update of deleted_at on public.places
  for each row execute function public.places_trash_projects_bunch_place();

-- 7) Verify (paste back) ------------------------------------------------------------
-- (a) the functions, all definer, no client grants
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('place_is_referenced', 'places_never_orphan', 'purge_trash', 'lot_place_from_moves', 'places_trash_projects_bunch_place') order by 1;
select routine_name, grantee, privilege_type from information_schema.role_routine_grants
 where routine_schema = 'public' and routine_name in ('place_is_referenced', 'places_never_orphan', 'purge_trash', 'lot_place_from_moves', 'places_trash_projects_bunch_place') order by 1, 2;
-- (b) both triggers on places, and the four indexes
select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.places'::regclass and tgname in ('places_never_orphan', 'places_trash_projects_bunch_place') order by 1;
select indexname from pg_indexes where schemaname = 'public' and indexname like 'events_payload_%_idx' order by 1;
-- (c) NOTHING MOVED: every live bunch's stored place agrees with the projection.
select l.ranch_id, l.name, l.place_id as stored, public.lot_place_from_moves(l.id) as from_moves,
       case when l.place_id is not distinct from public.lot_place_from_moves(l.id) then 'same' else 'DIFFERS' end as reads
  from public.herd_lots l where l.deleted_at is null order by l.ranch_id, l.created_at;
-- (d) a dry read of what the next purge would keep: trashed, referenced places.
select id, name, deleted_at from public.places where deleted_at is not null and public.place_is_referenced(id) order by deleted_at;
