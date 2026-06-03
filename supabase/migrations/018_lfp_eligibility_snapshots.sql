-- ============================================================
-- 018_lfp_eligibility_snapshots.sql
-- Weekly per-county snapshot of the AUDITED LFP engine output,
-- captured each Thursday AFTER drought_data is refreshed.
-- Run in Supabase SQL Editor.
--
-- PROVENANCE — the "live engine is truth" guarantee:
--   Every row is produced by CALLING the audited engine
--   (lib/lfp-eligibility.ts computeLfpEligibility + lib/lfp-payment.ts
--   estimatePayment) and storing its return value verbatim. Nothing
--   in this table is ever computed by a reimplementation of the tier
--   or payment logic. A stored figure therefore always equals what the
--   live engine would have said for that grazing window ending that week.
--
-- HERD-INDEPENDENT (county-level):
--   We store the county-level engine output (max_tier, payments) plus the
--   full LfpEligibilityResult as JSONB. The per-rancher dollar estimate is
--   computed at READ time by passing the viewer's herd into estimatePayment,
--   so editing head count reprices the whole season with no rewrite here.
--   ref_estimate_100hd_beef is ONLY the generic 100-head-beef reference
--   figure (estimatePayment('beef_adult', 100, payments).cappedEstimate),
--   for charting/headline scale — never a specific rancher's payment.
--
-- MONOTONIC INVARIANT:
--   For a fixed grazing_start within one program year, max_tier and payments
--   are MONOTONIC non-decreasing as week_date advances (every OBBBA tier
--   trigger is "at any time" or "N weeks during the period", so a growing
--   window can only add qualifying weeks, never remove them). A stored
--   value that DECREASES versus the prior week for the same county/window
--   signals a data problem, never a real drop — the capture job asserts
--   this on write and refuses to store a bad delta.
--
-- DO NOT TRUST result->>'currentD2Streak' / result->>'weeksUntilTier1' AS
-- HISTORICAL TRUTH:
--   The engine computes those two fields against "today" (new Date()), not
--   against grazing_end. They are correct only in a live Thursday capture
--   (capture_source = 'live', where today ~= the week). In any future
--   backfilled row (capture_source = 'backfill') they would be computed
--   against the wrong "now" and must be ignored. The money curve uses
--   max_tier / payments only — both of which replay faithfully.
-- ============================================================

create table if not exists public.lfp_eligibility_snapshots (
  id              bigserial   primary key,
  county_id       integer     not null references public.counties (id) on delete cascade,
  fips            char(5)     not null,              -- denormalized for fips-keyed season queries
  week_date       date        not null,             -- USDM Tuesday data-as-of date (same key as drought_data)
  program_year    smallint    not null,             -- LFP program year = the grazing-period START year (calendar year the season opens)
  grazing_start   date        not null,             -- exact window start passed to the engine (dashboard-default resolution)
  grazing_end     date        not null,             -- exact window end passed to the engine
  max_tier        smallint    not null check (max_tier between 0 and 6),
  payments        smallint    not null check (payments between 0 and 5),
  data_as_of      date,                             -- engine's dataAsOf (latest USDM week it actually used)
  ref_estimate_100hd_beef numeric(12,2),            -- estimatePayment('beef_adult',100,payments).cappedEstimate; reference scale only, NOT a real rancher's payment
  result          jsonb       not null,             -- the full LfpEligibilityResult, verbatim (future-proof)
  capture_source  text        not null default 'live' check (capture_source in ('live', 'backfill')),
  fetched_at      timestamptz not null default now(),
  -- Idempotency: re-running a (county, program_year, week, window) overwrites, never duplicates.
  unique (county_id, program_year, week_date, grazing_start)
);

-- Latest snapshot(s) for a county.
create index if not exists lfp_snap_county_week_idx
  on public.lfp_eligibility_snapshots (county_id, week_date desc);

-- A county's season series, keyed by fips.
create index if not exists lfp_snap_fips_year_idx
  on public.lfp_eligibility_snapshots (fips, program_year, week_date);

-- Writes (cron capture step) and reads (server component) both use the
-- service-role client, which bypasses RLS. Enable RLS with NO policies so the
-- anon key can never read or write this table.
alter table public.lfp_eligibility_snapshots enable row level security;
