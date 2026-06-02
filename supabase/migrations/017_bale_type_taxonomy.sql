-- ============================================================
-- 017_bale_type_taxonomy.sql
-- Corrects the hay bale-type taxonomy on hay_listings.bale_type.
--
-- WHY: the old value set (large_round, small_round, small_square,
-- 3string_square, 4string_square) had NO true Large Square (the big
-- commercial 3x3/3x4/4x4 squares, ~800–1500 lb), and "3-/4-string Square"
-- was mislabeled — string count sizes SMALL squares (2- vs 3-string), it is
-- not a separate bale type.
--
-- NEW taxonomy (7 values):
--   small_square_2string  Small Square (2-string)  ~50-60 lb, hand-liftable
--   small_square_3string  Small Square (3-string)  ~100 lb
--   large_square_3x3      Large Square (3x3)        ~800 lb commercial
--   large_square_3x4      Large Square (3x4)        ~1000 lb commercial
--   large_square_4x4      Large Square (4x4)        ~1200-1500 lb commercial
--   round_4x4             Round (4x4)               ~600-800 lb small round
--   round_5x6             Round (5x6)               ~1000-1500 lb large round
--
-- SAFE + NON-ORPHANING + ORDER-INDEPENDENT:
--   1) drop the old CHECK,
--   2) re-add a CHECK that allows BOTH new AND legacy values, so the
--      constraint holds whether the old or new app build is live,
--   3) remap existing rows legacy -> new.
-- Run anytime relative to the deploy. A later migration can tighten the
-- CHECK to the 7 new values once no legacy values remain (see bottom).
--
-- Run in the Supabase SQL editor.
-- ============================================================

-- 1) Drop whatever CHECK currently governs bale_type (auto-generated name).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.hay_listings'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%bale_type%'
  loop
    execute format('alter table public.hay_listings drop constraint %I', c.conname);
  end loop;
end $$;

-- 2) Allow the new taxonomy AND keep legacy values valid during the transition.
alter table public.hay_listings
  add constraint hay_listings_bale_type_check
  check (bale_type in (
    -- new, industry-standard taxonomy
    'small_square_2string', 'small_square_3string',
    'large_square_3x3', 'large_square_3x4', 'large_square_4x4',
    'round_4x4', 'round_5x6',
    -- legacy values (deprecated; remapped in step 3; kept valid for a safe window)
    'large_round', 'small_round', 'small_square', '3string_square', '4string_square'
  ));

-- 3) Remap existing rows to the new taxonomy (no orphans).
update public.hay_listings set bale_type = 'round_5x6'            where bale_type = 'large_round';
update public.hay_listings set bale_type = 'round_4x4'            where bale_type = 'small_round';
update public.hay_listings set bale_type = 'small_square_2string' where bale_type = 'small_square';
update public.hay_listings set bale_type = 'small_square_3string' where bale_type = '3string_square';
-- "4-string" was non-standard; a 4-string bale is the heaviest SMALL square, so map
-- to the nearest valid small square rather than overstate it as an 800lb+ Large Square.
update public.hay_listings set bale_type = 'small_square_3string' where bale_type = '4string_square';

-- ------------------------------------------------------------
-- OPTIONAL CLEANUP — run later, once the new build is fully deployed and you have
-- confirmed no rows use legacy values (select distinct bale_type from hay_listings).
-- Tightens the CHECK to the 7 new values only.
-- ------------------------------------------------------------
-- alter table public.hay_listings drop constraint hay_listings_bale_type_check;
-- alter table public.hay_listings
--   add constraint hay_listings_bale_type_check
--   check (bale_type in (
--     'small_square_2string', 'small_square_3string',
--     'large_square_3x3', 'large_square_3x4', 'large_square_4x4',
--     'round_4x4', 'round_5x6'
--   ));
