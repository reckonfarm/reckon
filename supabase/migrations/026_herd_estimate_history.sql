-- ============================================================
-- 026_herd_estimate_history.sql
-- PER-USER daily HerdEstimate history — the data moat. Each row = one user's total herd value
-- on a server date, with the per-lot breakdown. SERVER-AUTHORITATIVE: written ONLY by the cron
-- (scripts/herd-estimate-snapshot.ts, the second step of mars-snapshot.yml) via the service-role
-- client; never client-written.
--
-- RLS POSTURE — REAL RLS *WITH* an owner policy (like operation_profiles 020), NOT the
-- service-role-only posture of the price/LFP snapshot tables. This is per-user PRIVATE data:
--   • SELECT: owner-scoped (user_id = auth.uid()) — a producer reads ONLY their own history
--     (the Trend tab, via the user-scoped SSR client).
--   • NO insert/update/delete policies → authenticated users are DENIED writes by default. The
--     cron writes with the service-role client, which BYPASSES RLS. So the record is
--     tamper-proof + server-authoritative (captured_at is the moat timestamp, set server-side).
--
-- HONEST EVEN WHEN UNPRICED: rows are written with total_value 0 / lots_priced 0 / tier
-- 'nearest-comp'|'regional-only' when a herd can't be locally priced that day — the record says
-- "herd existed, not locally priced", never fakes worth. (Users with no home county are skipped
-- — there's nothing to value against.)
--
-- Idempotent (create … if not exists; policy drop-guarded) and additive. Run in the Supabase SQL editor.
-- ============================================================

create table if not exists public.herd_estimate_history (
  id             bigserial     primary key,
  user_id        uuid          not null references auth.users(id) on delete cascade,
  snapshot_date  date          not null,            -- server (UTC) capture date; one row per user per day
  total_value    numeric(14,2) not null,            -- estimate.total_priced (priced lots only)
  lots_priced    smallint      not null,
  lots_total     smallint      not null,
  tier           text          not null,            -- local | nearest-comp | regional-only
  county_fips    char(5),                            -- home county used (provenance)
  as_of          date,                               -- source report_date(s) the value came from
  per_lot        jsonb         not null,             -- estimate.perLot — the per-lot breakdown (the moat detail)
  captured_at    timestamptz   not null default now(),  -- SERVER-authoritative timestamp
  -- One row per user per day; re-running the cron overwrites in place (idempotent).
  unique (user_id, snapshot_date)
);

-- A user's value series, newest first (the Trend read).
create index if not exists herd_estimate_history_user_idx
  on public.herd_estimate_history (user_id, snapshot_date desc);

-- ─── Row Level Security — owner-scoped READ; cron WRITES via service-role (bypass) ───────────
alter table public.herd_estimate_history enable row level security;

-- The ONLY policy: a user reads their own history. No insert/update/delete policies — writes
-- are service-role-only by design, so the historical record can't be tampered with from a
-- client. (Mirrors operation_profiles 020's owner posture, minus the write policies.)
drop policy if exists "own herd estimate history readable" on public.herd_estimate_history;
create policy "own herd estimate history readable"
  on public.herd_estimate_history
  for select to authenticated
  using (user_id = auth.uid());
