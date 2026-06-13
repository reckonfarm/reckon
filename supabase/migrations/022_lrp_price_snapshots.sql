-- 022 — LRP price snapshots
--
-- Daily snapshots of USDA RMA "Livestock Risk Protection (LRP) Coverage Prices,
-- Rates, and Actual Ending Values" (public.rma.usda.gov/livestockreports/LRPReport),
-- written by an off-Vercel LOCAL seed script (the RMA report is a 3-step antiforgery
-- POST wizard; we fetch + parse it off the request path, exactly like the cattle
-- pipeline avoids Vercel egress) and read by the dashboard's Markets card. The full
-- parsed report object is stored as JSONB so history accumulates (and additional rows
-- — types / endorsement lengths / coverage levels — can be kept) without a schema
-- change. Mirrors migration 012's posture exactly.
--
-- RLS POSTURE — RLS-ON-WITH-NO-POLICIES (the snapshot posture, 012 / 021):
--   This is PUBLIC reference data (the same LRP index prices for everyone), not
--   user-owned. So, like cattle_market_snapshots (012) and rma_deadlines (021), it
--   enables row level security with NO policies. Writes come from the service-role
--   client (the seed script) and reads from the service-role client (the dashboard) —
--   both bypass RLS. The anon key can never touch this table. This is deliberately NOT
--   the operation_profiles (020) policy-bearing posture — that is for user-owned rows;
--   this table has no per-user ownership.
--
-- NATURAL KEY — PLAIN UNIQUE (no NULLS NOT DISTINCT needed, unlike 021):
--   One row per (commodity, lrp_type, state, effective_date). All four key columns are
--   NOT NULL, so a PLAIN unique constraint already dedupes correctly — there are no
--   NULLs to be treated as distinct. (021 needed UNIQUE … NULLS NOT DISTINCT only
--   because its county_fips key column is nullable; here nothing in the key is
--   nullable, so the standard UNIQUE is sufficient and the seed upserts idempotently
--   on it.)
--
-- SEEDED BY A LOCAL SCRIPT, NOT HERE: this migration creates the empty table only.
-- Loading the prices is a separate, reviewed step (a service-role upsert script that
-- walks the RMA LRP report wizard). No data is inserted in this migration.
--
-- Idempotent (create … if not exists) and additive — safe to re-run.
--
-- Run in the Supabase SQL editor.

create table if not exists public.lrp_price_snapshots (
  id             uuid        primary key default gen_random_uuid(),
  commodity      text        not null,            -- e.g. '0801' / 'Feeder Cattle'
  lrp_type       text        not null,            -- e.g. 'Steers Weight 2'
  state          char(2)     not null,            -- two-letter state, e.g. 'MT'
  effective_date date        not null,            -- the RMA sales effective date
  snapshot       jsonb       not null,            -- full parsed report (headline + kept rows)
  source         text        not null default 'USDA RMA',
  as_of          date,                            -- when fetched / verified
  created_at     timestamptz not null default now(),
  -- Idempotency: one row per type/state/effective-date; re-running overwrites, never
  -- duplicates. Plain UNIQUE is sufficient — all key columns are NOT NULL (see header).
  unique (commodity, lrp_type, state, effective_date)
);

-- Fast "latest LRP for this state" read for the dashboard Markets card.
create index if not exists lrp_price_snapshots_state_date_idx
  on public.lrp_price_snapshots (state, effective_date desc);

-- Public reference data: RLS on, NO policies (snapshot posture). Reads come from the
-- service-role client (bypasses RLS); the anon key can never touch the table.
alter table public.lrp_price_snapshots enable row level security;
