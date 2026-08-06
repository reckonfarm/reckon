-- ============================================================
-- 035_events_width.sql
-- Scout firmware v0.3.0 — impact width as a typed column.
--
-- v0.3.0 records carry `width` (samples over threshold in the capture
-- window, 1..13 at 50 Hz × 250 ms): the second amplitude-independent impact
-- feature — chatter and slams overlap in peak_mg but separate in width.
-- The courier forwards it per record; like lat/lng it is promoted out of
-- payload so hail queries don't JSON-dig, while the verbatim record stays in
-- payload regardless (RAW-DATA doctrine).
--
-- Nullable by design: events from pre-v0.3.0 firmware (and every non-Scout
-- device type) have no width and stay honest nulls — no backfill, no default.
--
-- Dedupe is UNTOUCHED: (user_id, dedup_key) via 031's partial unique index
-- still decides idempotency; width plays no part in it.
-- ============================================================

alter table public.events add column if not exists width integer;

comment on column public.events.width is
  'Scout impact width (accel samples over threshold in the capture window; firmware v0.3.0+). Null for pre-width events and non-Scout devices.';
