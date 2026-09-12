-- ============================================================
-- 062_place_pin_and_delete_policies.sql
-- A place can be pinned to Weather. Places and devices lose the hard-delete
-- policy nothing has ever called.
--
-- TWO CHANGES, ONE FILE, because they are the same decision from two sides:
-- the route becomes the only way a place or device is removed, and the pin is
-- part of the surface that removal now lives on.
--
-- ── 1. places.pinned_at (Block 7D.4) ─────────────────────────────────────────
-- Weather lists EVERY live place, name-ordered, whether or not anything has
-- ever been recorded there — measured at 1,202px of a 3,409px page, 35%, with
-- two of five rows reading "no rain recorded yet". A place earns its row now
-- by having a rain reading, a device, or a PIN. The pin is the manual override
-- for the place that matters before it has any data — the new tank, the field
-- being watched this week. Everything else moves behind a picker; nothing is
-- hidden from the ranch, only from the list.
--
-- A timestamp, not a boolean: when it was pinned is worth knowing and costs
-- nothing, and it matches retired_at / deleted_at elsewhere. Null = not pinned.
--
-- ── 2. Revoking the delete policies (Block 7D.3, 058's substance) ────────────
-- 043 gave places and devices the full four-policy CRUD set. No route has ever
-- called either DELETE, but the policies are live: anything holding a member
-- JWT can permanently delete a place or a device straight against PostgREST.
-- For places that is the sharper edge — 50 of 67 manual entries name one, and
-- events.payload->>place_id has NO foreign key, no index and no constraint, so
-- a hard delete leaves those entries pointing at an id that resolves to
-- nothing and the ledger loses its WHERE with no error anywhere.
--
-- 058 proposed revoking this and stopping there, which would have left places
-- retire-only. PK ruled the other way: he wants tap-and-delete. So the policy
-- goes AND a real delete path arrives in the same block — DELETE
-- /api/places/[id] removes an UNREFERENCED place outright, and a referenced
-- one is not deleted at all: the route answers with what still points at it.
-- The rule needs to count references across four untyped jsonb keys, which no
-- policy can express, so the route owns it and the door closes behind it.
--
-- Devices get the same treatment. They have never had a delete surface at all.
--
-- Three names are dropped per table, not one. 043 replaced 031's "own …" and
-- 034's "ranch …" policies with "member …"; if anyone ever re-runs 034 (043:52
-- says never to) the older names would come back, and this file should still
-- leave both tables with no delete door.
--
-- SUBTRACTIVE in part. Idempotent (add column if not exists; drop policy if
-- exists), data-untouched. To undo the revoke: re-create from 043:89 and
-- 043:123. Run in the Supabase SQL editor.
-- ============================================================

-- ── 1. The pin ───────────────────────────────────────────────────────────────
alter table public.places
  add column if not exists pinned_at timestamptz;

comment on column public.places.pinned_at is
  $$062 Block 7D.4. Pinned to the Weather list. A place earns a row there by having a rain reading, a device, or this. Null = not pinned.$$;

-- The Weather read is "this ranch's pinned places"; small table, but the
-- partial index keeps it exact and costs nothing.
create index if not exists places_pinned_idx
  on public.places (ranch_id)
  where pinned_at is not null;

-- ── 2. No client delete door on places or devices ────────────────────────────
drop policy if exists "member places deletable"  on public.places;
drop policy if exists "ranch places deletable"   on public.places;
drop policy if exists "own places deletable"     on public.places;

drop policy if exists "member devices deletable" on public.devices;
drop policy if exists "ranch devices deletable"  on public.devices;
drop policy if exists "own devices deletable"    on public.devices;

-- ============================================================
-- Verify (paste back) — run separately.
-- ============================================================

-- (a) Expect one row: pinned_at, timestamptz, nullable.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'places' and column_name = 'pinned_at';

-- (b) Expect 0 — this file pins nothing.
select count(*) as pinned from public.places where pinned_at is not null;

-- (c) Expect THREE rows for places and THREE for devices — SELECT, INSERT,
--     UPDATE — every policyname starting "member ", and no DELETE in either.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('places', 'devices')
order by tablename, cmd, policyname;

-- (d) Expect zero rows: no delete door left on either table, under any name.
select tablename, policyname from pg_policies
where schemaname = 'public' and tablename in ('places', 'devices') and cmd = 'DELETE';

-- (e) Nothing was deleted by this file: expect the same ten places and three
--     devices that were there before it ran.
select (select count(*) from public.places) as places, (select count(*) from public.devices) as devices;
