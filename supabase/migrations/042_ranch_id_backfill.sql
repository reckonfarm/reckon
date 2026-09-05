-- ============================================================
-- 042_ranch_id_backfill.sql
-- Block 1C step 3 (pre-flight) — stamp the rows that 043's membership-only
-- policies would otherwise orphan.
--
-- Pre-flight counts (service-role read, 2026-09-05):
--   table            rows  null ranch_id  ranch_id w/o membership  distinct  null user_id
--   events           9147     5                 0                     1          0
--   places              4     0                 0                     1          0
--   devices             3     1                 0                     1          0
--   detections         31     0                 0                     1          0
--   detection_runs     18     0                 0                     1          0
--   jobs               18     0                 0                     1          0
--   job_annotations     9     0                 0                     1          0
-- The six null rows are all owned by 7c3aeaf8… (PK), a member of Kiehl
-- Ranch: five 'alert' events written by lib/alert-service.ts before 4f53f0b
-- (dedup alert:lfp:30033:2026-08-04 … 2026-09-01) and the bench Scout
-- device bench-14c19f3534f0 ("Bench Rig (test only)", registered
-- 2026-08-07). No row anywhere carries a ranch_id its owner is not a member
-- of, and no user_id is null.
--
-- The backfill assigns each null row the owner's EARLIEST membership (every
-- user has exactly one today). It is written for all seven tables so a
-- re-run after new unstamped rows appear does the right thing; today only
-- events (5) and devices (1) change. EXPECTED: "UPDATE 5" then "UPDATE 1",
-- the other five "UPDATE 0". Run 042 BEFORE 043; paste the counts back.
--
-- Idempotent (null-guarded), additive (no deletes, no NOT NULL — the
-- Block 2 tightening once nulls stay at zero), order-independent (needs
-- only 034's ranch_members). Run in the Supabase SQL editor.
-- ============================================================

with m as (
  select distinct on (user_id) user_id, ranch_id
  from public.ranch_members order by user_id, created_at
)
update public.events e set ranch_id = m.ranch_id
  from m where e.ranch_id is null and e.user_id = m.user_id;

with m as (
  select distinct on (user_id) user_id, ranch_id
  from public.ranch_members order by user_id, created_at
)
update public.devices d set ranch_id = m.ranch_id
  from m where d.ranch_id is null and d.user_id = m.user_id;

with m as (
  select distinct on (user_id) user_id, ranch_id
  from public.ranch_members order by user_id, created_at
)
update public.places p set ranch_id = m.ranch_id
  from m where p.ranch_id is null and p.user_id = m.user_id;

with m as (
  select distinct on (user_id) user_id, ranch_id
  from public.ranch_members order by user_id, created_at
)
update public.jobs j set ranch_id = m.ranch_id
  from m where j.ranch_id is null and j.user_id = m.user_id;

with m as (
  select distinct on (user_id) user_id, ranch_id
  from public.ranch_members order by user_id, created_at
)
update public.job_annotations a set ranch_id = m.ranch_id
  from m where a.ranch_id is null and a.user_id = m.user_id;

with m as (
  select distinct on (user_id) user_id, ranch_id
  from public.ranch_members order by user_id, created_at
)
update public.detection_runs r set ranch_id = m.ranch_id
  from m where r.ranch_id is null and r.user_id = m.user_id;

with m as (
  select distinct on (user_id) user_id, ranch_id
  from public.ranch_members order by user_id, created_at
)
update public.detections x set ranch_id = m.ranch_id
  from m where x.ranch_id is null and x.user_id = m.user_id;

-- Verify: every count must be 0 before 043 runs.
select 'events' as t, count(*) as null_ranch from public.events where ranch_id is null
union all select 'places',          count(*) from public.places          where ranch_id is null
union all select 'devices',         count(*) from public.devices         where ranch_id is null
union all select 'detections',      count(*) from public.detections      where ranch_id is null
union all select 'detection_runs',  count(*) from public.detection_runs  where ranch_id is null
union all select 'jobs',            count(*) from public.jobs            where ranch_id is null
union all select 'job_annotations', count(*) from public.job_annotations where ranch_id is null;
