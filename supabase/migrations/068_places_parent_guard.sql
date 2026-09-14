-- ============================================================
-- 068_places_parent_guard.sql
-- Block 7A. A place's parent must be on the same ranch, and a place can never
-- be its own ancestor. Two rules, one trigger, nothing else.
--
-- 056 added places.parent_id as a plain self-referencing FK and left every
-- rule about it to application code: "Two levels, enforced in application
-- code, not schema." Block 7A replaces the two-level cap with a kind table
-- (lib/places/kinds.ts: pasture → field → stackyard → stack, gate / tank /
-- yard inside a pasture or a field). That table is a PRODUCT rule over a text
-- column, and it stays in code for the reason `kind` is text at all: a new
-- kind must never require a migration.
--
-- The two rules HERE are not product rules. They are the invariants that make
-- the column mean anything, and each was reachable before this file:
--
--   • SAME RANCH. POST /api/places passed parent_id straight through to the
--     insert (route.ts:159, "threaded through capture now with NO UI"). The FK
--     accepts any existing place id, and the insert policy checks only the
--     NEW row's ranch — so a member of ranch A could file a place under a
--     place on ranch B, and the isolation check at rls-test.ts:1331 only
--     asserted that the child landed on A, never that the parent was refused.
--     The route now refuses it too; this trigger is the door that closes
--     behind the route, for the next writer that forgets.
--
--   • NO CYCLES. The FK cannot say "not your own descendant". A → B → A is a
--     loop the list page would walk forever without a visited set (it has one
--     now, but a guard that only exists as defensive rendering is not a
--     guard). The walk is bounded at 64 steps — deeper than any hierarchy the
--     kind table can produce — and raises rather than loops if it hits the
--     bound.
--
-- INVOKER, NOT DEFINER. The function runs under the caller's RLS. Under the
-- membership policies a parent on another ranch is simply not visible, so
-- "not found" and "other ranch" are the same NOT FOUND — and the ONE message
-- below is deliberately the same for both, so the raise never confirms that a
-- foreign id exists. A service-role writer sees every row and gets the ranch
-- comparison outright.
--
-- The self-parent case (parent_id = id) is caught first and separately: it is
-- the only cycle the ancestor walk cannot see, because the walk starts at the
-- parent, and the parent IS the row being written.
--
-- WHAT THIS DOES NOT DO:
--   • No kind rule. See above.
--   • No policy change. NEVER re-run 034/036/037/038 (043:52).
--   • No backfill. Every live parent_id today is null.
--   • No effect on trash / retire: a child of a trashed or retired parent
--     keeps its parent_id (the list renders it as Unplaced until the parent
--     is back). Cascade delete of a parent is the FK's SET NULL, as 056 said.
--
-- Idempotent (create or replace / drop trigger if exists), additive, data-
-- untouched, order-independent (needs 056's parent_id). Run in the Supabase
-- SQL editor.
-- ============================================================

create or replace function public.places_parent_guard() returns trigger
language plpgsql as $$
declare
  v_parent_ranch uuid;
  v_cursor       uuid;
  v_steps        integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A place cannot contain itself.' using errcode = 'check_violation';
  end if;

  -- Same ranch. Under RLS an invisible parent reads as no parent at all, and
  -- the message must not say which.
  select ranch_id into v_parent_ranch from public.places where id = new.parent_id;
  if v_parent_ranch is null or v_parent_ranch is distinct from new.ranch_id then
    raise exception 'No such place to sit inside.' using errcode = 'check_violation';
  end if;

  -- No cycles: walk up from the parent; if the walk reaches this row, refuse.
  v_cursor := new.parent_id;
  while v_cursor is not null loop
    v_steps := v_steps + 1;
    if v_steps > 64 then
      raise exception 'That place sits too deep inside others to be a parent.' using errcode = 'check_violation';
    end if;
    select parent_id into v_cursor from public.places where id = v_cursor;
    if v_cursor = new.id then
      raise exception 'That would put a place inside one of its own places.' using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists places_parent_guard on public.places;
create trigger places_parent_guard
  before insert or update of parent_id, ranch_id on public.places
  for each row execute function public.places_parent_guard();

comment on function public.places_parent_guard is
  'Block 7A (068): parent_id must name a place on the same ranch (an invisible one reads as none) and can never close a loop. The kind rule stays in lib/places/kinds.ts.';

-- ============================================================
-- Verify (paste back) — run separately, after the statements above.
-- ============================================================

-- (a) Expect one row: places_parent_guard, BEFORE, INSERT and UPDATE.
select trigger_name, action_timing, event_manipulation
from information_schema.triggers
where event_object_schema = 'public' and event_object_table = 'places' and trigger_name = 'places_parent_guard'
order by event_manipulation;

-- (b) THE GUARD, PROVEN, on rows this block creates and removes inside one
--     transaction — nothing live is touched. Expect three NOTICEs, each
--     "refused: …", and a final "guard ok".
do $$
declare
  r uuid := gen_random_uuid(); p uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  other_r uuid := gen_random_uuid(); other_p uuid := gen_random_uuid();
  u uuid; stub_user boolean := false;
begin
  -- Ids are minted here rather than defaulted, so the block also runs on
  -- scripts/migrate-local.ts's rebuilt schema, which carries no defaults.
  select id into u from auth.users limit 1;
  if u is null then   -- only ever true on the local validator's empty stub
    u := gen_random_uuid(); insert into auth.users (id) values (u); stub_user := true;
  end if;
  insert into public.ranches (id, name) values (r, '068-verify-A');
  insert into public.ranches (id, name) values (other_r, '068-verify-B');
  insert into public.places (id, user_id, ranch_id, name, kind, created_at, updated_at, revision) values (p, u, r, '068 parent', 'pasture', now(), now(), 1);
  insert into public.places (id, user_id, ranch_id, name, kind, parent_id, created_at, updated_at, revision) values (c, u, r, '068 child', 'field', p, now(), now(), 1);
  insert into public.places (id, user_id, ranch_id, name, kind, created_at, updated_at, revision) values (other_p, u, other_r, '068 foreign', 'pasture', now(), now(), 1);

  begin
    update public.places set parent_id = c where id = p;     -- p → c → p
    raise exception 'cycle was NOT refused';
  exception when check_violation then raise notice 'refused: %', sqlerrm;
  end;

  begin
    update public.places set parent_id = other_p where id = c;   -- other ranch
    raise exception 'cross-ranch parent was NOT refused';
  exception when check_violation then raise notice 'refused: %', sqlerrm;
  end;

  begin
    update public.places set parent_id = p where id = p;     -- itself
    raise exception 'self-parent was NOT refused';
  exception when check_violation then raise notice 'refused: %', sqlerrm;
  end;

  delete from public.places where id in (c, p, other_p);
  delete from public.ranches where id in (r, other_r);
  if stub_user then delete from auth.users where id = u; end if;
  raise notice 'guard ok';
end $$;

-- (c) Nothing live changed: expect the same place count as before this file.
select count(*) as places from public.places;
