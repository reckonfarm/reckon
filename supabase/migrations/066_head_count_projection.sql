-- ============================================================
-- 066_head_count_projection.sql
-- Block 12 (12.6) — a head count is history, and the stored number follows it.
--
-- THE FINDING, twice now: deleting a group action did not put the head count
-- back. AUDIT cows 25 → 9 by a preg check; the preg check deleted; still 9.
-- PK: "Delete has to mean the totals recalculate, or I'll delete something and
-- carry a wrong count all winter."
--
-- WHAT WAS TRUE. herd_lots.head_count was a stored number that two things
-- wrote: the lot form (silently — no ledger row at all) and 063's function
-- (which also recorded head_before / head_after on the event). Twenty-five
-- readers trust the column. Rewriting them to derive at read time is the
-- long-run shape and not this migration.
--
-- WHAT THIS DOES. The column becomes a PROJECTION the database rebuilds from
-- the ledger whenever the ledger changes:
--
--   1. Every head-count change is a row. A new event type, head_count_set
--      {lot_id, head_before, head_after, reason}, written by the lot form on
--      create and on any edit that changes the count (the app side of 12.6),
--      and BACKFILLED here once per existing lot at its current count, dated
--      created_at, so every lot has an anchor.
--   2. rebuild_lot_head(lot) = the latest LIVE head_count_set for the lot,
--      plus the signed deltas of every LIVE group_action after it that names
--      the lot as source (stayed − head_before) or as a result (+head).
--      "Live" is the effective-ledger filter: not deleted, not voided, not
--      superseded — a correction counts, the row it replaced does not.
--   3. A trigger on events calls it for every lot a row names, on INSERT and
--      on UPDATE OF deleted_at / voided_at / superseded_by. Delete a preg
--      check → both lots recalculate. Restore it → they recalculate back.
--      Correct it through 054 → the superseded row stops counting.
--
-- READERS UNTOUCHED. 063/064's compare-and-set still reads the column. A
-- group action whose destination it CREATED, deleted → that lot rebuilds to
-- 0 and stays live (ruling: zero is a real state).
--
-- SECURITY. The trigger function runs as the table owner, as triggers do;
-- rebuild_lot_head is SECURITY DEFINER because the trigger calls it and it
-- must see every row regardless of who caused the change. Execute is revoked
-- from every client role: nothing a session can call rebuilds a count by
-- hand. The ledger is the only way in.
--
-- Idempotent, additive. Needs 051, 054, 061, 063. Validate with
-- scripts/migrate-local.ts, then run in the SQL editor.
-- ============================================================

-- 0) PRE-FLIGHT (paste back) — expect: lots > 0, sets = 0 (nothing anchored yet).
select
  (select count(*) from public.herd_lots) as lots,
  (select count(*) from public.events where type = 'head_count_set') as sets;

-- 1) Backfill: one anchor per lot, at its current count, dated created_at ---
-- created_by may be null on a lot whose creator's account is gone; the events
-- row needs a user, so the anchor falls back to any member of the ranch, and
-- a lot with no member at all is skipped and reported by the verify block.
insert into public.events (id, user_id, ranch_id, device_id, type, ts, payload, schema_version)
select
  gen_random_uuid(),   -- explicit: the column's default is not something a backfill should lean on
  coalesce(l.created_by, (select m.user_id from public.ranch_members m where m.ranch_id = l.ranch_id order by m.created_at limit 1)),
  l.ranch_id,
  null,
  'head_count_set',
  l.created_at,
  jsonb_build_object(
    'source', 'manual',
    'schema_version', 1,
    'lot_id', l.id,
    'head_before', null,
    'head_after', l.head_count,
    'reason', 'backfill'),
  1
from public.herd_lots l
where coalesce(l.created_by, (select m.user_id from public.ranch_members m where m.ranch_id = l.ranch_id order by m.created_at limit 1)) is not null
  -- Idempotent by lookup, not by constraint: dedup_key carries no unique index
  -- the validator can see, and a second run must add nothing.
  and not exists (select 1 from public.events e where e.type = 'head_count_set' and e.payload->>'lot_id' = l.id::text);

