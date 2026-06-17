-- ============================================================
-- 025_mars_price_history.sql
-- APPEND-ONLY price history per barn per sale date — the data behind Trend's price movement.
--
-- ADDITIVE: does NOT touch mars_price_snapshots or its read path. The resolver + HerdEstimate
-- read ONLY the snapshot (current-only); this table is read solely by Trend. scripts/mars-
-- snapshot.ts writes the current snapshot (unchanged) AND, in a wrapped second write, appends
-- here — a history failure can never break the snapshot or the run.
--
-- GROWTH: ~3 rows/week/barn (~150/yr/barn) — tiny. A weekday cron re-running the same sale
-- just re-writes that (slug_id, report_date) row; a NEW sale date appends a new immutable row.
--
-- POSTURE: service-role only (public-ish price reference data) — RLS on, NO policies, same as
-- 012 / 018 / 024. Trend reads it server-side via the service-role client.
--
-- Idempotent (create … if not exists) and additive — safe to re-run. Run in the Supabase SQL editor.
-- ============================================================

create table if not exists public.mars_price_history (
  id           bigserial   primary key,
  slug_id      text        not null,            -- the barn
  barn_name    text        not null,
  city         text        not null,
  state        char(2)     not null,
  report_date  date        not null,            -- the SALE date (row-level) — the history key
  as_of        timestamptz,                     -- report published time, when MARS provides it
  source       text        not null default 'USDA MARS',
  -- Same priced-rows shape as the snapshot (auction schema), incl. price_unit + receipts /
  -- receipts_week_ago / receipts_year_ago. See migration 024 for the element shape.
  rows         jsonb       not null,
  row_count    int         not null default 0,
  captured_at  timestamptz not null default now(),
  -- One immutable row per barn per sale date (append; idempotent re-write of the same date).
  unique (slug_id, report_date)
);

-- A barn's recent sale series (week-over-week price deltas).
create index if not exists mars_price_history_barn_idx
  on public.mars_price_history (slug_id, report_date desc);
-- State-scoped recency (regional reads).
create index if not exists mars_price_history_state_idx
  on public.mars_price_history (state, report_date desc);

-- Writes (cron) + reads (Trend, server component) both use the service-role client, which
-- bypasses RLS. Enable RLS with NO public policies so the anon key can never touch it.
alter table public.mars_price_history enable row level security;
