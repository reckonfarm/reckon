-- ============================================================
-- 072_bunch_place_projection.sql
-- Block 25b — the database decides where a bunch is.
--
-- Block 25 made a move name its bunch and had the record ROUTE set
-- herd_lots.place_id. That was two writes from TypeScript and it could only
-- ever move a bunch FORWARD: void the move, delete it, or correct it onto a
-- different bunch, and the old bunch stayed where the dead move had put it.
--
-- A bunch's place is now a PROJECTION, exactly as its head count is (066/067):
--
--   place_id = the destination of the bunch's latest LIVE move, by the move's
--              own time (ts, then ingested_at) — live meaning not deleted, not
--              voided, not superseded — counting ONLY moves on the bunch's own
--              ranch (067's lesson) and only a place on that same ranch.
--
--   No live move left  →  place_id is NULL. Not the place from before, not a
--   guess (PK, ruling 2). The screen says "no place recorded".
--
-- It is rebuilt by a trigger whenever a cattle_moved row is inserted, deleted,
-- or has deleted_at / voided_at / superseded_by / payload change — for every
-- bunch the change touches. A correction that moves a move from bunch X to
-- bunch Y is two row events: the new row is inserted naming Y (Y rebuilt), and
-- 054 stamps superseded_by on the original naming X (X rebuilt, and loses it).
--
-- A move that names no destination says nothing about where, and is skipped.
--
-- WHAT THIS DOES NOT DO — no backfill. Installing it changes no row. A bunch
-- whose place was set when it was made, and which has never moved, keeps that
-- place until a move of it is written; from then on its moves alone decide.
-- Section 0 lists exactly which bunches that is, so it is a ruling and not a
-- surprise.
--
-- Safe beside Block 25's route write: both apply the same rule, the database
-- simply also handles the cases the route could not. The route's write comes
-- out in the 25b app change, after this is applied.
--
-- Idempotent. Needs 031 (places), 054 (corrections), 065 (trash), 069 (place_id).
-- ============================================================

-- 0) PRE-FLIGHT (paste back) ---------------------------------------------------
-- (a) expect 0: no move names a bunch on another ranch.
select count(*) as cross_ranch_moves
  from public.events e
  join public.herd_lots l on l.id::text = e.payload->>'herd_lot_id'
 where e.type = 'cattle_moved' and e.ranch_id is distinct from l.ranch_id;

-- (b) every bunch that HAS a place today and what stands behind it. A row with
--     live_moves = 0 is a place set when the bunch was made: it stays as it is
--     until that bunch's first move is written.
select l.ranch_id, l.id, l.name, l.class, l.place_id as stored_place,
       (select count(*) from public.events e
         where e.type = 'cattle_moved' and e.ranch_id = l.ranch_id
           and e.payload->>'herd_lot_id' = l.id::text and e.payload->>'to_place_id' is not null
           and e.deleted_at is null and e.voided_at is null and e.superseded_by is null) as live_moves
  from public.herd_lots l
 where l.place_id is not null
 order by l.ranch_id, l.created_at;

-- 1) What the ledger says — read-only, writes nothing -----------------------------
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
       order by e.ts desc, e.ingested_at desc
       limit 1
    ) m on true
    -- The latest live move decides, and only it. If the place it names is gone
    -- or is not this ranch's, the answer is NULL — never the move before it.
    left join public.places p on p.id = m.to_place and p.ranch_id = l.ranch_id
   where l.id = p_lot
$$;

comment on function public.lot_place_from_moves is
  'Block 25b (072): where the ledger says a bunch is — the destination of its latest live cattle_moved, by ts, on the bunch''s own ranch. NULL when no live move remains. Reads only.';

