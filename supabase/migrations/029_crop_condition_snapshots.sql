-- 029 — Crop condition snapshots (NASS corn good+excellent)
--
-- Weekly snapshot of US corn CONDITION (% good + % excellent) from USDA NASS Quick Stats —
-- the Crop leg of the dashboard's Market Read (§4 Leg 2). Written off the request path by a
-- weekly cron (scripts/crop-snapshot.ts) from ONE NASS Quick Stats call (national, in-season
-- weekly Crop Progress), summing the PCT GOOD + PCT EXCELLENT category rows into one G/E
-- figure; the dashboard only READS the latest row. Mirrors migrations 027 / 028 exactly.
--
-- THE NUMBER: good_excellent_pct = (PCT GOOD + PCT EXCELLENT) for the latest reported week.
-- prior_ge_pct (the same metric ~4 weeks earlier, from the same multi-week call) rides on the
-- SAME row so the read can show direction from a single row — like corn's prior_settle and
-- moisture's prior_drought_pct.
--
-- SEASONALITY (handled in the READ path, not here): NASS reports CONDITION only ~Apr–Nov.
-- Out of season the API freezes at last November's final week — the read path must surface an
-- "off-season / resumes in spring" state rather than a months-stale number. This table just
-- stores whatever weeks the cron has captured; the latest week_ending tells the reader how
-- current it is.
--
-- RAW jsonb: the per-category rows (good / excellent, and optionally fair/poor/very-poor) for
-- the snapshot week are kept verbatim so a different cut (e.g. poor+very-poor, or per-state)
-- can be RE-DERIVED later WITHOUT re-fetching NASS.
--
-- RLS POSTURE — RLS-ON-WITH-NO-POLICIES (the snapshot posture, 022 / 027 / 028): PUBLIC
-- reference data (the same national crop number for everyone), not user-owned. Writes (cron)
-- and reads (dashboard) both use the service-role client (bypass RLS); the anon key can never
-- touch this table.
--
-- NATURAL KEY — PLAIN UNIQUE (commodity, geography, week_ending): one row per commodity per
-- geography per report week; re-running a week overwrites, never duplicates. All three key
-- columns are NOT NULL, so a plain UNIQUE dedupes. `geography` is 'US' for v1 (national) and
-- leaves room for per-state rows later with NO schema change.
--
-- SEEDED BY A CRON, NOT HERE: this migration creates the empty table only.
-- Idempotent (create … if not exists) and additive — safe to re-run. Run in the Supabase
-- SQL editor.

create table if not exists public.crop_condition_snapshots (
  id                 uuid        primary key default gen_random_uuid(),
  commodity          text        not null,            -- 'CORN'
  geography          text        not null,            -- 'US' (national; room for state later)
  week_ending        date        not null,            -- NASS report week
  good_excellent_pct numeric     not null,            -- PCT GOOD + PCT EXCELLENT
  prior_ge_pct       numeric,                          -- same metric ~4 weeks prior (direction; nullable)
  prior_week_ending  date,                             -- the week prior_ge_pct is from (nullable)
  raw                jsonb,                            -- per-category rows (re-derivation)
  source             text        not null default 'USDA NASS Quick Stats',
  as_of              date,                             -- when fetched / verified
  created_at         timestamptz not null default now(),
  -- Idempotency: one row per commodity/geography/report-week; re-running overwrites.
  unique (commodity, geography, week_ending)
);

-- Fast "latest condition for this commodity/geography" read for the dashboard Market Read.
create index if not exists crop_condition_snapshots_latest_idx
  on public.crop_condition_snapshots (commodity, geography, week_ending desc);

-- Public reference data: RLS on, NO policies (snapshot posture). Reads come from the
-- service-role client (bypasses RLS); the anon key can never touch the table.
alter table public.crop_condition_snapshots enable row level security;
