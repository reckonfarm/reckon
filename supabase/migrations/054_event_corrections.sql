-- ============================================================
-- 054_event_corrections.sql
-- Block 5B — corrections after the undo window, as superseding events.
--
-- events stays append-only (043: SELECT + INSERT, no UPDATE, no DELETE for
-- clients). A correction is a NEW events row that names the row it replaces;
-- a void is the same, with voided_at set — the original and its reversal both
-- stay readable, nothing is deleted. Paper's "cross out 6, write 4, initial it".
--
-- Columns added to public.events:
--   supersedes_event_id  the row this one corrects (or voids). Set by the client
--                        on INSERT; never changes.
--   voided_at            set on the REVERSAL row: this row supersedes its original
--                        and contributes nothing (a void keeps both sides).
--   correction_reason    free text, optional but prompted ("was 4, typed 6").
--   superseded_by        SYSTEM-MAINTAINED pointer on the ORIGINAL to the row that
--                        replaced it. Written only by the trigger below (clients
--                        cannot UPDATE events), so every reader — PostgREST
--                        filters included — can take the effective ledger with
--                        `superseded_by is null and voided_at is null`, and the
--                        chain walks both ways: original.superseded_by → correction,
--                        correction.supersedes_event_id → original.
--
-- Rules the database itself holds (the code holds them too; the DB is the floor):
--   · one live correction per row (unique partial index + the trigger): a
--     correction never applies twice, a chain is a line, never a tree;
--   · a superseding row belongs to the same ranch and has the same type as
--     the row it supersedes;
--   · a voided row and an already-corrected row cannot be corrected again
--     (correct the correction — the head of the chain — instead);
--   · a row never supersedes itself; voided_at only ever sits on a superseding row.
--
-- Work time vs recording time (the read cursor's distinction, kept): a
-- correction's ts is the corrected WORK time (Tuesday), its ingested_at is when
-- it was recorded (today). It is news today (the cursor compares ingested_at)
-- and belongs to Tuesday in the record and in every balance (ts, ranch day).
--
-- Idempotent, additive, order-independent (needs 031 + 043). Run in the SQL
-- editor AS ONE SELECTION — the self-check at the end raises if any part is
-- missing, so a partial run announces itself.
-- ============================================================

-- 0) PRE-FLIGHT (paste back) ---------------------------------------------------
-- (a) how many events exist, by type — expect ~9.2k, almost all device 'bump'
--     rows (the trigger never fires for them: it runs only when
--     supersedes_event_id is set).
select type, count(*) as rows from public.events group by type order by rows desc;
-- (b) hay counts a correction could land before: every counted baseline, with
--     the hay lines (fed / stacked) on or before its ranch day. A backdated
--     correction dated before a count must not move that count's consumption.
select e.ranch_id, e.id as count_event, (e.payload->>'as_of') as as_of, (e.payload->>'bales')::int as bales_counted,
       (select count(*) from public.events f
         where f.ranch_id = e.ranch_id and f.type in ('hay_fed','bales_stacked')
           and (f.ts at time zone 'America/Denver')::date <= (e.payload->>'as_of')::date) as hay_lines_on_or_before,
       (select count(*) from public.events f
         where f.ranch_id = e.ranch_id and f.type in ('hay_fed','bales_stacked')
           and (f.ts at time zone 'America/Denver')::date >  (e.payload->>'as_of')::date) as hay_lines_after
  from public.events e
 where e.type = 'hay_inventory'
 order by e.ranch_id, as_of;
-- (c) rows with no work time — expect 0 (ts is NOT NULL since 031; a 0 here
--     confirms nothing slipped through a default).
select count(*) as null_work_time from public.events where ts is null;
-- (d) the columns this file adds — expect 0 rows before, 4 after.
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'events'
   and column_name in ('supersedes_event_id','voided_at','correction_reason','superseded_by');

-- 1) The columns --------------------------------------------------------------
alter table public.events
  add column if not exists supersedes_event_id uuid references public.events(id) on delete restrict,
  add column if not exists voided_at           timestamptz,
  add column if not exists correction_reason   text,
  add column if not exists superseded_by       uuid references public.events(id) on delete restrict;

comment on column public.events.supersedes_event_id is
  $$054 Block 5B. The row this one corrects or voids. A correction is a new row; the original is never edited.$$;
comment on column public.events.voided_at is
  $$054 Block 5B. Set on a reversal row: it supersedes its original and contributes nothing to any balance.$$;
comment on column public.events.correction_reason is
  $$054 Block 5B. Why the entry was corrected or voided, in the corrector's words.$$;
comment on column public.events.superseded_by is
  $$054 Block 5B. SYSTEM-MAINTAINED (trigger events_supersede_stamp): the row that replaced this one. Effective ledger = superseded_by is null and voided_at is null.$$;

