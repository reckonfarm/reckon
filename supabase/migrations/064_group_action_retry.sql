-- ============================================================
-- 064_group_action_retry.sql
-- Block 10 — a retry must be recognised before it is judged.
--
-- 063 SHIPPED WITH THE ONE BUG THAT MATTERS AT A CHUTE, and the isolation
-- suite caught it on the first run:
--
--   FAIL  10: the same working sent twice moves nothing the second time
--             500 · source 40 (was 40) · groups 1 · events 1
--
-- Nothing double-applied — the counts were right — but the ANSWER was wrong,
-- and the answer is what the phone acts on. The order of checks was:
--
--     source locked → compare-and-set on expected_head → reconcile → duplicate
--
-- On a retry the source has ALREADY moved to what stayed, so the
-- compare-and-set fires against a count the first attempt itself changed, and
-- the working is refused as stale before the idempotency check is ever
-- reached. The outbox resends on every transient failure, so this is not an
-- edge case: it is what happens on one bar of signal, which is the only
-- condition this screen was built for. PK would have watched an entry that
-- had landed sit at "Waiting to sync" until he gave up on it.
--
-- Fix one: THE DUPLICATE CHECK GOES FIRST. It needs nothing but the event id.
-- A working that already landed returns what it did the first time, before
-- any lock, any comparison, any arithmetic.
--
-- Fix two: REFUSALS ARE RETURNED, NOT RAISED. The same run showed both raised
-- refusals arriving at the route as 500s — the SQLSTATE did not survive the
-- trip the way the code assumed, so a stale count read as "could not be
-- recorded just now" instead of the sentence written for it. Every refusal
-- here is pre-mutation by construction, so it can be returned as data:
-- { ok: false, reason, message }. Nothing is left depending on how an
-- exception is translated between Postgres, PostgREST and the client.
--
-- Destinations are now resolved in a FIRST PASS and applied in a second, so
-- even a bad destination is caught before a single count moves. The only
-- remaining raise is for a state that should be impossible, and it exists to
-- roll the transaction back rather than to be read.
--
-- Everything else is 063 unchanged: SECURITY INVOKER, RLS as the only gate,
-- the chute count accepted with both numbers recorded, zero a real state,
-- only the movers moving, a created destination defaulted.
--
-- Replaces the function in place. Idempotent, additive, needs 063.
-- ============================================================

-- 0) PRE-FLIGHT (paste back) — expect one row, prosecdef false.
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'record_group_action';

-- 1) The function, reordered ---------------------------------------------------
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
  v_plan      jsonb := '[]'::jsonb;   -- resolved destinations, before anything moves
  v_out       jsonb := '[]'::jsonb;
  v_moved     integer := 0;
  v_head      integer;
  v_name      text;
  v_lot_id    uuid;
  v_new_id    uuid;
  v_payload   jsonb;