-- 2) The rebuild -------------------------------------------------------------------
create or replace function public.rebuild_lot_place(p_lot uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place uuid;
begin
  if not exists (select 1 from public.herd_lots where id = p_lot) then return null; end if;
  v_place := public.lot_place_from_moves(p_lot);
  update public.herd_lots set place_id = v_place where id = p_lot and place_id is distinct from v_place;
  return v_place;
end $$;

comment on function public.rebuild_lot_place is
  'Block 25b (072): herd_lots.place_id = lot_place_from_moves(). NULL when no live move remains — never the place from before. Trigger-called; never by a client.';

-- 3) The trigger ---------------------------------------------------------------------
create or replace function public.events_project_bunch_place()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot uuid;
begin
  -- Every bunch the change touches: the one the row names now, and — if a row's
  -- payload was rewritten in place — the one it named before. Only bunches on
  -- the row's own ranch do any work (067).
  if tg_op <> 'DELETE' and new.type = 'cattle_moved' then
    v_lot := nullif(new.payload->>'herd_lot_id', '')::uuid;
    if v_lot is not null and exists (select 1 from public.herd_lots l where l.id = v_lot and l.ranch_id = new.ranch_id) then
      perform public.rebuild_lot_place(v_lot);
    end if;
  end if;
  if tg_op <> 'INSERT' and old.type = 'cattle_moved' then
    v_lot := nullif(old.payload->>'herd_lot_id', '')::uuid;
    if v_lot is not null
       and (tg_op = 'DELETE' or v_lot is distinct from nullif(new.payload->>'herd_lot_id', '')::uuid)
       and exists (select 1 from public.herd_lots l where l.id = v_lot and l.ranch_id = old.ranch_id) then
      perform public.rebuild_lot_place(v_lot);
    end if;
  end if;
  return null;
end $$;

comment on function public.events_project_bunch_place is
  'Block 25b (072): after a cattle_moved row is inserted, deleted, or its deleted_at / voided_at / superseded_by / payload changes, rebuild the place of every bunch it names — only bunches on the row''s own ranch. Returns trigger: cannot be called directly.';

drop trigger if exists events_project_bunch_place on public.events;
-- No WHEN clause, as 066: a DELETE trigger's WHEN cannot read NEW. Every other
-- row type returns at once.
create trigger events_project_bunch_place
  after insert or update of deleted_at, voided_at, superseded_by, payload or delete on public.events
  for each row
  execute function public.events_project_bunch_place();

-- No client role may execute any of the three (067's shape).
revoke all on function public.lot_place_from_moves(uuid)       from public, anon, authenticated;
revoke all on function public.rebuild_lot_place(uuid)          from public, anon, authenticated;
revoke all on function public.events_project_bunch_place()     from public, anon, authenticated;

-- 4) Verify (paste back) ----------------------------------------------------------
-- (a) all three DEFINER by design; no client grants on any.
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('lot_place_from_moves', 'rebuild_lot_place', 'events_project_bunch_place') order by 1;
select routine_name, grantee, privilege_type
  from information_schema.role_routine_grants
 where routine_schema = 'public' and routine_name in ('lot_place_from_moves', 'rebuild_lot_place', 'events_project_bunch_place')
 order by 1, 2;

-- (b) the trigger is on, for the right events.
select tgname, pg_get_triggerdef(oid) as definition
  from pg_trigger where tgrelid = 'public.events'::regclass and tgname = 'events_project_bunch_place';

-- (c) NOTHING MOVED. Read-only: stored place beside what the ledger says, for
--     every bunch. 'same' = agree. 'made here, never moved' = a place from when
--     the bunch was made, left alone. Any 'DIFFERS' row is one to look at
--     before the first move of that bunch is written.
select l.ranch_id, l.name, l.class, l.place_id as stored, public.lot_place_from_moves(l.id) as from_moves,
       case when l.place_id is not distinct from public.lot_place_from_moves(l.id) then 'same'
            when public.lot_place_from_moves(l.id) is null then 'made here, never moved'
            else 'DIFFERS' end as reads
  from public.herd_lots l
 where l.deleted_at is null
 order by l.ranch_id, l.created_at;
