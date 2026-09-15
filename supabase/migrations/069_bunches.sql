-- ============================================================
-- 069_bunches.sql
-- Block 14 — count cattle; bunches you can make on the spot.
--
-- Four changes to herd_lots and its one function, each a ruling (PK, 2026-09-14):
--
--   1. CLASS gains 'pairs'. A cow-calf pair is a sale class a rancher names;
--      it prices as cows on the market cards (lib/herd.ts LOT_CLASS_TO_MARS).
--      Not 'calves': a calf lives in a cow bunch or a weaned bunch. The check
--      widens by one value and nothing else about it moves.
--
--   2. AVERAGE WEIGHT becomes NULLABLE. "Nobody knows average weight standing
--      in a corral." A bunch made on the spot has a name, a head count, a class
--      and maybe a place — no weight. The market and LRP readers say "no
--      weight set" for such a bunch rather than pricing air. The positive
--      check stays for a weight that IS set.
--
--   3. PLACE. herd_lots.place_id — where the bunch is, set when the bunch is
--      made and moved only by a real move event, never faked. ON DELETE SET
--      NULL, like devices.place_id (031): removing a place never blocks or
--      destroys a bunch. Reads through the membership policies as every other
--      column does; no policy change.
--
--   4. THE PREG CHECK STOPS SPLITTING. 063/064's record_group_action created a
--      new bunch from the opens inside the same transaction as the check.
--      Ruling: the checked bunch ends at what was COUNTED, bred and open are
--      recorded as numbers on that bunch, and the split — if the person wants
--      one — is a separate SORT working offered as one tap afterward, so it
--      carries its own row, its own Undo, and a class the person chose.
--      The function is REPLACED (new signature, so the old one is dropped):
--        · p_detail jsonb — bred and open ride in the payload as integers;
--        · a preg_check with any result group is refused as data
--          (reason 'preg_no_split'), so no caller can split through it;
--        · a result group may name its CLASS ('class' on the item, checked
--          against the same list as the column); a created bunch defaults to
--          the SOURCE's class, not 'old_cows' — the chute asks, this defaults;
--        · a created bunch inherits the source's place_id (they were sorted
--          where they stood) and its weight, which may now be null.
--      Everything else is 064 unchanged: idempotency first, refusals as data,
--      compare-and-set on the expected head, two passes, only the movers move.
--      066/067's projection reads stayed − source_head_before and results[].head
--      and is unaffected: a preg check with no results moves nothing but the
--      source, which ends at counted.
--
-- Idempotent (drop/add constraint, add column if not exists, drop function
-- if exists + create), data-untouched. Needs 051, 064, 065. Validate with
-- scripts/migrate-local.ts, then run in the SQL editor as ONE selection.
-- ============================================================

-- 1) 'pairs' -----------------------------------------------------------------
alter table public.herd_lots drop constraint if exists herd_lots_class_check;
alter table public.herd_lots add constraint herd_lots_class_check
  check (class in ('steers', 'heifers', 'yearlings', 'cows', 'bulls', 'old_cows', 'pairs'));

-- 2) weight optional ---------------------------------------------------------
alter table public.herd_lots alter column avg_weight drop not null;
alter table public.herd_lots drop constraint if exists herd_lots_weight_check;
alter table public.herd_lots add constraint herd_lots_weight_check
  check (avg_weight is null or avg_weight > 0);

-- 3) where the bunch is ------------------------------------------------------
alter table public.herd_lots
  add column if not exists place_id uuid references public.places(id) on delete set null;
create index if not exists herd_lots_place_idx on public.herd_lots (place_id) where place_id is not null;
comment on column public.herd_lots.place_id is
  'Block 14 (069): where the bunch is. Set when the bunch is made; moved only by a real move event, never faked. Null = not said.';

-- 4) the working, without the split ------------------------------------------
drop function if exists public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid);

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

  -- Block 14: a preg check records counts on the bunch checked. The split is
  -- a sort afterward, never part of the check.
  if p_action = 'preg_check' and jsonb_array_length(p_results) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'preg_no_split',
      'message', 'A preg check records the counts on the bunch you checked. Make a bunch from the opens afterward.');
  end if;

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

  if p_stay + v_moved <> p_counted then
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
  'Block 14 (069): one dated working producing named result groups, reconciled against a counted source, in one transaction under the caller''s own RLS. Idempotent on the event id (checked first); refusals returned as data. A preg check may not split (results must be empty; bred/open ride in p_detail); a created bunch takes the class named on its group, else the source''s.';

revoke all on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid, jsonb) from public;
grant execute on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid, jsonb) to authenticated;

-- ============================================================
-- Verify (paste back) — run separately, after the statements above.
-- ============================================================

-- (a) Expect one row: the function, INVOKER (prosecdef false), ten arguments ending "p_detail jsonb".
select p.proname, p.prosecdef as security_definer, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'record_group_action';

-- (b) Expect: avg_weight is_nullable YES; place_id present, nullable.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'herd_lots' and column_name in ('avg_weight', 'place_id')
 order by column_name;

-- (c) Expect the class check to name pairs and the weight check to allow null.
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.herd_lots'::regclass and conname in ('herd_lots_class_check', 'herd_lots_weight_check')
 order by conname;

-- (d) Nothing moved: the same bunches at the same counts as before this file.
select id, name, class, head_count, avg_weight, place_id from public.herd_lots order by created_at;
