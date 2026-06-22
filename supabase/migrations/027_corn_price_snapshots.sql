-- 027 — Corn price snapshots
--
-- Daily CBOT corn-futures SETTLE (front-month, Yahoo Finance v8 chart, symbol ZC=F),
-- written by an off-Vercel cron (scripts/corn-snapshot.ts) and read by the dashboard's
-- Market Read (§4 Leg 3 — the Price chip). The settle is captured in ¢/bushel along with
-- the prior session's settle so the read can show direction (up/down/flat) from a SINGLE
-- row on day one. Mirrors migration 022's (lrp_price_snapshots) posture exactly.
--
-- RLS POSTURE — RLS-ON-WITH-NO-POLICIES (the snapshot posture, 012 / 021 / 022):
--   PUBLIC reference data (the same corn board for everyone), not user-owned. So, like
--   lrp_price_snapshots (022), it enables row level security with NO policies. Writes come
--   from the service-role client (the cron) and reads from the service-role client (the
--   dashboard) — both bypass RLS. The anon key can never touch this table. This is NOT the
--   operation_profiles (020) policy-bearing posture (that is for user-owned rows).
--
-- NATURAL KEY — PLAIN UNIQUE: one row per (symbol, settle_date). Both key columns are
--   NOT NULL, so a plain UNIQUE dedupes correctly and the cron upserts idempotently on it
--   (re-running a day overwrites, never duplicates). `symbol` keys the front month (ZC=F)
--   today and leaves room for a new-crop December row (e.g. ZCZ26) later with NO schema
--   change.
--
-- SEEDED BY A CRON, NOT HERE: this migration creates the empty table only; loading settles
-- is a separate, reviewed step (the service-role upsert in scripts/corn-snapshot.ts).
--
-- Idempotent (create … if not exists) and additive — safe to re-run. Run in the Supabase
-- SQL editor.

create table if not exists public.corn_price_snapshots (
  id           uuid        primary key default gen_random_uuid(),
  symbol       text        not null,            -- futures symbol, e.g. 'ZC=F' (front month)
  contract     text        not null,            -- human label, e.g. 'front-month'
  settle_date  date        not null,            -- the exchange settle date (CBOT)
  settle_price numeric     not null,            -- settle, ¢/bushel
  prior_settle numeric,                         -- prior session settle (for direction; nullable)
  source       text        not null default 'Yahoo Finance',
  as_of        date,                            -- when fetched / verified
  created_at   timestamptz not null default now(),
  -- Idempotency: one row per symbol/settle-date; re-running overwrites, never duplicates.
  -- Plain UNIQUE is sufficient — both key columns are NOT NULL.
  unique (symbol, settle_date)
);

-- Fast "latest settle for this symbol" read for the dashboard Market Read.
create index if not exists corn_price_snapshots_symbol_date_idx
  on public.corn_price_snapshots (symbol, settle_date desc);

-- Public reference data: RLS on, NO policies (snapshot posture). Reads come from the
-- service-role client (bypasses RLS); the anon key can never touch the table.
alter table public.corn_price_snapshots enable row level security;
