-- ============================================================
-- 053_herd_blob_retired.sql
-- Block 4B follow-up — close the window: the rows are the only herd.
--
-- Between 051 (rows created, blob untouched) and the 4B deploy, the deployed
-- code still WROTE the blob, and 051's backfill was on-conflict-do-nothing —
-- so a lot edited or added in that window lives only in the blob. This file:
--   1) re-runs the backfill as an UPSERT that takes the blob's version only
--      when the blob lot is NEWER than the row (a row edited through the new
--      per-lot routes after the deploy is never overwritten by a stale blob);
--   2) nulls operation_profiles.herd — the blob is retired; herd_lots is the
--      herd (every lot in it, recoverable from the rows, nothing lost);
--   3) drops the two user-keyed uniques 050 kept for the deploy window
--      (operation_profiles unique(user_id); herd_estimate_history
--      unique(user_id, snapshot_date)) — the ranch-keyed ones remain.
-- Idempotent, order-independent (needs 050 + 051). Run in the SQL editor.
-- ============================================================

-- 0) PRE-FLIGHT (paste back) — the drift this file closes.
--    (a) lots in a blob with no row: expect 0 or the number added in the window.
select count(*) as blob_lots_without_row
  from public.operation_profiles p, jsonb_array_elements(coalesce(p.herd->'lots','[]'::jsonb)) l
 where p.ranch_id is not null
   and not exists (select 1 from public.herd_lots h where h.id::text = l->>'id');
--    (b) lots whose blob version is newer than the row: expect 0 or the number edited in the window.
select count(*) as blob_lots_newer_than_row
  from public.operation_profiles p, jsonb_array_elements(coalesce(p.herd->'lots','[]'::jsonb)) l
  join public.herd_lots h on h.id::text = l->>'id'
 where p.ranch_id is not null
   and (l->>'updated_at')::timestamptz > h.updated_at;
--    (c) the two constraints this file drops — expect one row each.
select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid)
  from pg_constraint
 where contype = 'u'
   and ((conrelid = 'public.operation_profiles'::regclass   and conkey = array[(select attnum from pg_attribute where attrelid = 'public.operation_profiles'::regclass and attname = 'user_id')])
     or (conrelid = 'public.herd_estimate_history'::regclass and array_length(conkey, 1) = 2
         and (select array_agg(attname::text order by attname::text) from pg_attribute where attrelid = conrelid and attnum = any(conkey)) = array['snapshot_date','user_id']::text[]));

-- 1) Re-backfill: insert what is missing, update what the blob has newer ------
insert into public.herd_lots (id, ranch_id, class, name, head_count, avg_weight, weight_unit, frame, weaned, sale_windows, created_by, updated_by, created_at, updated_at)
select (l->>'id')::uuid, p.ranch_id, l->>'class', nullif(btrim(l->>'name'), ''),
       (l->>'head_count')::integer, (l->>'avg_weight')::numeric,
       coalesce(l->>'weight_unit','lb'), coalesce(l->>'frame','Medium and Large'),
       coalesce((l->>'weaned')::boolean, true), coalesce(l->'sale_windows','[]'::jsonb),
       p.user_id, p.user_id,
       coalesce((l->>'created_at')::timestamptz, now()), coalesce((l->>'updated_at')::timestamptz, now())
  from public.operation_profiles p, jsonb_array_elements(coalesce(p.herd->'lots','[]'::jsonb)) l
 where p.ranch_id is not null
on conflict (id) do update
   set class        = excluded.class,
       name         = excluded.name,
       head_count   = excluded.head_count,
       avg_weight   = excluded.avg_weight,
       weight_unit  = excluded.weight_unit,
       frame        = excluded.frame,
       weaned       = excluded.weaned,
       sale_windows = excluded.sale_windows,
       updated_by   = excluded.updated_by,
       updated_at   = excluded.updated_at
 where excluded.updated_at > public.herd_lots.updated_at;
-- (the trigger then re-stamps updated_at = now() on the rows it touched — fine: a fresh token)

-- 2) The blob is retired ------------------------------------------------------
update public.operation_profiles set herd = null where herd is not null;
comment on column public.operation_profiles.herd is
  $$RETIRED (053, Block 4B). Always null. The herd is public.herd_lots — one row per lot.$$;

-- 3) Drop the deploy-window uniques (by column set, whatever they were named) --
do $$
declare c record;
begin
  for c in
    select conrelid::regclass as tbl, conname
      from pg_constraint
     where contype = 'u'
       and ((conrelid = 'public.operation_profiles'::regclass and conkey = array[(select attnum from pg_attribute where attrelid = 'public.operation_profiles'::regclass and attname = 'user_id')])
         or (conrelid = 'public.herd_estimate_history'::regclass and array_length(conkey, 1) = 2
             and (select array_agg(attname::text order by attname::text) from pg_attribute where attrelid = conrelid and attnum = any(conkey)) = array['snapshot_date','user_id']::text[]))
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    raise notice 'dropped % on %', c.conname, c.tbl;
  end loop;
end $$;

-- 4) Verify (paste back) -----------------------------------------------------
-- (a) Expect: rows = every lot (3 unless the window added some); blobs_left 0.
select (select count(*) from public.herd_lots) as rows_in_herd_lots,
       (select count(*) from public.operation_profiles where herd is not null) as blobs_left;
-- (b) Expect ONLY the ranch-keyed uniques: operation_profiles_ranch_uniq (ranch_id),
--     herd_estimate_history_ranch_day_uniq (ranch_id, snapshot_date) — no user_id unique on either.
select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid)
  from pg_constraint
 where contype = 'u' and conrelid in ('public.operation_profiles'::regclass, 'public.herd_estimate_history'::regclass)
 order by 1, 2;
