-- ============================================================
-- 075_create_ranch_verify.sql — the rules, run against the live function.
-- Paste AFTER 075_create_ranch.sql has run. NOTHING HERE WRITES: every path
-- it takes is one the function refuses before its first insert, and the
-- session claim it sets is reset at the end. No begin/rollback — the editor
-- runs a paste as one transaction and a rollback would undo the migration.
-- ============================================================
create temp table if not exists v075 (check_name text, expected text, actual text);
delete from v075;

-- (e) no session → refused as not_authenticated.
select set_config('request.jwt.claim.sub', '', false);
insert into v075 select 'no session → not_authenticated', 'not_authenticated', public.create_ranch('Nobody''s ranch', null) ->> 'reason';

-- (f) a user already on a ranch (the first owner of the oldest ranch — Kiehl Ranch) → refused; nothing changes.
create temp table if not exists v075_before as select count(*) as ranches, (select count(*) from public.ranch_members) as memberships from public.ranches;
select set_config('request.jwt.claim.sub', coalesce((select m.user_id::text from public.ranch_members m join public.ranches r on r.id = m.ranch_id order by r.created_at, m.created_at limit 1), ''), false);
insert into v075 select 'session is an existing member (not empty)', 'true', (current_setting('request.jwt.claim.sub', true) <> '')::text;
insert into v075 select 'existing member → already_on_a_ranch', 'already_on_a_ranch', public.create_ranch('A second ranch', null) ->> 'reason';
insert into v075 select 'ranches unchanged', (select ranches::text from v075_before), (select count(*)::text from public.ranches);
insert into v075 select 'memberships unchanged', (select memberships::text from v075_before), (select count(*)::text from public.ranch_members);

-- the claim back off this session
select set_config('request.jwt.claim.sub', '', false);

-- (g) grants
insert into v075 select 'anon may execute', 'false', has_function_privilege('anon', 'public.create_ranch(text, text)', 'execute')::text;
insert into v075 select 'authenticated may execute', 'true', has_function_privilege('authenticated', 'public.create_ranch(text, text)', 'execute')::text;

-- ONE table (paste back)
select check_name, expected, coalesce(actual, 'NULL') as actual, (actual is not distinct from expected) as ok from v075;
drop table if exists v075_before;
drop table if exists v075;
