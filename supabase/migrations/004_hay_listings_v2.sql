-- ============================================================
-- 004_hay_listings_v2.sql
-- Hay Network: richer listing schema for detail page.
-- All columns nullable — no breaking changes to existing rows.
-- Run in Supabase SQL Editor.
--
-- CORRECTION (2026-06-02): the TDN column was originally written here
-- as `hay_test_tdnpct`, but the LIVE production column is — and always
-- was — `hay_test_tdn_pct` (with the underscore), which is the name all
-- application code uses. Production never had the no-underscore name, so
-- TDN data has been read/written correctly the whole time (verified: a
-- live row carries a non-null hay_test_tdn_pct). This file is corrected
-- to match reality so a from-scratch rebuild produces the right column.
-- No data migration is needed against production.
-- ============================================================

alter table public.hay_listings
  add column if not exists cutting_number        smallint
    check (cutting_number in (1, 2, 3)),
  add column if not exists bale_type             text
    check (bale_type in ('large_round', 'small_round', 'small_square', '3string_square', '4string_square')),
  add column if not exists bale_weight_lbs       integer,
  add column if not exists storage_method        text
    check (storage_method in ('outside', 'covered', 'barn')),
  add column if not exists hay_test_protein_pct  numeric,
  add column if not exists hay_test_tdn_pct      numeric,
  add column if not exists hay_test_rfv          integer,
  add column if not exists hay_test_moisture_pct numeric;

-- Composite index supports distance queries filtered by active status
create index if not exists hay_listings_county_active_idx
  on public.hay_listings (county_id, active);
