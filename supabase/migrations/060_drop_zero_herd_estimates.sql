-- ============================================================
-- 060_drop_zero_herd_estimates.sql
-- Delete the five herd_estimate_history rows that record a valuation of $0.
--
-- PK's ruling, 2026-09-12: a day with no usable valuation should have no row.
-- Delete, not patch. These five are the only rows in the table whose
-- total_value is not greater than zero.
--
-- WHY THEY EXIST. Two different causes, one symptom.
--
--   Kiehl Ranch, ids 19-22, snapshot_date 2026-07-13 .. 2026-07-16:
--     lots_priced = 0 of lots_total = 1. Nothing on the ranch could be priced
--     at all on those mornings, and the writer stored the sum of nothing as 0
--     rather than declining to write.
--
--   Test Ranch, id 72, snapshot_date 2026-09-10:
--     lots_priced = 2 of lots_total = 2, and still $0 — the defect Block 7.2
--     found. total_priced excludes lots under the thin-sample floor while
--     lots_priced counts them, so the row claimed two priced lots and summed
--     to nothing.
--
-- Block 7.2 already fixed the WRITER (scripts/herd-estimate-snapshot.ts now
-- skips a day with no usable valuation instead of writing a zero), so no new
-- rows of this shape can appear. This file only clears the five already there.
--
-- WHAT IS NOT LOST. 2026-09-10 keeps its other ranch's row (id 73, $95,792),
-- so no ranch-day that HAS a real valuation loses it. The four Kiehl days had
-- no valuation to lose — that is the point of deleting them. A chart that
-- plotted those days as a $0 trough was reporting a market crash that did not
-- happen.
--
-- SAFETY. Every delete is guarded by BOTH the id and total_value = 0, so a
-- re-run is a no-op and an id that ever pointed at a real valuation cannot be
-- caught by this file. Idempotent: running it twice deletes nothing the second
-- time. No schema change, no policy change.
--
-- Run in the Supabase SQL editor.
-- ============================================================

-- Kiehl Ranch — four consecutive mornings with nothing priceable (0 of 1 lots).
delete from public.herd_estimate_history
where id in (19, 20, 21, 22)
  and total_value = 0
  and lots_priced = 0
  and snapshot_date in (date '2026-07-13', date '2026-07-14', date '2026-07-15', date '2026-07-16');

-- Test Ranch — the thin-lot defect: two lots "priced", nothing summed.
delete from public.herd_estimate_history
where id = 72
  and total_value = 0
  and snapshot_date = date '2026-09-10';

-- ============================================================
-- Verify (paste back) — run separately.
-- ============================================================

-- (a) Expect 0 rows. This is the whole point of the file: no row records a
--     valuation of nothing.
select id, ranch_id, snapshot_date, total_value, lots_priced, lots_total
from public.herd_estimate_history
where total_value is null or total_value <= 0
order by snapshot_date;

-- (b) Expect 0 rows — the five ids are gone.
select id from public.herd_estimate_history where id in (19, 20, 21, 22, 72) order by id;

-- (c) Expect 62 (67 before this file, five deleted), and a minimum above zero.
select count(*) as rows_left, min(total_value) as smallest_value
from public.herd_estimate_history;

-- (d) Expect one row for 2026-09-10 — Kiehl's $95,792 survives; only the
--     zero-valued Test Ranch row for that day was removed.
select id, ranch_id, total_value
from public.herd_estimate_history
where snapshot_date = date '2026-09-10';
