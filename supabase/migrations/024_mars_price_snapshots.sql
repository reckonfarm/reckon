-- ============================================================
-- 024_mars_price_snapshots.sql
-- Newest auction priced-rows per anchor barn — the HerdEstimate's price source.
--
-- WHAT THIS IS: one row per BARN (slug_id) holding that barn's NEWEST priced sale as a jsonb
-- blob. Three anchors today: 1777 (Billings Livestock Commission, Thu), 1774 (Public Auction
-- Yards, Billings, Wed), 1773 (Miles City Livestock Commission, Tue) — all validated fresh,
-- year-round, herd-mappable. Written off-Vercel by a snapshot script (cron in GitHub Actions
-- OR launchd on PK's Mac — decided by the Azure-IP probe), READ by the HerdEstimate.
--
-- CURRENT-ONLY, NOT HISTORY: the natural key is slug_id, so each run OVERWRITES the barn's
-- row with its newest sale. SQL-queryable price history is a separate Trend approach later;
-- this table stays small (3 rows) and current by design.
--
-- WHY PER-BARN JSONB (not a relational per-row table): a per-row natural key
-- (barn+date+class+frame+weight-bracket) is NOT unique — a barn's sale carries multiple rows
-- for the same class/frame/bracket that differ only by lot_desc (weaned/unweaned) or grade,
-- which would collide on upsert and silently drop rows. Storing the newest priced rows as a
-- jsonb array sidesteps that entirely and mirrors the LRP (022) + cattle (012) snapshot
-- posture. The HerdEstimate's weight-bracket match (weight_break_low ≤ lot weight ≤ high, plus
-- commodity/class/frame) is app-side TS (reuses lotToMarsKey in lib/herd.ts), reading this
-- jsonb exactly as lib/lrp-service reads snapshot.rows.
--
-- POSTURE: additive (new table only); RLS ON with NO policies — service-role writes (the
-- snapshot script) and reads (a server component / the HerdEstimate); the anon key can never
-- touch it. Mirrors 012 / 019 / 022 exactly.
--
-- Idempotent (create … if not exists) and additive — safe to re-run.
-- Run in the Supabase SQL editor.
-- ============================================================

create table if not exists public.mars_price_snapshots (
  id           uuid        primary key default gen_random_uuid(),
  -- MARS report slug = the barn. The natural key: one current snapshot per barn.
  slug_id      text        not null,
  barn_name    text        not null,   -- 'Billings Livestock Commission'
  city         text        not null,   -- 'Billings'
  state        char(2)     not null,   -- 'MT'
  -- FRESHNESS TRUTH — the newest ROW-LEVEL report_date in the priced section, NEVER the
  -- catalog publish date (dead barns lie via catalog date; Riverton proved it). The reader
  -- gates each barn on this (~10 days = fresh, since these sell weekly) and falls to the
  -- next-nearest fresh barn when it's stale.
  report_date  date        not null,
  as_of        timestamptz,            -- the report's published time, when MARS provides it
  source       text        not null default 'USDA MARS',
  -- The newest report's priced rows, AUCTION schema (avg_weight/avg_price — NOT the Direct
  -- reports' wtd_avg_*). Each element:
  --   { commodity, class, frame,
  --     price_unit ('Per Cwt' | 'Per Unit' — REQUIRED: pairs/bred/fancy lots price per head),
  --     avg_weight, avg_weight_min, avg_weight_max,
  --     avg_price, avg_price_min, avg_price_max,
  --     head_count, receipts, receipts_week_ago, receipts_year_ago,
  --     lot_desc, weight_break_low, weight_break_high }
  rows         jsonb       not null,
  row_count    int         not null default 0,   -- convenience for display / health checks
  -- Cron HEARTBEAT — advanced on EVERY run (even a no-change re-run), so MAX(ingested_at)
  -- tracks pipeline health, distinct from report_date (data freshness). Mirrors news_items.
  ingested_at  timestamptz not null default now(),
  -- One CURRENT snapshot per barn; re-running upserts in place, never accumulates history.
  unique (slug_id)
);

-- Read pattern: "freshest fresh barns in a state" (the nearest-barn resolver, ranked by
-- report_date) — and the slug_id unique constraint already indexes the upsert key.
create index if not exists mars_price_snapshots_fresh_idx
  on public.mars_price_snapshots (state, report_date desc);

-- Service-role writes (the snapshot script) and reads (the HerdEstimate). Enable RLS with NO
-- public policies so the anon key can never touch this table (mirrors 012 / 019 / 022).
alter table public.mars_price_snapshots enable row level security;
