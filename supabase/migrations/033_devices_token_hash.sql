-- ============================================================
-- 033_devices_token_hash.sql
-- S2 follow-through — per-device ingest tokens (the ingest route's revisit
-- trigger, decided 2026-07-26, executed 2026-07-29: hardware now syncs through
-- a phone that isn't guaranteed to be PK's forever).
--
-- One nullable column on devices, nothing else. A courier phone is itself a
-- devices row (type 'courier'); token_hash holds the sha256 hex of its bearer
-- token. /api/ingest verifies it when presented; INGEST_SECRET keeps working
-- as the shared-secret fallback. Revocation = null the column. NOT a token
-- table, NOT a new endpoint — the ingest header rejects that architecture
-- explicitly ("one door").
--
-- RLS POSTURE: unchanged. devices keeps its 031 owner-scoped policies; the
-- owner can technically SELECT their own token_hash — a hash of a secret they
-- themselves hold, harmless. Verification happens in the route via the
-- service-role client only.
--
-- ⚠️  ACCESS CLIENTS:
--   • token_hash verification: service-role client (lib/supabase.ts) in
--     app/api/ingest — BYPASSES RLS by design, like the 026 cron.
--   • nothing user-facing reads or writes this column.
--
-- Idempotent (add column if not exists; index if not exists), additive only,
-- order-independent (depends only on 031's devices table).
--
-- NOTE ON NUMBERING: 032 has no file in this directory — it was run by hand
-- 2026-07-27 with Block 2 6/8 (created public.national_beef_snapshots, unique
-- (report_slug, metric, week_ending), and dropped 012's cattle_market_snapshots).
-- This file continues from there.
--
-- Run in the Supabase SQL editor.
-- ============================================================

alter table public.devices
  add column if not exists token_hash text;  -- sha256 hex of the device's bearer token; null = device has no token (uses INGEST_SECRET)

create unique index if not exists devices_token_hash_idx
  on public.devices (token_hash)
  where token_hash is not null;              -- unique so a token resolves to exactly one device; partial so tokenless devices don't collide on null
