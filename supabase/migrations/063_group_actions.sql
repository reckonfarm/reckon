-- ============================================================
-- 063_group_actions.sql
-- Block 10 — a dated event that produces named result groups.
--
-- THE PRIMITIVE, built once. Preg check is the first caller and the reason it
-- exists on this date (PK's chute is Tuesday 2026-09-16), but shipping,
-- sorting and weaning are the same shape and reuse this function without a
-- second migration: a source group, a count observed at the chute, some head
-- that stay, and one or more NAMED result groups that leave — reconciling
-- against the count or refusing to save.
--
-- WHY A FUNCTION AND NOT THREE WRITES FROM THE ROUTE. The event, the source
-- lot's new count and the destination lot's create-or-increment have to happen
-- together or not at all. Three PostgREST calls have two seams in them, and
-- either seam leaves the ranch's head counts saying something that never
-- happened. One function is one transaction.
--
-- SECURITY INVOKER (the default, stated here because it is the whole security
-- model). Every statement runs as the caller under RLS, so another ranch's lot
-- is not "rejected" — it does not exist to this function, and the 043
-- membership policies on herd_lots and events are the only gate. No service
-- role anywhere. A SECURITY DEFINER version of this would be a hole.
--
-- IDEMPOTENT ON THE CLIENT-MINTED EVENT ID. The phone mints the id before its
-- first attempt and every retry resends it (lib/outbox). A second arrival must
-- NOT decrement the source a second time, so the id is checked before any
-- count moves, and a genuinely concurrent duplicate rolls the whole
-- transaction back on the primary key rather than half-applying.
--
-- PK's rulings, 2026-09-12, encoded here rather than in the client where they
-- could be bypassed:
--   1. ACCEPT THE CHUTE COUNT. If he counts 212 through and the lot says 200,
--      the save succeeds and BOTH numbers are recorded. The chute is an
--      observation of real animals; the stored number was an estimate. The
--      source lot ends at the number that STAYED, not at stored − moved.
--   2. ZERO IS ALLOWED and is not retirement. herd_lots_head_check is relaxed
--      to >= 0; an emptied lot stays live because retiring is a separate
--      decision a person makes.
--   3. ONLY THE MOVERS MOVE. What stays, stays in the source lot — no new
--      group is created for it and no row is touched for it beyond the count.
--   4. A CREATED DESTINATION IS DEFAULTED, NEVER ASKED AT THE CHUTE: class
--      'old_cows', the source's own avg_weight and unit. Fixable later.
--   5. THE SOURCE COUNT IS COMPARE-AND-SET. p_expected_head is the number the
--      recorder had on screen; if another person moved it in between, this
--      refuses instead of clobbering. It is him alone on Tuesday, but it will
--      not always be.
--
-- Idempotent, additive, order-independent (needs 031 + 043 + 051). Validate
-- with scripts/migrate-local.ts, then run in the SQL editor.
-- ============================================================

-- 0) PRE-FLIGHT (paste back) ---------------------------------------------------
--    Expect: lots_at_zero = 0 (nothing is relying on the > 0 constraint today),
--    and the constraint still reading '> 0' before this runs.
select count(*) as lots_at_zero from public.herd_lots where head_count = 0;
select pg_get_constraintdef(oid) as head_constraint_before
  from pg_constraint where conname = 'herd_lots_head_check';

-- 1) Zero head is a real state ------------------------------------------------
-- An event can empty a lot. That lot is not retired and not deleted: it is a
-- bunch with nothing in it, which is a thing that happens on a ranch between a
-- shipping day and the next set of calves.
alter table public.herd_lots drop constraint if exists herd_lots_head_check;
alter table public.herd_lots add  constraint herd_lots_head_check check (head_count >= 0);

