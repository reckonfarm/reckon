-- 030 — Cattle cycle snapshots (NASS heifers-on-feed, the cycle master switch)
--
-- Quarterly snapshot of US heifers-&-heifer-calves on feed from USDA NASS Quick Stats — the
-- cattle-cycle "master switch" (§2): heifer retention is the read on where the herd cycle
-- sits. FEWER heifers on feed than a year ago = heifers being held back / herd rebuilding
-- (supportive); MORE = still going to feed, not retaining yet (ample supply). Written off the
-- request path by a quarterly cron (scripts/cattle-cycle-snapshot.ts); the dashboard only
-- READS the latest row. Mirrors migrations 027 / 028 / 029 exactly.
--
-- THE NUMBER: heifers_on_feed = head on feed at the latest quarterly point (NASS publishes the
-- heifer split ONLY at Jan/Apr/Jul/Oct 1 — quarterly, NOT monthly). yoy_pct = YoY % change vs
-- the SAME quarter a year prior (prior_year_heifers), which rides on the same row so direction
-- is single-row — like corn's prior_settle, moisture's prior_drought_pct, crop's prior_ge_pct.
--
-- RAW jsonb: the latest quarter's figures (+ the prior-year quarter) are kept verbatim so a
-- different cut (e.g. heifers as % of total on feed) can be RE-DERIVED later WITHOUT re-fetch.
--
-- RLS POSTURE — RLS-ON-WITH-NO-POLICIES (the snapshot posture, 022 / 027 / 028 / 029): PUBLIC
-- reference data (the same national cycle number for everyone), not user-owned. Writes (cron)
-- and reads (dashboard) both use the service-role client (bypass RLS); the anon key can never
-- touch this table.
--
-- NATURAL KEY — PLAIN UNIQUE (report_point): one row per quarterly point; re-running
-- overwrites, never duplicates. report_point is NOT NULL, so a plain UNIQUE dedupes.
--
-- SEEDED BY A CRON, NOT HERE: this migration creates the empty table only.
-- Idempotent (create … if not exists) and additive — safe to re-run. Run in the Supabase
-- SQL editor.

create table if not exists public.cattle_cycle_snapshots (
  id                 uuid        primary key default gen_random_uuid(),
  report_point       date        not null,            -- quarterly point (e.g. 2026-04-01)
  heifers_on_feed    numeric     not null,            -- head on feed at report_point
  prior_year_heifers numeric,                          -- same quarter, prior year (YoY; nullable)
  yoy_pct            numeric,                           -- (cur - prior)/prior * 100 (nullable)
  raw                jsonb,                             -- the quarter figures (re-derivation)
  source             text        not null default 'USDA NASS Quick Stats',
  as_of              date,                              -- when fetched / verified
  created_at         timestamptz not null default now(),
  -- Idempotency: one row per quarterly report point; re-running overwrites, never duplicates.
  unique (report_point)
);

-- Fast "latest cycle point" read for the dashboard Market Read.
create index if not exists cattle_cycle_snapshots_point_idx
  on public.cattle_cycle_snapshots (report_point desc);

-- Public reference data: RLS on, NO policies (snapshot posture). Reads come from the
-- service-role client (bypasses RLS); the anon key can never touch the table.
alter table public.cattle_cycle_snapshots enable row level security;
