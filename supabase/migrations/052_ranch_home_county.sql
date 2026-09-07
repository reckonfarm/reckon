-- ============================================================
-- 052_ranch_home_county.sql
-- Block 4B rider — the ranch's own home county.
--
-- Home county has been PER PERSON (profiles.home_county_fips). The herd value
-- cron now values by RANCH (050) and had to place each ranch by the county of
-- whichever member last wrote its herd. A ranch has one home county; this
-- column is it. Backfilled from the ranch's first owner's profile; written by
-- /api/home-county with the service role after a membership check (ranches has
-- no client write policy — same shape as the ranch rename). profiles.
-- home_county_fips stays as each person's own county for the county tools.
--
-- Idempotent, additive, order-independent (needs 034 + counties). Run in the
-- SQL editor after the dry run.
-- ============================================================

-- 0) PRE-FLIGHT — expect 2 rows (Kiehl Ranch, Test Ranch) with the owner's county
--    (Kiehl's owner profile carries a home county; Test Ranch's owner has 30069).
select r.id, r.name,
       (select p.home_county_fips from public.ranch_members m join public.profiles p on p.id = m.user_id
         where m.ranch_id = r.id and m.role = 'owner' order by m.created_at asc limit 1) as owner_home_county
  from public.ranches r order by r.created_at;

-- 1) The column ---------------------------------------------------------------
alter table public.ranches
  add column if not exists home_county_fips char(5) references public.counties(fips) on delete set null;

update public.ranches r
   set home_county_fips = (
     select p.home_county_fips from public.ranch_members m
       join public.profiles p on p.id = m.user_id
      where m.ranch_id = r.id and m.role = 'owner' and p.home_county_fips is not null
      order by m.created_at asc limit 1
   )
 where r.home_county_fips is null;

-- 2) Verify (paste back) — expect every ranch whose owner has a county to carry it.
select id, name, home_county_fips from public.ranches order by created_at;