-- 2) The primitive -------------------------------------------------------------
-- p_results is [{ "lot_id": uuid|null, "name": text|null, "head": int }, …]
--   lot_id set  → an existing lot on this ranch, incremented by head
--   lot_id null → a new lot created with `name` (required), class 'old_cows',
--                 the source's avg_weight and weight_unit
-- Returns the applied result as jsonb so the route can build the receipt from
-- what the database actually did, never from what the client hoped it would.
create or replace function public.record_group_action(
  p_event_id      uuid,
  p_ts            timestamptz,
  p_action        text,
  p_source_lot    uuid,
  p_expected_head integer,
  p_counted       integer,
  p_stay          integer,
  p_results       jsonb,
  p_place_id      uuid default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_src       public.herd_lots%rowtype;
  v_dst       public.herd_lots%rowtype;
  v_item      jsonb;
  v_out       jsonb := '[]'::jsonb;
  v_moved     integer := 0;
  v_head      integer;
  v_name      text;
  v_lot_id    uuid;
  v_new_id    uuid;
  v_payload   jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_action not in ('preg_check', 'sort', 'wean', 'ship') then
    raise exception 'unknown group action: %', p_action using errcode = '22023';
  end if;
  if p_counted is null or p_counted < 0 or p_counted > 20000 then
    raise exception 'counted must be 0-20000' using errcode = '22023';
  end if;
  if p_stay is null or p_stay < 0 then
    raise exception 'the number that stay must be 0 or more' using errcode = '22023';
  end if;
  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'results must be an array' using errcode = '22023';
  end if;

  -- The source, locked for the length of this transaction so two recorders at
  -- the same chute serialise instead of interleaving. RLS decides whether it
  -- exists at all: another ranch's lot simply is not found.
  select * into v_src from public.herd_lots
   where id = p_source_lot and retired_at is null
   for update;
  if not found then
    raise exception 'that bunch is not on your ranch' using errcode = 'P0002';
  end if;

  -- Ruling 5: the count the recorder had on screen, or nothing moves.
  if p_expected_head is not null and v_src.head_count <> p_expected_head then
    raise exception 'that bunch now reads % head, not % — someone else changed it. Check theirs, then record yours again.',
      v_src.head_count, p_expected_head using errcode = '40001';
  end if;

  -- RECONCILIATION, in the database so no caller can skip it. Every animal
  -- through the chute either stayed or went somewhere named.
  for v_item in select * from jsonb_array_elements(p_results) loop
    v_head := (v_item->>'head')::integer;
    if v_head is null or v_head <= 0 then
      raise exception 'every result group needs a head count of 1 or more' using errcode = '22023';
    end if;
    v_moved := v_moved + v_head;
  end loop;
  if p_stay + v_moved <> p_counted then
    raise exception '% that stayed and % that moved do not add up to the % counted',
      p_stay, v_moved, p_counted using errcode = '22023';
  end if;

  -- IDEMPOTENCY, before a single count moves. A retry of a save that already
  -- landed returns what it did the first time and changes nothing.
  select payload into v_payload from public.events where id = p_event_id;
  if found then
    return jsonb_build_object('duplicate', true, 'event_id', p_event_id, 'payload', v_payload);
  end if;

  -- The result groups.
  for v_item in select * from jsonb_array_elements(p_results) loop
    v_head   := (v_item->>'head')::integer;
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid;
    v_name   := nullif(btrim(coalesce(v_item->>'name', '')), '');

    if v_lot_id is null then
      -- Ruling 4: created and defaulted, never asked at the chute.
      if v_name is null then
        raise exception 'a new group needs a name' using errcode = '22023';
      end if;
      v_new_id := gen_random_uuid();
      insert into public.herd_lots
        (id, ranch_id, class, name, head_count, avg_weight, weight_unit, frame, weaned, sale_windows, created_by, updated_by)
      values
        (v_new_id, v_src.ranch_id, 'old_cows', left(v_name, 40), v_head, v_src.avg_weight, v_src.weight_unit,
         v_src.frame, v_src.weaned, '[]'::jsonb, v_uid, v_uid);
      v_out := v_out || jsonb_build_object(
        'lot_id', v_new_id, 'name', left(v_name, 40), 'head', v_head,
        'created', true, 'head_before', 0, 'head_after', v_head);
    else
      select * into v_dst from public.herd_lots
       where id = v_lot_id and ranch_id = v_src.ranch_id and retired_at is null
       for update;
      if not found then
        raise exception 'that destination bunch is not on your ranch' using errcode = 'P0002';
      end if;
      update public.herd_lots
         set head_count = v_dst.head_count + v_head, updated_by = v_uid
       where id = v_dst.id;
      v_out := v_out || jsonb_build_object(
        'lot_id', v_dst.id, 'name', coalesce(v_dst.name, v_dst.class), 'head', v_head,
        'created', false, 'head_before', v_dst.head_count, 'head_after', v_dst.head_count + v_head);
    end if;
  end loop;

  -- Ruling 1 + 3: the source ends at what STAYED — the chute's number, not
  -- the stored number minus the movers. Both are written down.
  update public.herd_lots
     set head_count = p_stay, updated_by = v_uid
   where id = v_src.id;

  v_payload := jsonb_build_object(
    'source', 'manual',
    'schema_version', 1,
    'place_id', p_place_id,
    'action', p_action,
    'counted', p_counted,
    'stayed', p_stay,
    'moved', v_moved,
    'source_lot_id', v_src.id,
    'source_name', coalesce(v_src.name, v_src.class),
    'source_head_before', v_src.head_count,
    'source_head_after', p_stay,
    'results', v_out);

  -- Last, and once. A unique violation here means a genuinely concurrent
  -- duplicate: the whole transaction rolls back, no count half-moved, and the
  -- retry takes the duplicate branch above.
  insert into public.events (id, user_id, ranch_id, device_id, type, ts, payload, schema_version)
  values (p_event_id, v_uid, v_src.ranch_id, null, 'group_action', p_ts, v_payload, 1);

  return jsonb_build_object('duplicate', false, 'event_id', p_event_id, 'payload', v_payload);
end $$;

comment on function public.record_group_action is
  'Block 10: one dated event producing named result groups, reconciled against a counted source, in one transaction under the caller''s own RLS.';

revoke all on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid) from public;
grant execute on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid) to authenticated;

-- 3) Verify (paste back) -------------------------------------------------------
-- (a) The constraint now allows zero.
select pg_get_constraintdef(oid) as head_constraint_after
  from pg_constraint where conname = 'herd_lots_head_check';

-- (b) The function exists, is INVOKER (prosecdef = false), and only
--     authenticated may execute it.
select p.proname,
       p.prosecdef                                   as security_definer,
       pg_get_function_identity_arguments(p.oid)     as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'record_group_action';

select grantee, privilege_type
  from information_schema.role_routine_grants
 where routine_schema = 'public' and routine_name = 'record_group_action'
 order by grantee;

-- (c) Nothing was created or moved by running this migration.
select count(*) as group_action_events from public.events where type = 'group_action';
select count(*) as lots, count(*) filter (where head_count = 0) as empty_lots from public.herd_lots;
