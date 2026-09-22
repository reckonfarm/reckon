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
--
-- ONE TRANSACTION, NO TRANSACTION CONTROL. The SQL editor runs a whole paste
-- as one transaction; a begin/rollback inside it rolls back everything above
-- it — the first paste of this file lost the function that way. Every check
-- here is a read. The tests that CALL the function live in
-- 075_create_ranch_verify.sql, and none of them writes either. Re-runnable.
-- ============================================================

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

-- 2) Verify — ONE table, every check as a row (paste back) --------------------
with fn as (
  select p.oid, p.prosecdef, p.proconfig, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_ranch'
), pol as (
  select tablename, count(*) as n, string_agg(cmd, ',') as cmds from pg_policies
   where schemaname = 'public' and tablename in ('ranches', 'ranch_members') group by tablename
), checks(check_name, expected, actual) as (
  values
    ('create_ranch exists',                'true',  (select (count(*) = 1)::text from fn)),
    ('security definer',                   'true',  (select prosecdef::text from fn)),
    ('search_path pinned in definition',   'true',  (select (coalesce(array_to_string(proconfig, ','), '') like '%search_path=public%')::text from fn)),
    ('takes no user id — args',            'p_name text, p_county_fips text', (select args from fn)),
    ('authenticated may execute',          'true',  has_function_privilege('authenticated', 'public.create_ranch(text, text)', 'execute')::text),
    ('anon may execute',                   'false', has_function_privilege('anon', 'public.create_ranch(text, text)', 'execute')::text),
    ('public may execute',                 'false', has_function_privilege('public', 'public.create_ranch(text, text)', 'execute')::text),
    ('ranches: one policy, SELECT only',   'true',  (select (n = 1 and cmds = 'SELECT')::text from pol where tablename = 'ranches')),
    ('ranch_members: one policy, SELECT only', 'true', (select (n = 1 and cmds = 'SELECT')::text from pol where tablename = 'ranch_members')),
    ('ranch_members: no INSERT/UPDATE/DELETE policy', 'true', (select (count(*) = 0)::text from pg_policies where schemaname = 'public' and tablename = 'ranch_members' and cmd <> 'SELECT'))
)
select check_name, expected, coalesce(actual, 'NULL') as actual, (actual is not distinct from expected) as ok from checks;
