-- ============================================================
-- 071_split_bunch.sql
-- Block 19 — SPLIT IS A FIRST-CLASS ACTION ON ANY BUNCH.
--
-- WHY THIS FILE EXISTS. PK has a bunch of 220 replacement heifers that
-- cannot be split, because the only split this app has ever had lives
-- inside the preg check (070), and that bunch never came through a preg
-- check. Splitting cattle is not a preg-check feature; it is what a
-- person does to a bunch. So 'split' becomes a working in its own right,
-- and the preg check becomes one CALLER of it rather than its owner.
--
-- WHAT CHANGES, and only this:
--   · 'split' joins preg_check / sort / wean / ship as an action;
--   · a split's arithmetic belongs to the DATABASE alone. The count is
--     what the parent holds now; what stays is what is left after the
--     ones that leave. p_counted and p_stay are IGNORED for a split, so
--     no caller can compute them, disagree, and be believed;
--   · a split refuses arithmetic that cannot be true and nothing else:
--     more head leaving than the bunch holds, in plain words naming both
--     numbers, and fewer than one head leaving. Everything else saves;
--   · herd_lots gains origin_event_id — the working that made this
--     bunch. A bunch created by a split points back at the split.
--
-- A SPLIT IS AN EVENT, NOT A MUTATION (054's doctrine, ruling 2). The
-- parent's count before the split is on the event as source_head_before
-- and stays readable in the ledger forever; the bunch that left carries
-- origin_event_id back to it; and the parent is the event's own
-- source_lot_id, which is how the record already finds it. Deleting the
-- working reverses both counts (lib/deletion.ts), exactly as a preg
-- check's does.
--
-- Everything else is 070 unchanged: idempotency first, refusals as data,
-- compare-and-set on the expected head, two passes, security invoker
-- under the caller's own RLS, a created bunch taking the class named on
-- its group (else the source's) and inheriting the source's place and
-- weight.
--
-- Idempotent, additive, data-untouched. Validate with
-- scripts/migrate-local.ts, then run in the SQL editor as ONE selection.
-- ============================================================

-- 1) Where a bunch came from -------------------------------------------------
-- Additive and nullable: every bunch that exists today has no origin working,
-- which is the truth about it. No FK — an event can be voided or swept into
-- the trash, and a bunch must not be held hostage to that; this is a pointer
-- into the ledger, read through it, never a constraint on it.
alter table public.herd_lots add column if not exists origin_event_id uuid;
comment on column public.herd_lots.origin_event_id is
  'The working that created this bunch (events.id) — a split, a preg check, any group action. Null for a bunch a person made by hand. No FK on purpose: the ledger owns the event''s life, not this row.';

-- 2) The primitive, with split in it -----------------------------------------
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
  -- Block 19: the count and what stays are LOCALS now. For every working but
  -- a split they are the caller's; for a split they are the database's, worked
  -- out from the bunch itself.
  v_counted   integer;
  v_stay      integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated', 'message', 'Sign in to record a working.');
  end if;

  -- IDEMPOTENCY FIRST (064).
  select payload into v_payload from public.events where id = p_event_id;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'event_id', p_event_id, 'payload', v_payload);
  end if;

  if p_action not in ('preg_check', 'sort', 'wean', 'ship', 'split') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_action', 'message', 'That is not a working this app records.');
  end if;
  -- A split brings no count and nothing that stays: the bunch already knows
  -- both. Every other working still has to bring them.
  if p_action <> 'split' then
    if p_counted is null or p_counted < 0 or p_counted > 20000 then
      return jsonb_build_object('ok', false, 'reason', 'bad_number', 'message', 'The count has to be a whole number, 0 to 20,000.');
    end if;
    if p_stay is null or p_stay < 0 then
      return jsonb_build_object('ok', false, 'reason', 'bad_number', 'message', 'The number that stay has to be 0 or more.');
    end if;
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
      if p_action = 'split' then
        return jsonb_build_object('ok', false, 'reason', 'bad_number', 'message', 'A split has to move at least one head.');
      end if;
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
  -- Block 19 — A SPLIT'S ARITHMETIC IS THE DATABASE'S ALONE. The count is what
  -- the bunch holds right now; what stays is what is left after the ones that
  -- leave. Nothing the caller sent as p_counted or p_stay is read, so no screen
  -- and no route can work this out, disagree, and be believed. The only thing
  -- that can be untrue is more head leaving than the bunch holds, and that is
  -- refused in words that name both numbers.
  if p_action = 'split' then
    v_counted := v_src.head_count;
    if v_moved > v_src.head_count then
      return jsonb_build_object('ok', false, 'reason', 'too_many',
        'message', format('%s head cannot leave a bunch of %s.', v_moved, v_src.head_count));
    end if;
    v_stay := v_counted - v_moved;
  elsif p_action = 'preg_check' and v_bred is not null and v_open is not null then
    v_counted := p_counted; v_stay := p_stay;
    if v_stay <> v_bred then
      return jsonb_build_object('ok', false, 'reason', 'mismatch',
        'message', format('%s stay but %s are bred — the bred ones are the ones that stay', v_stay, v_bred));
    end if;
    if v_moved > v_open then
      return jsonb_build_object('ok', false, 'reason', 'mismatch',
        'message', format('%s moved to a new bunch but only %s were open', v_moved, v_open));
    end if;
  else
    v_counted := p_counted; v_stay := p_stay;
    if v_stay + v_moved <> v_counted then
      return jsonb_build_object('ok', false, 'reason', 'mismatch',
        'message', format('%s that stayed and %s that moved do not add up to the %s counted', v_stay, v_moved, v_counted));
    end if;
  end if;

  -- SECOND PASS: apply.
  for v_item in select * from jsonb_array_elements(v_plan) loop
    v_head   := (v_item->>'head')::integer;
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid;
    v_name   := v_item->>'name';

    if v_lot_id is null then
      v_new_id := gen_random_uuid();
      insert into public.herd_lots
        (id, ranch_id, class, name, head_count, avg_weight, weight_unit, frame, weaned, sale_windows, place_id, created_by, updated_by, origin_event_id)
      values
        (v_new_id, v_src.ranch_id, v_item->>'class', v_name, v_head, v_src.avg_weight, v_src.weight_unit,
         v_src.frame, v_src.weaned, '[]'::jsonb, v_src.place_id, v_uid, v_uid, p_event_id);
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

  update public.herd_lots set head_count = v_stay, updated_by = v_uid where id = v_src.id;

  v_payload := jsonb_build_object(
    'source', 'manual',
    'schema_version', 1,
    'place_id', p_place_id,
    'action', p_action,
    'counted', v_counted,
    'stayed', v_stay,
    'moved', v_moved,
    'source_lot_id', v_src.id,
    'source_name', coalesce(v_src.name, v_src.class),
    'source_head_before', v_src.head_count,
    'source_head_after', v_stay,
    'results', v_out) || v_detail;

  insert into public.events (id, user_id, ranch_id, device_id, type, ts, payload, schema_version)
  values (p_event_id, v_uid, v_src.ranch_id, null, 'group_action', p_ts, v_payload, 1);

  return jsonb_build_object('ok', true, 'duplicate', false, 'event_id', p_event_id, 'payload', v_payload);
