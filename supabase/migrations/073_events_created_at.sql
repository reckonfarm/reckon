-- ============================================================
-- 073_events_created_at.sql
-- Block 27 — every record carries the moment it was made on the phone.
--
-- A record has had two times: `ts`, when the work happened (the person's, and
-- back-datable), and `ingested_at`, when the server received it. A phone at a
-- gate with no signal makes a record at 10:00 and sends it at 16:00, and
-- everything that asked "what is new" and "what came first" asked
-- ingested_at — so that record was news at 16:00, ordered among 16:00's work.
--
-- `created_at` is the third time: when the record was MADE, stamped by the
-- phone (the outbox already knows it) and written by the route. The server
-- orders by it and reads "since you checked" by it. `ts` stays the work time;
-- `ingested_at` stays arrival, and keeps the one job only arrival can do:
-- "has another member seen this since it landed" (deletion's gate).
--
-- EXISTING ROWS (a backfill — said plainly, PK decides): created_at is set to
-- ingested_at on every row that has none. Arrival is the best-known "made"
-- time for a record from before this, and every reader can then treat the
-- column as always present. A default of now() on ADD COLUMN would instead
-- stamp every old record with the moment this migration ran, which is false.
--
-- Idempotent. Needs 061 (deleted_at, for the index).
-- ============================================================

-- 0) PRE-FLIGHT (paste back) — how many rows the backfill touches.
select count(*) as events_total, count(*) filter (where ingested_at is null) as without_arrival
  from public.events;

-- 1) The column, nullable first so the backfill is explicit --------------------
alter table public.events add column if not exists created_at timestamptz;
comment on column public.events.created_at is
  'Block 27 (073): when the record was MADE, stamped by the phone. Orders the ledger and "since you checked". ts = the work time; ingested_at = arrival.';

-- 2) The backfill — every existing row: made = arrival (best known) -------------
update public.events set created_at = ingested_at where created_at is null;

-- 3) From here on it is always present; a writer that says nothing gets now() ----
alter table public.events alter column created_at set default now();
alter table public.events alter column created_at set not null;

-- 4) The index the readers use: newest made first, live rows, per ranch ---------
create index if not exists events_ranch_created_idx
  on public.events (ranch_id, created_at desc) where deleted_at is null;

-- 5) Verify (paste back) ----------------------------------------------------------
-- (a) no row without it; none in the future; none before its own arrival by more than a day
--     (a phone clock can run a little ahead; an hour is noise, a day is a wrong clock).
select count(*) filter (where created_at is null) as still_null,
       count(*) filter (where created_at > now() + interval '1 day') as in_the_future,
       count(*) filter (where created_at < ingested_at - interval '1 day') as made_over_a_day_before_arrival,
       count(*) filter (where created_at = ingested_at) as backfilled_equal_to_arrival
  from public.events;
-- (b) the column and the index
select column_name, is_nullable, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'events' and column_name = 'created_at';
select indexname, indexdef from pg_indexes where schemaname = 'public' and indexname = 'events_ranch_created_idx';