begin
  -- A REFUSAL IS DATA, NOT AN EXCEPTION. Every one of these happens before a
  -- single row is written, so returning is safe and nothing depends on how a
  -- SQLSTATE survives the trip to the client.
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated', 'message', 'Sign in to record a working.');
  end if;

  -- IDEMPOTENCY FIRST. A working that already landed is answered with what it
  -- did the first time — before any lock, comparison or arithmetic, because a
  -- retry must never be judged against the state its own first attempt made.
  select payload into v_payload from public.events where id = p_event_id;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'event_id', p_event_id, 'payload', v_payload);
  end if;

  if p_action not in ('preg_check', 'sort', 'wean', 'ship') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_action', 'message', 'That is not a working this app records.');
  end if;
  if p_counted is null or p_counted < 0 or p_counted > 20000 then
    return jsonb_build_object('ok', false, 'reason', 'bad_number', 'message', 'The count has to be a whole number, 0 to 20,000.');
  end if;
  if p_stay is null or p_stay < 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_number', 'message', 'The number that stay has to be 0 or more.');
  end if;
  if jsonb_typeof(p_results) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'bad_number', 'message', 'The groups they went to could not be read.');
  end if;

  -- The source, locked for the length of this transaction so two recorders at
  -- the same chute serialise instead of interleaving. RLS decides whether it
  -- exists at all: another ranch's lot simply is not found.
  select * into v_src from public.herd_lots
   where id = p_source_lot and retired_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'source_not_found', 'message', 'That bunch is not on your ranch.');
  end if;

  -- Ruling 5: the count the recorder had on screen, or nothing moves. Reached
  -- only for a working that has NOT already landed, so a retry never meets it.
  if p_expected_head is not null and v_src.head_count <> p_expected_head then
    return jsonb_build_object('ok', false, 'reason', 'stale', 'head', v_src.head_count,
      'message', format('That bunch now reads %s head, not %s — someone else changed it. Check theirs, then record yours again.',
                        v_src.head_count, p_expected_head));
  end if;

  -- FIRST PASS: reconcile, and resolve every destination, before anything
  -- moves. A bad destination in the third group must not leave the first two
  -- applied, and catching it here means no refusal ever needs a rollback.
  for v_item in select * from jsonb_array_elements(p_results) loop
    v_head   := (v_item->>'head')::integer;
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid;
    v_name   := nullif(btrim(coalesce(v_item->>'name', '')), '');

    if v_head is null or v_head <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'bad_number', 'message', 'Every group they went to needs a head count of 1 or more.');
    end if;
    v_moved := v_moved + v_head;

    if v_lot_id is null then
      if v_name is null then
        return jsonb_build_object('ok', false, 'reason', 'unnamed_group', 'message', 'A new group needs a name.');
      end if;
      v_plan := v_plan || jsonb_build_object('lot_id', null, 'name', left(v_name, 40), 'head', v_head);
    else
      select * into v_dst from public.herd_lots
       where id = v_lot_id and ranch_id = v_src.ranch_id and retired_at is null
       for update;
      if not found then
        return jsonb_build_object('ok', false, 'reason', 'dest_not_found', 'message', 'That destination bunch is not on your ranch.');
      end if;
      if v_dst.id = v_src.id then
        return jsonb_build_object('ok', false, 'reason', 'bad_number', 'message', 'They cannot move to the bunch they came from — what stays, stays.');
      end if;
      v_plan := v_plan || jsonb_build_object('lot_id', v_dst.id, 'name', coalesce(v_dst.name, v_dst.class), 'head', v_head, 'before', v_dst.head_count);
    end if;
  end loop;

  if p_stay + v_moved <> p_counted then
    return jsonb_build_object('ok', false, 'reason', 'mismatch',
      'message', format('%s that stayed and %s that moved do not add up to the %s counted', p_stay, v_moved, p_counted));
  end if;

  -- SECOND PASS: apply. Everything from here writes, and everything that
  -- could have refused already has.
  for v_item in select * from jsonb_array_elements(v_plan) loop
    v_head   := (v_item->>'head')::integer;
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid;
    v_name   := v_item->>'name';

    if v_lot_id is null then
      v_new_id := gen_random_uuid();
      insert into public.herd_lots
        (id, ranch_id, class, name, head_count, avg_weight, weight_unit, frame, weaned, sale_windows, created_by, updated_by)
      values
        (v_new_id, v_src.ranch_id, 'old_cows', v_name, v_head, v_src.avg_weight, v_src.weight_unit,
         v_src.frame, v_src.weaned, '[]'::jsonb, v_uid, v_uid);
      v_out := v_out || jsonb_build_object('lot_id', v_new_id, 'name', v_name, 'head', v_head,
                                           'created', true, 'head_before', 0, 'head_after', v_head);
    else
      update public.herd_lots
         set head_count = head_count + v_head, updated_by = v_uid
       where id = v_lot_id
      returning head_count into v_head;
      if v_head is null then
        raise exception 'destination vanished mid-working' using errcode = 'P0002';   -- rolls the whole thing back
      end if;
      v_out := v_out || jsonb_build_object('lot_id', v_lot_id, 'name', v_name,
                                           'head', (v_item->>'head')::integer, 'created', false,
                                           'head_before', (v_item->>'before')::integer, 'head_after', v_head);
    end if;
  end loop;

  -- Ruling 1 + 3: the source ends at what STAYED — the chute's number, not
  -- the stored number minus the movers. Both are written down.
  update public.herd_lots set head_count = p_stay, updated_by = v_uid where id = v_src.id;

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
  -- retry takes the duplicate branch at the top.
  insert into public.events (id, user_id, ranch_id, device_id, type, ts, payload, schema_version)
  values (p_event_id, v_uid, v_src.ranch_id, null, 'group_action', p_ts, v_payload, 1);

  return jsonb_build_object('ok', true, 'duplicate', false, 'event_id', p_event_id, 'payload', v_payload);
end $$;

comment on function public.record_group_action is
  'Block 10 (064): one dated event producing named result groups, reconciled against a counted source, in one transaction under the caller''s own RLS. Idempotent on the event id, checked FIRST so a retry is never judged against the state its own first attempt made. Refusals are returned as {ok:false,reason,message}, never raised.';

revoke all on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid) from public;
grant execute on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid) to authenticated;

-- 2) Verify (paste back) -------------------------------------------------------
-- (a) Still INVOKER, still authenticated-only.
select p.proname, p.prosecdef as security_definer,
       pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'record_group_action';
select grantee, privilege_type from information_schema.role_routine_grants
 where routine_schema = 'public' and routine_name = 'record_group_action' order by grantee;

-- (b) Nothing was moved by replacing the function.
select count(*) as group_action_events from public.events where type = 'group_action';
select id, name, head_count from public.herd_lots order by created_at;
