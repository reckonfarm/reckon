-- ============================================================
-- 070_preg_check_split.sql
-- Block 15 (ruling 3) — a preg check makes two bunches by default, as ONE record.
--
-- 069 (Block 14) made the function refuse any result group on a preg check
-- and pushed the split to a separate sort afterward. PK reversed that in the
-- field: checking heifers always ends with two bunches — the bred ones you
-- keep and the opens you sell — so the split is the normal outcome, on the
-- same record as the check, with one Undo. The refused preg check sitting in
-- PK's outbox from 2026-09-15 (224 counted · 22 open to "Open heifers") is
-- exactly this shape, and lands under this file.
--
-- WHAT CHANGES, and only this:
--   · the preg_no_split refusal is removed;
--   · reconciliation for a preg check WITH bred/open in p_detail becomes:
--       stay = bred; moved ≤ open (the split may be off, and then the opens
--       leave the count with no destination — recorded as a number on the
--       row, not moved anywhere);
--     every other working keeps 064's rule: stay + moved = counted.
-- Everything else is 069 unchanged: idempotency first, refusals as data,
-- compare-and-set on the expected head, two passes, a created bunch takes
-- the class named on its group (else the source's) and inherits the source's
-- place and weight.
--
-- 066/067's projection reads stayed − source_head_before and results[].head,
-- so a check lands as: source → bred; the new bunch → open. Deleting the
-- working reverses both (the app also trashes the bunch the working created,
-- and restore brings it back — lib/deletion.ts, lib/trash.ts).
--
-- Replaces the function in place, same signature. Idempotent, additive,
-- data-untouched. Validate with scripts/migrate-local.ts, then run in the
-- SQL editor as ONE selection.
-- ============================================================

create or replace function public.record_group_action(
  p_event_id      uuid,
  p_ts            timestamptz,
  p_action        text,
  p_source_lot    uuid,
  p_expected_head integer,
  p_counted       integer,
  p_stay          integer,
  p_results       jsonb,
  p_place_id      uuid default null,
  p_detail        jsonb default '{}'::jsonb
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
  v_plan      jsonb := '[]'::jsonb;
  v_out       jsonb := '[]'::jsonb;
  v_moved     integer := 0;
  v_head      integer;
  v_name      text;
  v_class     text;
  v_lot_id    uuid;
  v_new_id    uuid;
  v_payload   jsonb;
  v_detail    jsonb := '{}'::jsonb;
  v_bred      integer;
  v_open      integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated', 'message', 'Sign in to record a working.');
  end if;

  -- IDEMPOTENCY FIRST (064).
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

  -- Block 15 (070): a preg check CARRIES its opens group again — one record,
  -- one Undo. The check and the split are the same working. (069's refusal
  -- is gone; 069's p_detail, class-on-a-group and place inheritance stay.)

  -- Block 14: bred and open, as whole numbers, only when given.
  if p_detail is not null and jsonb_typeof(p_detail) = 'object' then
    if p_detail ? 'bred' then
      begin v_bred := (p_detail->>'bred')::integer; exception when others then v_bred := null; end;
    end if;
    if p_detail ? 'open' then
      begin v_open := (p_detail->>'open')::integer; exception when others then v_open := null; end;
    end if;
    if v_bred is not null and v_open is not null and v_bred + v_open <> p_counted then
      return jsonb_build_object('ok', false, 'reason', 'mismatch',
        'message', format('%s bred and %s open do not add up to the %s counted', v_bred, v_open, p_counted));
    end if;
    if v_bred is not null then v_detail := v_detail || jsonb_build_object('bred', v_bred); end if;
    if v_open is not null then v_detail := v_detail || jsonb_build_object('open', v_open); end if;
  end if;

  select * into v_src from public.herd_lots
   where id = p_source_lot and retired_at is null and deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'source_not_found', 'message', 'That bunch is not on your ranch.');
  end if;

  if p_expected_head is not null and v_src.head_count <> p_expected_head then
    return jsonb_build_object('ok', false, 'reason', 'stale', 'head', v_src.head_count,
      'message', format('That bunch now reads %s head, not %s — someone else changed it. Check theirs, then record yours again.',
                        v_src.head_count, p_expected_head));
  end if;

  -- FIRST PASS: reconcile and resolve every destination before anything moves.
  for v_item in select * from jsonb_array_elements(p_results) loop
    v_head   := (v_item->>'head')::integer;
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid;
    v_name   := nullif(btrim(coalesce(v_item->>'name', '')), '');
    v_class  := nullif(btrim(coalesce(v_item->>'class', '')), '');

    if v_head is null or v_head <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'bad_number', 'message', 'Every group they went to needs a head count of 1 or more.');
    end if;
    v_moved := v_moved + v_head;

    if v_lot_id is null then
      if v_name is null then
        return jsonb_build_object('ok', false, 'reason', 'unnamed_group', 'message', 'A new bunch needs a name.');
      end if;
      if v_class is not null and v_class not in ('steers', 'heifers', 'yearlings', 'cows', 'bulls', 'old_cows', 'pairs') then
        return jsonb_build_object('ok', false, 'reason', 'bad_number', 'message', 'That is not a class of cattle this app knows.');
      end if;
      v_plan := v_plan || jsonb_build_object('lot_id', null, 'name', left(v_name, 40), 'head', v_head, 'class', coalesce(v_class, v_src.class));
    else
      select * into v_dst from public.herd_lots
       where id = v_lot_id and ranch_id = v_src.ranch_id and retired_at is null and deleted_at is null
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

  -- RECONCILE. For a preg check with bred and open given: the bred stay, the
  -- opens either move to a named bunch (the split) or leave the count with no
  -- destination (the split turned off — they are sold or gone, recorded as a
  -- number), and nothing else moves. For every other working, and for a preg
  -- check with no detail: what stayed plus what moved is what was counted.
  if p_action = 'preg_check' and v_bred is not null and v_open is not null then
    if p_stay <> v_bred then
      return jsonb_build_object('ok', false, 'reason', 'mismatch',
        'message', format('%s stay but %s are bred — the bred ones are the ones that stay', p_stay, v_bred));
    end if;
    if v_moved > v_open then
      return jsonb_build_object('ok', false, 'reason', 'mismatch',
        'message', format('%s moved to a new bunch but only %s were open', v_moved, v_open));
    end if;
  elsif p_stay + v_moved <> p_counted then
    return jsonb_build_object('ok', false, 'reason', 'mismatch',
      'message', format('%s that stayed and %s that moved do not add up to the %s counted', p_stay, v_moved, p_counted));
  end if;

  -- SECOND PASS: apply.
  for v_item in select * from jsonb_array_elements(v_plan) loop
    v_head   := (v_item->>'head')::integer;
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid;
    v_name   := v_item->>'name';

    if v_lot_id is null then
      v_new_id := gen_random_uuid();
      insert into public.herd_lots
        (id, ranch_id, class, name, head_count, avg_weight, weight_unit, frame, weaned, sale_windows, place_id, created_by, updated_by)
      values
        (v_new_id, v_src.ranch_id, v_item->>'class', v_name, v_head, v_src.avg_weight, v_src.weight_unit,
         v_src.frame, v_src.weaned, '[]'::jsonb, v_src.place_id, v_uid, v_uid);
      v_out := v_out || jsonb_build_object('lot_id', v_new_id, 'name', v_name, 'head', v_head, 'class', v_item->>'class',
                                           'created', true, 'head_before', 0, 'head_after', v_head);
    else
      update public.herd_lots
         set head_count = head_count + v_head, updated_by = v_uid
       where id = v_lot_id
      returning head_count into v_head;
      if v_head is null then
        raise exception 'destination vanished mid-working' using errcode = 'P0002';
      end if;
      v_out := v_out || jsonb_build_object('lot_id', v_lot_id, 'name', v_name,
                                           'head', (v_item->>'head')::integer, 'created', false,
                                           'head_before', (v_item->>'before')::integer, 'head_after', v_head);
    end if;
  end loop;

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
    'results', v_out) || v_detail;

  insert into public.events (id, user_id, ranch_id, device_id, type, ts, payload, schema_version)
  values (p_event_id, v_uid, v_src.ranch_id, null, 'group_action', p_ts, v_payload, 1);

  return jsonb_build_object('ok', true, 'duplicate', false, 'event_id', p_event_id, 'payload', v_payload);
end $$;

comment on function public.record_group_action is
  'Block 15 (070): one dated working producing named result groups, reconciled against a counted source, in one transaction under the caller''s own RLS. Idempotent on the event id (checked first); refusals returned as data. A preg check carries its opens group (the split is the same record); with bred/open in p_detail the bred stay and the moved may not exceed the open. A created bunch takes the class named on its group, else the source''s.';

revoke all on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid, jsonb) from public;
grant execute on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid, jsonb) to authenticated;

-- ============================================================
-- Verify (paste back) — run separately, after the statement above.
-- ============================================================

-- (a) Expect one row: the function, INVOKER, ten arguments ending "p_detail jsonb",
--     and a comment that says "Block 15 (070)".
select p.proname, p.prosecdef as security_definer, pg_get_function_identity_arguments(p.oid) as args, obj_description(p.oid, 'pg_proc') as note
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'record_group_action';

-- (b) Nothing moved: the same bunches at the same counts as before this file.
select id, name, class, head_count from public.herd_lots where deleted_at is null order by created_at;
