-- ============================================================
-- 013_home_county.sql
-- Home county: each user designates one county as their default.
-- The dashboard opens to it automatically when no ?fips is given.
-- Run in Supabase SQL Editor.
-- ============================================================

-- One home county per user, stored as the 5-digit FIPS so the
-- dashboard can redirect to /dashboard?fips=... without a join.
-- FK to counties.fips (UNIQUE); cleared if that county row is ever removed.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS home_county_fips char(5)
    REFERENCES public.counties(fips) ON DELETE SET NULL;
