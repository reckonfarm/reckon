-- ============================================================
-- 057_places_correctable.sql
-- A place can be corrected — with who changed it, when, and a real
-- concurrency token. The template for every reference object after it.
--
-- `places` is the most-referenced user-facing object in the system (40 of 48
-- manual events name one) and, until this file, the only one where a change
-- left no trace at all: no author, no history, no staleness check. `herd_lots`
-- (051) does the same job properly one migration later. This closes that gap
-- by adopting 051's shape wholesale rather than inventing a second dialect.
--
-- WHAT THIS ADDS:
--   • updated_by / retired_by — authorship on a change and on a retirement,
--     both `references auth.users(id) on delete set null` exactly as 051:61,65:
--     a person leaving must never delete the row that records what they did.
--   • retired_at — RETIRE, NEVER DELETE. `events.payload->>place_id` has no
--     foreign key, no index and no constraint across 9,186 rows, so deleting a
--     place leaves 40 entries pointing at nothing and silently loses their
--     WHERE. A retired place keeps resolving its name in history and leaves
--     every picker. This is also written doctrine — "Disable, don't delete"
--     (docs/01-north-star-v3-boring-bible.md:31).
--   • revision — LANDS NOW, UNUSED BY EVERY LINE OF CODE IN THIS SLICE. It is
--     here because a NOT NULL DEFAULT column is free to add to a table of ten
--     rows today and awkward once real shapes exist and a redraw has to decide
--     what to do with the old one. Geometry stays set-once (056); when the
--     revision slice lands it increments this and keeps the prior shape. Do not
--     read a place's revision as meaningful yet — every row is 1.
--   • places_ranch_live_idx — the live-list read path, partial on
--     `retired_at is null`, mirroring herd_lots_ranch_live_idx (051:75).
--
-- ⚠️  THE TRIGGER — THE ONE THING THIS FILE ADDS THAT THE ORDER DID NOT ASK FOR,
--     and the reason the rest of it would otherwise be worthless.
--
--     031 created places.updated_at with the note "App-stamped on write (020's
--     convention — no trigger function in this repo)". That was true when it
--     was written; 051 then introduced exactly such a trigger for herd_lots and
--     never came back for places. MEASURED on production 2026-09-10 against a
--     Test Ranch row: an UPDATE that does not mention updated_at leaves it
--     completely unchanged. So today the column moves only because
--     app/api/places/[id] happens to set it by hand.
--
--     A concurrency token that a writer can forget to bump is not a
--     concurrency token — the next route, script, or hand-run SQL that touches
--     a place would leave every open editor's token looking current and the
--     409 would never fire. The database bumps it now, and the route stops
--     setting it. Same function shape, same names as 051:78-89.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   • No policy of any kind. 043's four "member places …" policies already
--     cover every column. NEVER re-run 034/036/037/038 (043:52).
--   • Does NOT revoke 043's "member places deletable" policy. A hard delete is
--     still reachable at the data layer by anything holding a member JWT, even
--     though no route calls it. Flagged for PK's separate decision — see the
--     report — because revoking it is a one-line policy change that deserves
--     its own deliberate act, not a rider on this one.
--   • No backfill of updated_by. The ten existing rows were changed by nobody
--     this column can name; null is the honest answer and reads as "not
--     recorded", never as a person.
--
-- Idempotent (add column / create or replace / drop trigger if exists),
-- additive, non-orphaning (SET NULL on both author FKs), order-independent
-- (needs 031's places table). Run in the Supabase SQL editor.
-- ============================================================

alter table public.places
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.places
  add column if not exists retired_at timestamptz;

alter table public.places
  add column if not exists retired_by uuid references auth.users(id) on delete set null;

alter table public.places
  add column if not exists revision int not null default 1;

-- The live list: every read that offers a place to choose filters on this.
create index if not exists places_ranch_live_idx
  on public.places (ranch_id) where retired_at is null;

-- updated_at is the concurrency token: the database bumps it on every UPDATE so
-- a client cannot forget to. Same shape as herd_lots_touch_updated_at (051).
create or replace function public.places_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists places_touch_updated_at on public.places;
create trigger places_touch_updated_at
  before update on public.places
  for each row execute function public.places_touch_updated_at();

comment on column public.places.updated_by is
  'Who last changed this place. Null = changed before authorship was recorded, or never changed. Never displayed as a person when null.';
comment on column public.places.retired_at is
  'Retired, not deleted: the place leaves every picker and keeps resolving its name in the history that references it. Null = live.';
comment on column public.places.retired_by is
  'Who retired it.';
comment on column public.places.revision is
  'Geometry revision counter. UNUSED in migration 057 — every row is 1. Reserved for the redraw slice, which will increment it and keep the prior shape; geometry is set-once until then (056).';

-- ============================================================
-- Verify (paste back) — run separately, after the statements above.
-- ============================================================

-- (a) Expect four rows. revision: is_nullable NO, default 1. The other three:
--     is_nullable YES, no default.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'places'
  and column_name in ('updated_by', 'retired_at', 'retired_by', 'revision')
order by column_name;

-- (b) Expect exactly one row: places_touch_updated_at, BEFORE UPDATE.
select trigger_name, action_timing, event_manipulation
from information_schema.triggers
where event_object_schema = 'public' and event_object_table = 'places';

-- (c) THE TRIGGER, PROVEN — expect one row, moved = true. This writes and then
--     puts the row back, so it is safe to run on live data; it touches the
--     oldest place and restores its name and updated_at afterwards.
do $$
declare
  target uuid; before_at timestamptz; after_at timestamptz; nm text;
begin
  select id, updated_at, name into target, before_at, nm from public.places order by created_at limit 1;
  update public.places set name = nm where id = target;          -- updated_at NOT mentioned
  select updated_at into after_at from public.places where id = target;
  raise notice 'trigger check: % -> % (moved: %)', before_at, after_at, after_at is distinct from before_at;
  update public.places set updated_at = before_at where id = target;
end $$;

-- (d) Expect one row: places_ranch_live_idx.
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'places' and indexname = 'places_ranch_live_idx';

-- (e) Expect four policies, all "member …", unchanged by this file.
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'places' order by cmd, policyname;

-- (f) The ten live rows: every one revision 1, live, and unattributed.
select name, kind, revision, retired_at is null as live, updated_by, retired_by
from public.places order by created_at;