-- 2) The rebuild -------------------------------------------------------------
create or replace function public.rebuild_lot_head(p_lot uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anchor_ts   timestamptz;
  v_anchor_head integer;
  v_delta       integer := 0;
  v_head        integer;
begin
  -- The anchor: the latest live count that was SET for this lot.
  select e.ts, (e.payload->>'head_after')::integer
    into v_anchor_ts, v_anchor_head
    from public.events e
   where e.type = 'head_count_set'
     and e.payload->>'lot_id' = p_lot::text
     and e.deleted_at is null and e.voided_at is null and e.superseded_by is null
   order by e.ts desc, e.ingested_at desc
   limit 1;

  if v_anchor_ts is null then
    -- No anchor at all (a lot older than this migration whose backfill was
    -- skipped). Leave the column alone rather than zero a herd.
    select head_count into v_head from public.herd_lots where id = p_lot;
    return v_head;
  end if;

  -- Every live working after the anchor that names this lot as SOURCE:
  -- the source ended at what stayed, so the delta is stayed − what it said before.
  select coalesce(sum((e.payload->>'stayed')::integer - (e.payload->>'source_head_before')::integer), 0)
    into v_delta
    from public.events e
   where e.type = 'group_action'
     and e.payload->>'source_lot_id' = p_lot::text
     and e.ts > v_anchor_ts
     and e.deleted_at is null and e.voided_at is null and e.superseded_by is null;

  -- …and every live working after the anchor that names it as a RESULT: +head.
  select v_delta + coalesce(sum((r->>'head')::integer), 0)
    into v_delta
    from public.events e, jsonb_array_elements(e.payload->'results') r
   where e.type = 'group_action'
     and r->>'lot_id' = p_lot::text
     and e.ts > v_anchor_ts
     and e.deleted_at is null and e.voided_at is null and e.superseded_by is null;

  v_head := greatest(v_anchor_head + v_delta, 0);
  update public.herd_lots set head_count = v_head where id = p_lot and head_count is distinct from v_head;
  return v_head;
end $$;

comment on function public.rebuild_lot_head is
  'Block 12 (12.6): head_count = latest live head_count_set + signed deltas of live group_actions after it. Called by the events trigger; never by a client.';

revoke all on function public.rebuild_lot_head(uuid) from public;
revoke all on function public.rebuild_lot_head(uuid) from anon;
revoke all on function public.rebuild_lot_head(uuid) from authenticated;

-- 3) The trigger: the ledger moves, the number follows -----------------------
create or replace function public.events_project_head_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.events%rowtype;
  v_lot  text;
  v_item jsonb;
begin
  v_row := coalesce(new, old);
  if v_row.type = 'head_count_set' then
    v_lot := v_row.payload->>'lot_id';
    if v_lot is not null then perform public.rebuild_lot_head(v_lot::uuid); end if;
  elsif v_row.type = 'group_action' then
    v_lot := v_row.payload->>'source_lot_id';
    if v_lot is not null then perform public.rebuild_lot_head(v_lot::uuid); end if;
    for v_item in select * from jsonb_array_elements(coalesce(v_row.payload->'results', '[]'::jsonb)) loop
      if v_item->>'lot_id' is not null then perform public.rebuild_lot_head((v_item->>'lot_id')::uuid); end if;
    end loop;
  end if;
  return null;
end $$;

drop trigger if exists events_project_head_counts on public.events;
-- No WHEN clause: a DELETE trigger's WHEN cannot read NEW, and the type test
-- is two lines inside the function anyway. Every other row type returns at once.
create trigger events_project_head_counts
  after insert or update of deleted_at, voided_at, superseded_by or delete on public.events
  for each row
  execute function public.events_project_head_counts();

-- 4) Verify (paste back) -------------------------------------------------------
-- (a) Every lot has an anchor; none was skipped.
select
  (select count(*) from public.herd_lots) as lots,
  (select count(distinct payload->>'lot_id') from public.events where type = 'head_count_set') as lots_anchored,
  (select count(*) from public.herd_lots l where not exists (select 1 from public.events e where e.type = 'head_count_set' and e.payload->>'lot_id' = l.id::text)) as lots_unanchored;

-- (b) The projection agrees with the column everywhere — the backfill was at the current count, so no number moves.
select l.id, l.name, l.head_count as stored, public.rebuild_lot_head(l.id) as rebuilt
  from public.herd_lots l
 order by l.created_at;

-- (c) Trigger present; functions DEFINER by design; no client may execute either.
select tgname, tgenabled from pg_trigger where tgname = 'events_project_head_counts';
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('rebuild_lot_head', 'events_project_head_counts') order by 1;
select routine_name, grantee, privilege_type
  from information_schema.role_routine_grants
 where routine_schema = 'public' and routine_name in ('rebuild_lot_head', 'events_project_head_counts')
 order by 1, 2;