-- Shape checks (named, idempotent).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_not_self_superseding') then
    alter table public.events add constraint events_not_self_superseding
      check (supersedes_event_id is null or supersedes_event_id <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_void_is_superseding') then
    alter table public.events add constraint events_void_is_superseding
      check (voided_at is null or supersedes_event_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_correction_reason_len') then
    alter table public.events add constraint events_correction_reason_len
      check (correction_reason is null or char_length(correction_reason) <= 500);
  end if;
end $$;

-- One live correction per row: the second INSERT naming the same original fails
-- on this index even if two phones race the trigger.
create unique index if not exists events_supersedes_uniq
  on public.events (supersedes_event_id) where supersedes_event_id is not null;

-- 2) The triggers: a superseding INSERT is checked, then stamps the original --
-- Two triggers because a BEFORE trigger can shape the new row (clear a
-- client-set pointer) but cannot point the original at a row that does not
-- exist yet (FK), and an AFTER trigger can write the pointer but not the row.
-- Both are SECURITY DEFINER because clients have no UPDATE policy on events
-- (append-only stands); these functions are the ONLY writers of superseded_by.
-- They run only when the new row names an original, so device ingest and plain
-- logging pay nothing.
create or replace function public.events_supersede_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  orig public.events%rowtype;
begin
  -- Clients never set the pointer themselves.
  new.superseded_by := null;
  if new.supersedes_event_id is null then
    return new;
  end if;

  select * into orig from public.events where id = new.supersedes_event_id for update;
  if not found then
    raise exception 'events_supersede: original % does not exist', new.supersedes_event_id
      using errcode = 'foreign_key_violation';
  end if;
  if orig.ranch_id is distinct from new.ranch_id then
    raise exception 'events_supersede: a correction must belong to the same ranch as its original'
      using errcode = 'check_violation';
  end if;
  if orig.type <> new.type then
    raise exception 'events_supersede: a correction keeps its original''s type (% vs %)', orig.type, new.type
      using errcode = 'check_violation';
  end if;
  if orig.superseded_by is not null then
    raise exception 'events_supersede: % was already corrected by %; correct that entry instead', orig.id, orig.superseded_by
      using errcode = 'unique_violation';
  end if;
  if orig.voided_at is not null then
    raise exception 'events_supersede: % is a void and cannot be corrected', orig.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.events_supersede_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.supersedes_event_id is not null then
    update public.events set superseded_by = new.id where id = new.supersedes_event_id;
  end if;
  return null;
end $$;

revoke all on function public.events_supersede_check() from public;
revoke all on function public.events_supersede_stamp() from public;

drop trigger if exists events_supersede on public.events;
drop trigger if exists events_supersede_check on public.events;
drop trigger if exists events_supersede_stamp on public.events;
create trigger events_supersede_check
  before insert on public.events
  for each row execute function public.events_supersede_check();
create trigger events_supersede_stamp
  after insert on public.events
  for each row execute function public.events_supersede_stamp();

-- 3) SELF-CHECK — raises if any part above is missing (a partial run announces itself)
do $$
declare
  cols int;
  missing text := '';
begin
  select count(*) into cols from information_schema.columns
   where table_schema = 'public' and table_name = 'events'
     and column_name in ('supersedes_event_id','voided_at','correction_reason','superseded_by');
  if cols <> 4 then missing := missing || format(' columns(%s of 4)', cols); end if;
  if not exists (select 1 from pg_constraint where conname = 'events_not_self_superseding')  then missing := missing || ' events_not_self_superseding'; end if;
  if not exists (select 1 from pg_constraint where conname = 'events_void_is_superseding')   then missing := missing || ' events_void_is_superseding'; end if;
  if not exists (select 1 from pg_constraint where conname = 'events_correction_reason_len') then missing := missing || ' events_correction_reason_len'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'events_supersedes_uniq') then missing := missing || ' events_supersedes_uniq'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'events_supersede_check' and p.prosecdef) then missing := missing || ' events_supersede_check()'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'events_supersede_stamp' and p.prosecdef) then missing := missing || ' events_supersede_stamp()'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'events_supersede_check' and tgrelid = 'public.events'::regclass and not tgisinternal) then missing := missing || ' trigger(check)'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'events_supersede_stamp' and tgrelid = 'public.events'::regclass and not tgisinternal) then missing := missing || ' trigger(stamp)'; end if;
  if missing <> '' then
    raise exception '054 INCOMPLETE — missing:%. Re-run the whole file as one selection.', missing;
  end if;
  raise notice '054 complete: 4 columns, 3 checks, unique partial index, events_supersede_check (before) + events_supersede_stamp (after) triggers';
end $$;

-- 4) Verify (paste back) — expect the 4 columns, and the two trigger rows.
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'events'
   and column_name in ('supersedes_event_id','voided_at','correction_reason','superseded_by')
 order by column_name;
select tgname, tgenabled from pg_trigger where tgrelid = 'public.events'::regclass and not tgisinternal;
