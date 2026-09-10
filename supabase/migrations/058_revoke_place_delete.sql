-- ============================================================
-- 058_revoke_place_delete.sql
-- Take away the hard delete nothing uses and nothing should.
--
-- 043 gave places the full four-policy CRUD set, including
-- "member places deletable". No route has ever called it — but the policy is
-- live, so anything holding a member JWT can permanently delete a place
-- straight against the database, and 40 of 48 manual entries name one. A
-- deleted place leaves those entries pointing at an id that resolves to
-- nothing: `payload->>place_id` has no foreign key, no index and no
-- constraint, so the ledger would silently lose its WHERE with no error
-- anywhere.
--
-- Until 057 there was an argument for leaving it: with no retire path,
-- revoking delete meant a place could never be removed at all. 057 shipped
-- that path, so the argument is gone and the policy is pure downside.
-- Doctrine has said so all along — "Disable, don't delete"
-- (docs/01-north-star-v3-boring-bible.md:31).
--
-- ⚠️  THE NON-OBVIOUS PART: THE APP'S DELETE IS NOT A DELETE.
--     DELETE /api/places/[id] performs an UPDATE — it sets retired_at and
--     retired_by and the row stays. It runs under "member places updatable",
--     which this file does not touch. Retiring keeps working exactly as it
--     does today; only the ability to make a place actually vanish goes away.
--
-- WHY THIS IS SAFE FOR THE SUITES (checked, not assumed, 2026-09-10):
--   • Every fixture teardown that deletes places uses the SERVICE ROLE, which
--     bypasses RLS entirely — scripts/rls-test.ts:93,99,
--     scripts/smoke-daily-loop.ts:79, scripts/teardown-fixtures.ts. A crashed
--     run still cleans up after this lands.
--   • The one user-scoped place delete in the suite (rls-test.ts:243) asserts
--     that deleting ANOTHER ranch's place affects 0 rows without erroring.
--     With no DELETE policy at all it still affects 0 rows without erroring —
--     Postgres filters, it does not raise. The proof is already in the suite
--     and green: `events` has had no client DELETE policy since 043, and
--     rls-test.ts:239 makes the identical assertion about events on every run.
--   • NO check anywhere asserts that a member may delete their own place.
--
-- Three names are dropped, not one. 043 replaced 031's "own places deletable"
-- and 034's "ranch places deletable" with "member places deletable"; if anyone
-- ever re-runs 034 (043:52 says never to) the older name would come back, and
-- this file should still leave the table with no delete door.
--
-- SUBTRACTIVE, and the only subtractive migration in this repo so far — which
-- is why it is its own file with its own verify rather than a rider on 057.
-- Idempotent (drop … if exists), data-untouched, order-independent. To undo:
-- re-create the policy from 043:89. Run in the Supabase SQL editor.
-- ============================================================

drop policy if exists "member places deletable" on public.places;
drop policy if exists "ranch places deletable"  on public.places;
drop policy if exists "own places deletable"    on public.places;

-- ============================================================
-- Verify (paste back) — run separately.
-- ============================================================

-- (a) Expect exactly THREE rows on places — SELECT, INSERT, UPDATE — every
--     policyname starting "member ", and no DELETE among them.
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'places'
order by cmd, policyname;

-- (b) Expect zero rows: no delete door left on places, under any name.
select policyname from pg_policies
where schemaname = 'public' and tablename = 'places' and cmd = 'DELETE';

-- (c) The company places now keep: expect events and places both with a
--     delete_policies count of 0, and herd_lots too (051 never granted one).
select tablename, count(*) filter (where cmd = 'DELETE') as delete_policies
from pg_policies
where schemaname = 'public' and tablename in ('events', 'places', 'herd_lots', 'devices')
group by tablename order by tablename;

-- (d) Nothing was deleted by this file: expect the same ten places, all live.
select count(*) as places, count(*) filter (where retired_at is null) as live
from public.places;
