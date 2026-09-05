-- ============================================================
-- 045_ranch_id_not_null_and_cleanup.sql
-- Block 2G — database durability. Block 1 backfilled six orphans; nothing
-- stopped the seventh. Now the column refuses one.
--
-- 1) ranch_id NOT NULL on the seven ledger tables. Pre-flight: every count
--    in the first query must be 0 (042's backfill left them at 0 on
--    2026-09-05; a null appearing since means a writer regressed — find it
--    before running the ALTERs, do not backfill blind). After this, a write
--    for a person with no membership fails at the column, loudly, instead of
--    landing owner-visible-only: /api/log and /api/places already refuse
--    such a person under 043; ingest for an unstamped device and the alert
--    ledger line for a member-less user now fail too — intended.
-- 2) Drop the three _bak_20260802 tables: RLS on (Block 1, step 1), nothing
--    reads them, the live tables proved healthy (rls-test 44/44).
-- 3) Delete the stale PRF row (sales_closing, crop_year 2026 → 2025-12-01):
--    dead to every reader (the service filters deadline_date >= today and
--    overrides lfp/prf from lib/programDates.ts) — a row that can only
--    confuse the next person who opens the table.
--
-- Idempotent (NOT NULL is a no-op when already set; drop/delete IF EXISTS /
-- by key), non-orphaning (the ALTERs refuse if a null exists rather than
-- inventing a ranch), order-independent (needs 042/043). Run in the
-- Supabase SQL editor, in this order, and paste the two verify results.
-- ============================================================

-- 0) Pre-flight — expect seven zeros. STOP if any is not zero.
select 'events' as t, count(*) as null_ranch from public.events where ranch_id is null
union all select 'places',          count(*) from public.places          where ranch_id is null
union all select 'devices',         count(*) from public.devices         where ranch_id is null
union all select 'detections',      count(*) from public.detections      where ranch_id is null
union all select 'detection_runs',  count(*) from public.detection_runs  where ranch_id is null
union all select 'jobs',            count(*) from public.jobs            where ranch_id is null
union all select 'job_annotations', count(*) from public.job_annotations where ranch_id is null;

-- 1) NOT NULL — one statement per table.
alter table public.events          alter column ranch_id set not null;
alter table public.places          alter column ranch_id set not null;
alter table public.devices         alter column ranch_id set not null;
alter table public.detections      alter column ranch_id set not null;
alter table public.detection_runs  alter column ranch_id set not null;
alter table public.jobs            alter column ranch_id set not null;
alter table public.job_annotations alter column ranch_id set not null;

-- 2) The backup tables from the 2026-08-02 ranch-scope migration.
drop table if exists public.events_bak_20260802;
drop table if exists public.devices_bak_20260802;
drop table if exists public.places_bak_20260802;

-- 3) The stale PRF row.
delete from public.rma_deadlines
 where state = 'MT' and county_fips is null
   and crop_or_program = 'prf' and deadline_type = 'sales_closing'
   and crop_year = 2026 and deadline_date = date '2025-12-01';

-- 4) Verify — (a) expect seven rows, is_nullable = NO on every one.
select table_name, is_nullable
from information_schema.columns
where table_schema = 'public' and column_name = 'ranch_id'
  and table_name in ('events','places','devices','detections','detection_runs','jobs','job_annotations')
order by table_name;
-- (b) expect zero rows.
select tablename from pg_tables where schemaname = 'public' and tablename like '%_bak_20260802';
-- (c) expect three rows: prf sales_closing 2026-12-01, prf acreage_reporting 2026-12-01, lfp application 2027-03-01.
select crop_or_program, deadline_type, crop_year, deadline_date from public.rma_deadlines
 where crop_or_program in ('lfp','prf') order by deadline_date, deadline_type;
