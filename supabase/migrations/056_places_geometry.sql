-- ============================================================
-- 056_places_geometry.sql
-- Places, slice 1 — a place can hold a drawn shape, its acreage, and the
-- record of where that shape came from.
--
-- 031 created `places` with `geometry jsonb` NULLABLE and its own words for
-- the null: "or null if undrawn". Eight rows later, every one of them is
-- still undrawn — the only writer (app/api/places/route.ts) hardcodes
-- geometry: null, because until now nothing could draw one. This adds the
-- three columns a drawn place needs and nothing else.
--
-- WHAT THIS ADDS:
--   • parent_id  — the two-level model ("the Lower Field" contains several
--     worked fields). SELF-REFERENCING, not a fourth table: North Star v3
--     §THREE TABLES is explicit, and the four membership policies from 043
--     already cover every column on this table, so a self-reference costs
--     ZERO new policy. Depth is capped at two in application code, the same
--     posture that keeps `kind` text rather than an enum (031:46) — a shape
--     the product might outgrow must never be welded into the schema.
--     ON DELETE SET NULL, matching devices.place_id (031): removing a parent
--     must orphan its children into top-level places, never destroy them.
--   • acres — STORED, not derived. The whole point of a persistent place is
--     that its acreage stops being recomputed from whatever track happened to
--     be driven most recently (lib/jobs/boundary.ts computes field acreage at
--     read time, per job, nothing stored — deliberately, for a DERIVED field;
--     a place is not derived). Computed server-side from the geometry on
--     write, never trusted from the client.
--   • geometry_provenance — how the shape got here: { source, created_at, … }
--     with source 'drawn' | 'driven' | 'promoted'. Slice 1 only ever writes
--     'drawn'. This exists now, before the other two sources do, because a
--     shape whose origin is unrecorded cannot be judged later: a hand-tapped
--     polygon and a promoted cutting boundary carry very different claims to
--     accuracy, and the difference has to survive in the row.
--
-- NULLABLE, EVERY ONE. All 8 live rows keep working untouched; a place named
-- from the record sheet with no shape is still a legitimate place, exactly as
-- it is today. NOT NULL here would break all three standing suites
-- (rls-test.ts and smoke-daily-loop.ts both insert shapeless fixture places)
-- and every existing row, for nothing.
--
-- WHAT THIS DELIBERATELY DOES NOT ADD:
--   • No policy of any kind. 043's "member places readable/insertable/
--     updatable/deletable" gate on ranch_id membership and cover new columns
--     automatically. NEVER re-run 034/036/037/038 (043:52) — they would
--     recreate the OR'd owner-leg policies beside these.
--   • No index on geometry. A ranch holds tens of places; point-in-polygon
--     runs in TypeScript over a handful of rings (lib/places/geo.ts, sharing
--     lib/jobs/boundary.ts's projection so places and fields can never drift
--     to different ground). PostGIS buys a spatial index nothing needs and
--     costs scripts/migrate-local.ts, which has no PostGIS to validate against.
--   • No FK from events.payload->>place_id. That reference has never had
--     referential integrity and this file does not pretend to give it any;
--     it is why slice 1 ships no DELETE.
--   • No check constraint on provenance.source. Same reason `kind` is text:
--     a new source must never require a migration.
--
-- SET-ONCE, and the column cannot say so: app/api/places/[id] refuses to
-- overwrite or clear a geometry that is already non-null (the write carries
-- `is('geometry', null)`, so two people drawing the same place cannot both
-- win). No constraint here enforces it, deliberately — a later slice will add
-- a correction chain for shapes the way 054 did for events, and that slice
-- will need to write a new shape over an old one. This is a PRODUCT rule for
-- as long as places have no way to record what a boundary used to be. Do not
-- read a non-null geometry as permanent; read it as unrewritable so far.
--
-- TRAP, recorded because it cost time in recon: `kind` is nominally free text
-- and functionally dead. LogIt.tsx posts { name } alone, so the API defaults
-- EVERYTHING to 'field' — on production "Preston's house" is a field. This
-- migration does not fix that; the API and the draw surface in this same
-- slice do. Nothing here should be read as blessing the current values.
--
-- Idempotent (add column if not exists), additive only, non-orphaning
-- (SET NULL on the self-reference), order-independent (needs only 031's
-- places table). Run in the Supabase SQL editor.
-- ============================================================

alter table public.places
  add column if not exists parent_id uuid references public.places(id) on delete set null;

alter table public.places
  add column if not exists acres numeric;

alter table public.places
  add column if not exists geometry_provenance jsonb;

-- The children-of-a-parent read (the two-level list). Partial: costs nothing
-- for the top-level rows, which are and will remain most of them.
create index if not exists places_parent_idx
  on public.places (parent_id) where parent_id is not null;

comment on column public.places.parent_id is
  'Optional containing place — "the Lower Field" over its worked fields. Two levels, enforced in application code, not schema. ON DELETE SET NULL: removing a parent orphans children to top level, never deletes them.';
comment on column public.places.acres is
  'Stored acreage of the drawn shape, computed server-side from geometry (shoelace in projected metres, lib/places/geo.ts). Null when undrawn. Never trusted from the client, never recomputed at read time.';
comment on column public.places.geometry_provenance is
  'How the shape got here: { source: ''drawn''|''driven''|''promoted'', created_at, ... }. Null when undrawn. Text-valued source by convention, not a constraint — a new source must never require a migration.';

-- ============================================================
-- Verify (paste back) — run separately, after the ALTERs.
-- ============================================================

-- (a) Expect three rows, is_nullable = YES on every one:
--     acres numeric · geometry_provenance jsonb · parent_id uuid
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'places'
  and column_name in ('parent_id', 'acres', 'geometry_provenance')
order by column_name;

-- (b) Expect exactly 4 rows, every policyname starting "member ", every
--     roles = {authenticated} — unchanged by this file.
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'places'
order by cmd, policyname;

-- (c) Expect one row: places_parent_idx.
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'places' and indexname = 'places_parent_idx';

-- (d) The 8 live rows, untouched: expect every acres / parent_id /
--     geometry_provenance null, and the same names as before.
select name, kind, geometry is null as undrawn, acres, parent_id, geometry_provenance
from public.places order by created_at;
