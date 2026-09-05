-- ============================================================
-- 046_sell_barn_pin.sql
-- Block 2.5 A2 — "Where I sell". FIPS locates the person; it does not say
-- where their cattle sell. One nullable column on the operation profile
-- holds the MARS report slug of the barn they haul to; the resolver puts
-- that barn first and labels it "Where you sell — <town>" instead of
-- "Nearby auction reference". Written only through PATCH
-- /api/operation-profile (own row, validated against the known barns).
--
-- Idempotent, additive, non-orphaning, order-independent (needs 020).
-- Run in the Supabase SQL editor.
-- ============================================================

alter table public.operation_profiles
  add column if not exists sell_barn_slug text;

-- Verify: expect the column, nullable.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'operation_profiles' and column_name = 'sell_barn_slug';