end $$;

comment on function public.record_group_action is
  'Block 19 (071): one dated working producing named result groups, in one transaction under the caller''s own RLS. Idempotent on the event id (checked first); refusals returned as data. SPLIT is a first-class action on any bunch and owns its own arithmetic — the count is what the bunch holds, what stays is the rest, p_counted and p_stay are ignored, and the only refusal is more head leaving than the bunch holds. A preg check carries its opens group and is one caller of that same split. A created bunch takes the class named on its group, else the source''s, and carries origin_event_id back to the working that made it.';

revoke all on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid, jsonb) from public;
grant execute on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid, jsonb) to authenticated;

-- ============================================================
-- Verify (paste back) — run separately, after the statement above.
-- ============================================================

-- (a) Expect one row: the function, INVOKER, ten arguments ending "p_detail jsonb",
--     and a comment that says "Block 19 (071)".
select p.proname, p.prosecdef as security_definer, pg_get_function_identity_arguments(p.oid) as args, obj_description(p.oid, 'pg_proc') as note
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'record_group_action';

-- (b) Nothing moved: the same bunches at the same counts as before this file,
--     and origin_event_id null on every one of them (no bunch here was made by
--     a working yet — the column is new and nothing backfills it).
select id, name, class, head_count, origin_event_id from public.herd_lots where deleted_at is null order by created_at;

-- (c) The column is there, nullable, and nothing was written into it.
select column_name, data_type, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'herd_lots' and column_name = 'origin_event_id';
select count(*) as bunches_with_an_origin from public.herd_lots where origin_event_id is not null;
