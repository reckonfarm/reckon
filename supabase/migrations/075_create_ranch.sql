-- ============================================================
-- 075_create_ranch.sql
-- Block 31 — a new rancher can create their ranch.
--
-- A brand-new account had no way to a ranch: every ranch that exists was
-- inserted by the service key (a seed, a script, the invite path), and
-- neither `ranches` nor `ranch_members` has a client write policy — nor may
-- they (043, 049, CLAUDE.md: membership is the sole RLS gate and never gets a
-- client write policy). So the door is a function, and it is the ONLY door
-- besides accepting an invitation.
--
-- create_ranch(name, county) — PK's rules, each proven in section 3:
--   · takes NO user id. It uses auth.uid() only, and refuses when that is null;
--   · can only ever make a NEW ranch with the caller as its owner. It never
--     adds anyone to an existing ranch: the ranch it inserts into is the one it
--     just created, in the same statement block, and the membership row is
--     (that ranch, the caller, 'owner') and nothing else;
--   · SECURITY DEFINER, with search_path pinned in the definition — required,
--     since no policy could let the caller write these tables;
--   · EXECUTE revoked from public and anon, granted to authenticated only;
--   · refuses when the caller already belongs to ANY ranch.
-- Both inserts are one transaction: both land or neither does. A per-user
-- advisory lock closes the gap where two simultaneous calls could both pass
-- the "not yet on a ranch" check.
--
-- The county goes into ranches.home_county_fips (052), which nothing has
-- written since 052's one-time backfill. Refusals come back as data, never as
-- an exception, in the ranch's own words (064's idiom).
--
-- No backfill; installing this changes no row. Needs 034 (tables), 049 (the
-- role check), 052 (home_county_fips), and the counties table.
-- ============================================================

-- 0) PRE-FLIGHT (paste back) — the policies as they stand: ONE row each, both SELECT.
select tablename, policyname, cmd, roles from pg_policies
 where schemaname = 'public' and tablename in ('ranches', 'ranch_members') order by 1, 2;

-- 1) The function -----------------------------------------------------------------
create or replace function public.create_ranch(p_name text, p_county_fips text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_fips  text := nullif(btrim(coalesce(p_county_fips, '')), '');
  v_ranch uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated', 'message', 'Sign in to set up your ranch.');
  end if;

  -- One person at a time through this door, so two taps cannot make two ranches.
  perform pg_advisory_xact_lock(hashtext('create_ranch:' || v_uid::text));

  if exists (select 1 from public.ranch_members m where m.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'already_on_a_ranch', 'message', 'You are already on a ranch.');
  end if;
  if v_name = '' or length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'bad_name', 'message', 'Your ranch needs a name, 60 letters or fewer.');
  end if;
  if v_fips is not null and not exists (select 1 from public.counties c where c.fips = v_fips) then
    return jsonb_build_object('ok', false, 'reason', 'bad_county', 'message', 'That county is not one this app knows.');
  end if;

  insert into public.ranches (name, home_county_fips) values (v_name, v_fips) returning id into v_ranch;
  insert into public.ranch_members (ranch_id, user_id, role) values (v_ranch, v_uid, 'owner');

  return jsonb_build_object('ok', true, 'ranch_id', v_ranch, 'name', v_name, 'home_county_fips', v_fips);
end $$;

comment on function public.create_ranch(text, text) is
  'Block 31 (075): makes a NEW ranch and its owner membership for auth.uid() in one transaction; refuses a caller already on any ranch. The only door into ranch_members besides accept-invite — ranch_members never gets a client write policy.';

revoke all on function public.create_ranch(text, text) from public, anon;
grant execute on function public.create_ranch(text, text) to authenticated;

-- 2) Verify (paste back) ------------------------------------------------------------
-- (a) DEFINER, search_path pinned in the definition, and the grant is authenticated only.
select p.proname, p.prosecdef as security_definer, p.proconfig as pinned_config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'create_ranch';
select grantee, privilege_type from information_schema.role_routine_grants
 where routine_schema = 'public' and routine_name = 'create_ranch' order by 1;
-- (b) it takes no user id: the argument list is (name, county) and nothing else.
select pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'create_ranch';
-- (c) the policies have not moved: still ONE row each, both SELECT — no client write policy was added.
select tablename, policyname, cmd, roles from pg_policies
 where schemaname = 'public' and tablename in ('ranches', 'ranch_members') order by 1, 2;
-- (d) nothing changed on any ranch: every ranch and every membership, as they are.
select r.id, r.name, r.home_county_fips, (select count(*) from public.ranch_members m where m.ranch_id = r.id) as members
  from public.ranches r order by r.created_at;

-- 3) The rules, run as the roles that matter (paste back) ----------------------------
-- Nothing below writes: every branch that could write is one the rules refuse.
-- (e) no session → refused as not_authenticated, not an error.
begin;
  select set_config('request.jwt.claim.sub', '', true);
  select public.create_ranch('Nobody''s ranch', null) as with_no_session;
rollback;
-- (f) a user already on Kiehl Ranch → refused; Kiehl Ranch unchanged. (The first owner of the
--     oldest ranch stands in for "a user already on a ranch".)
begin;
  select set_config('request.jwt.claim.sub', (select m.user_id::text from public.ranch_members m join public.ranches r on r.id = m.ranch_id order by r.created_at, m.created_at limit 1), true);
  select public.create_ranch('A second ranch', null) as as_an_existing_member;
  select count(*) as ranches_now from public.ranches;
rollback;
-- (g) anon cannot even call it.
begin;
  set local role anon;
  select has_function_privilege('anon', 'public.create_ranch(text, text)', 'execute') as anon_may_execute;
rollback;
select has_function_privilege('authenticated', 'public.create_ranch(text, text)', 'execute') as authenticated_may_execute,
       has_function_privilege('anon', 'public.create_ranch(text, text)', 'execute') as anon_may_execute;
