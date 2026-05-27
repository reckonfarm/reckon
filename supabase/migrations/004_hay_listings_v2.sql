-- ============================================================
-- 004_hay_listings_v2.sql
-- Hay Network: richer listing schema for detail page.
-- All columns nullable — no breaking changes to existing rows.
-- Run in Supabase SQL Editor.
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
  add column if not exists hay_test_tdnpct       numeric,
  add column if not exists hay_test_rfv          integer,
  add column if not exists hay_test_moisture_pct numeric;

-- Composite index supports distance queries filtered by active status
create index if not exists hay_listings_county_active_idx
  on public.hay_listings (county_id, active);
