-- ============================================================
-- 047_mars_history_revisions.sql
-- Block 2.5 B2 — retention: never overwrite an observation.
--
-- mars_price_history keyed one row per (barn, sale date), so a REVISED report
-- for the same sale date replaced the earlier row (an upsert). From now on a
-- revision is a NEW row with the next revision number, and the prior row is
-- marked superseded_by the new id — it stays. Every row already carries the
-- source report id (slug_id), the sale date (report_date), the publication
-- time (as_of), the location (barn_name/city/state), and per-row class,
-- weight range, head count, and price basis inside `rows`.
--
-- Charts read the LATEST revision per (slug_id, report_date) — i.e. rows with
-- superseded_by IS NULL — and can show the earlier reading on request.
--
-- Idempotent, additive, non-orphaning (the old unique constraint is replaced
-- by a wider one; no row is touched), order-independent (needs 025). Run in
-- the Supabase SQL editor; the writer (scripts/mars-snapshot.ts) already
-- speaks the new shape and falls back to the old upsert until this lands.
-- ============================================================

alter table public.mars_price_history
  add column if not exists revision      int    not null default 1,
  add column if not exists superseded_by bigint references public.mars_price_history(id);

alter table public.mars_price_history
  drop constraint if exists mars_price_history_slug_id_report_date_key;

create unique index if not exists mars_price_history_slug_date_rev_idx
  on public.mars_price_history (slug_id, report_date, revision);

-- The read path: current rows only.
create index if not exists mars_price_history_current_idx
  on public.mars_price_history (slug_id, report_date)
  where superseded_by is null;

-- Verify — (a) expect revision + superseded_by present; (b) expect the new unique index and
-- no old constraint; (c) expect zero superseded rows today (nothing has been revised yet).
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'mars_price_history' and column_name in ('revision', 'superseded_by');
select indexname from pg_indexes where schemaname = 'public' and tablename = 'mars_price_history';
select count(*) as superseded from public.mars_price_history where superseded_by is not null;
