-- ============================================================
-- 055_lot_purpose.sql
-- Block 6A — a lot's purpose: why this bunch is on the ranch.
--
-- herd_lots.class says what the animals ARE (steers, heifers, cows …);
-- purpose says what they are FOR, which is what a market comparison must
-- state its basis against (6B: a replacement heifer's comparison is a feeder
-- reference, not a breeding value). Enum-by-check, text column — a new
-- purpose never needs a migration to be storable, only to be allowed.
--   sale_calves | replacements | breeding | culls | other
-- Backfill from class, the honest default per class; 'other' where the class
-- does not imply one. The producer sets it on the Cattle page from then on.
--
-- Idempotent, additive, order-independent (needs 051). Run in the SQL editor
-- AS ONE SELECTION — the self-check at the end raises on a partial run.
-- ============================================================

-- 0) PRE-FLIGHT (paste back) — expect the live lots by class (3 today), no purpose column yet.
select class, count(*) as lots, count(*) filter (where retired_at is null) as live
  from public.herd_lots group by class order by class;
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'herd_lots' and column_name = 'purpose';

-- 1) The column + the allowed values -----------------------------------------
alter table public.herd_lots add column if not exists purpose text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'herd_lots_purpose_check') then
    alter table public.herd_lots add constraint herd_lots_purpose_check
      check (purpose is null or purpose in ('sale_calves', 'replacements', 'breeding', 'culls', 'other'));
  end if;
end $$;

comment on column public.herd_lots.purpose is
  $$055 Block 6A. What the lot is for: sale_calves | replacements | breeding | culls | other. class says what they are; purpose says why they are here. A market comparison states its basis from this.$$;

-- 2) Backfill from class, only where unset ------------------------------------
update public.herd_lots
   set purpose = case class
                   when 'steers'    then 'sale_calves'
                   when 'yearlings' then 'sale_calves'
                   when 'heifers'   then 'replacements'
                   when 'cows'      then 'breeding'
                   when 'bulls'     then 'breeding'
                   when 'old_cows'  then 'culls'
                   else 'other'
                 end
 where purpose is null;

-- 3) SELF-CHECK — raises unless the column, the check, and the backfill are all in place
do $$
declare unset int; has_col int; has_chk int;
begin
  select count(*) into has_col from information_schema.columns where table_schema = 'public' and table_name = 'herd_lots' and column_name = 'purpose';
  select count(*) into has_chk from pg_constraint where conname = 'herd_lots_purpose_check';
  select count(*) into unset from public.herd_lots where purpose is null;
  if has_col <> 1 or has_chk <> 1 or unset <> 0 then
    raise exception '055 INCOMPLETE — column %, check %, lots without purpose %. Re-run the whole file as one selection.', has_col, has_chk, unset;
  end if;
  raise notice '055 complete: herd_lots.purpose present, checked, every lot has one';
end $$;

-- 4) Verify (paste back) — every lot with class and purpose.
select id, class, name, purpose, retired_at is not null as retired from public.herd_lots order by ranch_id, created_at;
