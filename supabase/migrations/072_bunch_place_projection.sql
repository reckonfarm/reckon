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
-- A PLACE WITHOUT A MOVE IS A PLACEMENT (PK, 2026-09-21). Whenever a bunch gets
-- a place with no move behind it — made with a place, or made by a working and
-- taking its source's place — that is recorded as a cattle_moved row whose
-- payload says placement: true. Same type, same projection, one source of
-- truth; Activity reads "placed at", never "moved". The working half is here
-- (section 3b); a bunch made by hand writes its placement from the app (25b).
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
-- Idempotent. Needs 031 (places), 054 (corrections), 065 (trash), 069 (place_id), 071 (the split).
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

-- 3b) A working that makes a bunch RECORDS where it put it ------------------------
-- 071's record_group_action, whole and unchanged but for one block (marked
-- "Block 25b (072)"): a bunch it creates still takes its source's place, and
-- now writes the placement that says so. Same signature, same grants, same
-- refusals, same arithmetic. create-or-replace needs the whole body; diff it
-- against 071 and the placement is the only difference.
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
      -- Block 25b (072): a bunch never gets a place without the ledger saying
      -- so. The new bunch takes its source's place, so that is RECORDED — a
      -- cattle_moved row marked as a placement ("placed at", never "moved"),
      -- at the working's own time, pointing back at the working. The projection
      -- reads it like any other move; delete it and the bunch has no place.
      if v_src.place_id is not null then
        insert into public.events (id, user_id, ranch_id, device_id, type, ts, payload, schema_version)
        values (gen_random_uuid(), v_uid, v_src.ranch_id, null, 'cattle_moved', p_ts,
                jsonb_build_object('source', 'manual', 'schema_version', 1, 'placement', true, 'placement_reason', p_action,
                                   'origin_event_id', p_event_id, 'head', v_head, 'herd_lot_id', v_new_id,
                                   'from_place_id', null, 'to_place_id', v_src.place_id, 'place_id', v_src.place_id), 1);
      end if;
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
  'Block 25b (072): a bunch it creates records a placement (cattle_moved, placement: true) when its source has a place. Otherwise as Block 19 (071): one dated working producing named result groups, in one transaction under the caller''s own RLS. Idempotent on the event id (checked first); refusals returned as data. SPLIT is a first-class action on any bunch and owns its own arithmetic — the count is what the bunch holds, what stays is the rest, p_counted and p_stay are ignored, and the only refusal is more head leaving than the bunch holds. A preg check carries its opens group and is one caller of that same split. A created bunch takes the class named on its group, else the source''s, and carries origin_event_id back to the working that made it.';

revoke all on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid, jsonb) from public;
grant execute on function public.record_group_action(uuid, timestamptz, text, uuid, integer, integer, integer, jsonb, uuid, jsonb) to authenticated;

-- 4) Verify (paste back) ----------------------------------------------------------
-- (a) all three DEFINER by design; no client grants on any.
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('lot_place_from_moves', 'rebuild_lot_place', 'events_project_bunch_place') order by 1;
select routine_name, grantee, privilege_type
  from information_schema.role_routine_grants
 where routine_schema = 'public' and routine_name in ('lot_place_from_moves', 'rebuild_lot_place', 'events_project_bunch_place')
 order by 1, 2;

-- (a2) record_group_action: still ONE signature, still SECURITY INVOKER, and it carries the placement.
select p.proname, p.prosecdef as security_definer, pg_get_function_identity_arguments(p.oid) as args,
       position('placement' in pg_get_functiondef(p.oid)) > 0 as writes_placement
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'record_group_action';

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
