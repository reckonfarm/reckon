-- 012 — Cattle market snapshots
--
-- Weekly snapshots of the USDA AMS "Montana Weekly Livestock Auction Summary"
-- (report 1778), written by an off-Vercel GitHub Action (www.ams.usda.gov
-- 403-blocks Vercel's egress) and read by the /cattle page. The full parsed
-- CattleMarket object is stored as JSONB so history accumulates for future
-- last-week / last-year / 5-yr comparisons without a schema change.

create table if not exists public.cattle_market_snapshots (
  id                uuid primary key default gen_random_uuid(),
  report_slug       text not null,            -- e.g. 'ams_1778'
  report_week_start date not null,            -- sale-week start (the natural key)
  report_week_end   date,
  as_of_date        date,                     -- report's published as-of date
  fetched_at        timestamptz not null default now(),
  source_url        text,
  snapshot          jsonb not null,           -- full parsed CattleMarket
  -- Idempotency: re-running a week overwrites, never duplicates.
  unique (report_slug, report_week_start)
);

-- Fast "latest snapshot for this report" lookup.
create index if not exists cattle_market_snapshots_recent_idx
  on public.cattle_market_snapshots (report_slug, report_week_start desc);

-- Writes come from the service-role client (the Action) and reads from the
-- service-role client (the server component) — both bypass RLS. Enable RLS with
-- no public policies so the anon key can never touch this table.
alter table public.cattle_market_snapshots enable row level security;
