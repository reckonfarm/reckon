-- ============================================================
-- 021_rma_deadlines.sql
-- Crop-insurance deadline dates (USDA RMA) — PUBLIC reference data.
--
-- WHAT THIS IS: a small, relatively-static lookup of RMA deadline dates
-- (sales closing, acreage reporting, etc.) by state + crop/program + year,
-- read by the dashboard to drive a "next deadline" countdown card. Read by
-- everyone (the same dates for all producers); WRITTEN only by a seed script.
-- Brand-new table; additive only — this migration creates one table and
-- touches NOTHING else.
--
-- RLS POSTURE — RLS-ON-WITH-NO-POLICIES (the SNAPSHOT-table posture, 012/019):
--   This is global PUBLIC reference data, not user-owned. So it matches the
--   cattle/news snapshot tables: enable row level security with NO policies.
--   The dashboard reads it through the service-role client (createServiceClient,
--   which bypasses RLS); the anon key can never touch it. This is deliberately
--   NOT the operation_profiles (020) policy-bearing posture — that is for
--   user-owned rows; this table has no per-user ownership.
--
-- KEYING — STATE-LEVEL DATE, OPTIONAL COUNTY OVERRIDE (no per-county dup):
--   RMA sales-closing / acreage-reporting dates are typically set statewide
--   (e.g. Montana spring wheat closes the same date in all ~56 counties), with
--   occasional county-specific variation. So:
--     • state       char(2) NOT NULL  — every row carries its state.
--     • county_fips  char(5) NULL      — NULL ⇒ the date applies to the WHOLE
--                                        state; a real FIPS ⇒ a county OVERRIDE.
--   The dashboard resolves a county's fips → its state, then reads
--     WHERE state = :state AND (county_fips IS NULL OR county_fips = :fips)
--   and prefers the county-specific row when one exists. One statewide date is
--   stored ONCE, not duplicated across every county.
--
-- IDEMPOTENT SEED KEY — UNIQUE … NULLS NOT DISTINCT (requires Postgres 15+):
--   The natural key is (state, county_fips, crop_or_program, deadline_type,
--   crop_year). A PLAIN unique constraint treats NULL county_fips values as
--   DISTINCT, so two statewide rows would NOT collide and the seed script's
--   upsert would duplicate them on every run. NULLS NOT DISTINCT makes NULL =
--   NULL for the constraint, so statewide rows dedupe correctly. This is one
--   TOTAL unique key, so the seed script can target it with a simple
--   onConflict column list (supabase-js can't target partial indexes).
--   ⚠️ NULLS NOT DISTINCT is Postgres 15+ — fine on modern Supabase.
--
-- SEEDED BY A SCRIPT, NOT HERE: this migration creates the empty table only.
-- Loading the dates is a separate, reviewed step (a service-role upsert script,
-- mirroring lib/seed-counties.ts). No data is inserted in this migration, and
-- no trigger function is created.
--
-- Idempotent (create … if not exists) and additive — safe to re-run.
--
-- Run in the Supabase SQL editor.
-- ============================================================

-- 1) Table -------------------------------------------------------
create table if not exists public.rma_deadlines (
  id              uuid        primary key default gen_random_uuid(),
  -- Every row carries its state, so one state scan returns statewide rows AND
  -- that state's county overrides together. char(2), two-letter abbreviation.
  state           char(2)     not null,
  -- NULL ⇒ applies to the whole state (the common case, stored once).
  -- A real 5-digit FIPS ⇒ a county-specific OVERRIDE. FK constrains overrides
  -- to real counties; NULL statewide rows skip the FK. ON DELETE CASCADE so a
  -- removed county drops its override (rather than silently becoming statewide).
  county_fips     char(5)     references public.counties(fips) on delete cascade,
  -- e.g. 'spring_wheat', 'alfalfa', 'prf', 'lrp'.
  crop_or_program text        not null,
  -- e.g. 'sales_closing', 'acreage_reporting', 'production_reporting',
  -- 'premium_billing'.
  deadline_type   text        not null,
  deadline_date   date        not null,
  -- Crop year the date belongs to, so this year's and next year's dates coexist.
  crop_year       int         not null,
  source          text        not null default 'USDA RMA',
  -- When this date set was last verified — drives the card's freshness line.
  as_of           date,
  notes           text,
  created_at      timestamptz not null default now(),
  -- Idempotency: one row per (state, county_fips, crop/program, type, year).
  -- NULLS NOT DISTINCT so statewide rows (county_fips NULL) dedupe on re-seed.
  constraint rma_deadlines_natural_key
    unique nulls not distinct
    (state, county_fips, crop_or_program, deadline_type, crop_year)
);

-- 2) Index ------------------------------------------------------
-- Dashboard read: "upcoming deadlines for this state" — filter by state, scan
-- forward by date. Serves the common statewide path; county overrides are few
-- and resolved within the same per-state result set.
create index if not exists rma_deadlines_state_date_idx
  on public.rma_deadlines (state, deadline_date);

-- 3) Row Level Security -----------------------------------------
-- Public reference data: RLS on, NO policies (snapshot posture). Reads come
-- from the service-role client (bypasses RLS); anon can never touch the table.
alter table public.rma_deadlines enable row level security;
