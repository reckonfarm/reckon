-- ============================================================
-- 067_projection_ranch_scoped.sql
-- Block 12 (12.6) — the head-count projection trusts nothing but the lot's own ranch.
--
-- PK asked, after reading 066's verify output, whether the trigger function
-- could be called directly to rebuild a count on a ranch the caller does not
-- belong to. The direct call cannot happen — a function that RETURNS TRIGGER
-- is refused outside a trigger by Postgres itself ("trigger functions can only
-- be called as triggers"), and PostgREST does not expose it — so the PUBLIC
-- grant the verify showed is Postgres's default on a new function and is
-- inert. But the question found the real hole beside it:
--
--   A member of ranch B can insert an events row ON RANCH B (their own —
--   the 043 policy allows it) whose PAYLOAD names a lot on ranch A:
--   { type: head_count_set, lot_id: <A's lot>, head_after: 999 }. The
--   trigger fires as the table owner. rebuild_lot_head(A's lot) looked for
--   the latest head_count_set naming that lot — with no ranch filter — found
--   B's row, and wrote 999 into A's herd_lots as SECURITY DEFINER, past RLS.
--   The same door stood open for a group_action payload naming A's lot as a
--   source or a result.
--
-- The projection now believes only ledger rows on THE LOT'S OWN RANCH. A row
-- on any other ranch that names the lot is not evidence, whatever it says.
-- The trigger also refuses to act on a row whose ranch is not the named lot's
-- ranch, so a cross-ranch payload does no work at all. And execute on the
-- trigger function is revoked from every client role — inert, but the verify
-- block should read the way the doctrine reads.
--
-- 063/064's record_group_action is unaffected: it resolves the source lot
-- under the caller's RLS before it writes, so its payloads are ranch-
-- consistent by construction. This closes the direct-insert path.
--
-- Idempotent, replaces both functions in place. Needs 066.
-- ============================================================

-- 0) PRE-FLIGHT (paste back) — expect: no ledger row names a lot on another ranch.
select count(*) as cross_ranch_rows
  from public.events e
  join public.herd_lots l on l.id::text = coalesce(e.payload->>'lot_id', e.payload->>'source_lot_id')
 where e.type in ('head_count_set', 'group_action')
   and e.ranch_id is distinct from l.ranch_id;

-- 1) The rebuild, scoped to the lot's ranch --------------------------------------
create or replace function public.rebuild_lot_head(p_lot uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ranch       uuid;
  v_anchor_ts   timestamptz;
  v_anchor_head integer;
  v_delta       integer := 0;
  v_head        integer;
begin
  select ranch_id, head_count into v_ranch, v_head from public.herd_lots where id = p_lot;
  if v_ranch is null then return null; end if;   -- no such lot; nothing to rebuild

  -- The anchor: the latest live count SET for this lot, ON THIS LOT'S RANCH.
  select e.ts, (e.payload->>'head_after')::integer
    into v_anchor_ts, v_anchor_head
    from public.events e
   where e.type = 'head_count_set'
     and e.ranch_id = v_ranch
     and e.payload->>'lot_id' = p_lot::text
     and e.deleted_at is null and e.voided_at is null and e.superseded_by is null
   order by e.ts desc, e.ingested_at desc
   limit 1;

  if v_anchor_ts is null then
    return v_head;   -- no anchor on its own ranch: leave the column alone rather than zero a herd
  end if;

  select coalesce(sum((e.payload->>'stayed')::integer - (e.payload->>'source_head_before')::integer), 0)
    into v_delta
    from public.events e
   where e.type = 'group_action'
     and e.ranch_id = v_ranch
     and e.payload->>'source_lot_id' = p_lot::text
     and e.ts > v_anchor_ts
     and e.deleted_at is null and e.voided_at is null and e.superseded_by is null;

  select v_delta + coalesce(sum((r->>'head')::integer), 0)
    into v_delta
    from public.events e, jsonb_array_elements(e.payload->'results') r
   where e.type = 'group_action'
     and e.ranch_id = v_ranch
     and r->>'lot_id' = p_lot::text
     and e.ts > v_anchor_ts
     and e.deleted_at is null and e.voided_at is null and e.superseded_by is null;

  v_head := greatest(v_anchor_head + v_delta, 0);
  update public.herd_lots set head_count = v_head where id = p_lot and head_count is distinct from v_head;
  return v_head;
end $$;

comment on function public.rebuild_lot_head is
  'Block 12 (12.6, 067): head_count = latest live head_count_set + live group_action deltas after it — counting ONLY rows on the lot''s own ranch. Trigger-called; never by a client.';

revoke all on function public.rebuild_lot_head(uuid) from public;
revoke all on function public.rebuild_lot_head(uuid) from anon;
revoke all on function public.rebuild_lot_head(uuid) from authenticated;

-- 2) The trigger refuses cross-ranch payloads outright -------------------------
create or replace function public.events_project_head_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.events%rowtype;
  v_lot  uuid;
  v_item jsonb;
begin
  -- A lot is rebuilt only if it belongs to the ranch the row was written on.
  -- A payload naming someone else's lot does no work here, and the rebuild
  -- above would ignore the row anyway. Two locks on one door.
  v_row := coalesce(new, old);
  if v_row.type = 'head_count_set' then
    v_lot := nullif(v_row.payload->>'lot_id', '')::uuid;
    if v_lot is not null and exists (select 1 from public.herd_lots l where l.id = v_lot and l.ranch_id = v_row.ranch_id) then
      perform public.rebuild_lot_head(v_lot);
    end if;
  elsif v_row.type = 'group_action' then
    v_lot := nullif(v_row.payload->>'source_lot_id', '')::uuid;
    if v_lot is not null and exists (select 1 from public.herd_lots l where l.id = v_lot and l.ranch_id = v_row.ranch_id) then
      perform public.rebuild_lot_head(v_lot);
    end if;
    for v_item in select * from jsonb_array_elements(coalesce(v_row.payload->'results', '[]'::jsonb)) loop
      v_lot := nullif(v_item->>'lot_id', '')::uuid;
      if v_lot is not null and exists (select 1 from public.herd_lots l where l.id = v_lot and l.ranch_id = v_row.ranch_id) then
        perform public.rebuild_lot_head(v_lot);
      end if;
    end loop;
  end if;
  return null;
end $$;

comment on function public.events_project_head_counts is
  'Block 12 (12.6, 067): after a group_action or head_count_set row changes, rebuild every lot it names — only lots on the row''s own ranch. Returns trigger: cannot be called directly.';

-- Inert for a RETURNS TRIGGER function, but the verify block should read like the doctrine.
revoke all on function public.events_project_head_counts() from public;
revoke all on function public.events_project_head_counts() from anon;
revoke all on function public.events_project_head_counts() from authenticated;

-- 3) Verify (paste back) -------------------------------------------------------
-- (a) Both functions DEFINER by design; NO client role may execute either.
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('rebuild_lot_head', 'events_project_head_counts') order by 1;
select routine_name, grantee, privilege_type
  from information_schema.role_routine_grants
 where routine_schema = 'public' and routine_name in ('rebuild_lot_head', 'events_project_head_counts')
 order by 1, 2;

-- (b) Nothing moved: the projection agrees with the column on every lot.
select l.id, l.name, l.ranch_id, l.head_count as stored, public.rebuild_lot_head(l.id) as rebuilt
  from public.herd_lots l order by l.ranch_id, l.created_at;
