-- 028 — Feeding-region moisture (USDM footprint drought aggregate)
--
-- Weekly snapshot of how wet/dry the §4 cattle-FEEDING footprint is — the Moisture leg of
-- the dashboard's Market Read (§4 Leg 1). Written off the request path by a weekly cron
-- (scripts/moisture-snapshot.ts) from ONE USDM multi-state call
-- (StateStatistics/GetDroughtSeverityStatisticsByAreaPercent, aoi = the 16 footprint
-- states), area-weighted by static state LAND area into a single footprint figure; the
-- dashboard only READS the latest row. Mirrors migration 027's (corn_price_snapshots)
-- posture exactly.
--
-- THE NUMBER: drought_pct = area-weighted % of the footprint in D1+ (D1+D2+D3+D4). D0
-- (abnormally dry) is deliberately EXCLUDED — abnormally dry is not drought. prior_drought_pct
-- (the same metric ~4 weeks earlier, from the same multi-week call) rides on the SAME row so
-- the read can show direction (wetter/drier) from a single row — like corn's prior_settle.
--
-- RAW jsonb: the per-state six-category breakdown for the snapshot week is kept verbatim so
-- a different threshold (D2+) or a cropland-area weighting can be RE-DERIVED later WITHOUT
-- re-fetching USDM. The headline columns are the v1 read; raw is the escape hatch.
--
-- RLS POSTURE — RLS-ON-WITH-NO-POLICIES (the snapshot posture, 022 / 027): PUBLIC reference
-- data (the same footprint for everyone), not user-owned. Writes (cron) and reads (dashboard)
-- both use the service-role client (bypass RLS); the anon key can never touch this table.
-- IMPORTANT: this is a SEPARATE computation from the per-county LFP/home-county USDM reads
-- (lib/lfp-eligibility.ts) — same upstream host, different endpoint/scope/meaning (feeder
-- demand across the region, NOT money owed for one county). They must not be cross-wired.
--
-- NATURAL KEY — PLAIN UNIQUE (map_date): one row per USDM map week; re-running a week
-- overwrites, never duplicates. map_date is NOT NULL, so a plain UNIQUE dedupes.
--
-- SEEDED BY A CRON, NOT HERE: this migration creates the empty table only.
-- Idempotent (create … if not exists) and additive — safe to re-run. Run in the Supabase
-- SQL editor.

create table if not exists public.feeding_region_moisture (
  id                uuid        primary key default gen_random_uuid(),
  map_date          date        not null,            -- USDM map week (Tuesday) of the headline
  drought_pct       numeric     not null,            -- area-weighted % of footprint in D1+
  prior_drought_pct numeric,                          -- same metric ~4 weeks prior (direction; nullable)
  prior_map_date    date,                             -- the USDM week prior_drought_pct is from (nullable)
  raw               jsonb,                            -- per-state six-category breakdown (re-derivation)
  source            text        not null default 'USDM (NDMC)',
  as_of             date,                             -- when fetched / verified
  created_at        timestamptz not null default now(),
  -- Idempotency: one row per USDM map week; re-running overwrites, never duplicates.
  unique (map_date)
);

-- Fast "latest footprint moisture" read for the dashboard Market Read.
create index if not exists feeding_region_moisture_map_date_idx
  on public.feeding_region_moisture (map_date desc);

-- Public reference data: RLS on, NO policies (snapshot posture). Reads come from the
-- service-role client (bypasses RLS); the anon key can never touch the table.
alter table public.feeding_region_moisture enable row level security;
