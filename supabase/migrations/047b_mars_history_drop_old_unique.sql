-- ============================================================
-- 047b_mars_history_drop_old_unique.sql
-- Block 2.5 B2 — the part of 047 that did not fire.
--
-- 047's DO block compared the constraint's columns in attnum order against
-- array['report_date','slug_id']; the table's column order is (slug_id,
-- report_date), so the arrays never matched, no NOTICE printed, and the old
-- two-column unique survived: mars_price_history_slug_id_report_date_key.
-- 047's columns and indexes DID land (revision, superseded_by, the
-- (slug_id, report_date, revision) unique index, the current-rows index).
--
-- This file drops the old unique two ways, both safe to re-run:
--   1) by the name reported on 2026-09-05, IF EXISTS;
--   2) by column SET — names sorted, order-independent — for any other
--      two-column unique on exactly {slug_id, report_date}.
-- Nothing else is touched. Order-independent (needs 047's columns only so
-- the verify reads them; the drops themselves need nothing).
-- ============================================================

alter table public.mars_price_history
  drop constraint if exists mars_price_history_slug_id_report_date_key;

do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.mars_price_history'::regclass
      and con.contype = 'u'
      and (select array_agg(att.attname::text order by att.attname)
             from unnest(con.conkey) k(attnum)
             join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum)
          = array['report_date','slug_id']::text[]
  loop
    execute format('alter table public.mars_price_history drop constraint %I', c.conname);
    raise notice 'dropped unique constraint %', c.conname;
  end loop;
end $$;

-- Verify — (a) expect ONLY the primary key (contype p) and the superseded_by
-- foreign key (contype f); no 'u' row. (b) expect both 047 indexes present.
select conname, contype from pg_constraint where conrelid = 'public.mars_price_history'::regclass order by contype, conname;
select indexname from pg_indexes where schemaname = 'public' and tablename = 'mars_price_history' order by indexname;
