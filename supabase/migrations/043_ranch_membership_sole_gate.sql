-- ============================================================
-- 043_ranch_membership_sole_gate.sql
-- Block 1C step 3 — membership is THE gate on the ranch ledger.
--
-- DEFECT (policy dump 2026-09-05, proven by scripts/rls-test.ts): every
-- ranch-scoped policy on events, places, devices, detections,
-- detection_runs, jobs, job_annotations reads
--   (user_id = auth.uid()) OR (ranch_id in <memberships>)
-- The user_id leg is the hole: a member can INSERT a row carrying ANOTHER
-- ranch's ranch_id (with_check passes on user_id), and a REMOVED member
-- keeps reading every row they authored. Authorship is history, not a
-- grant. job_annotations INSERT already had the correct AND form and is the
-- model for every INSERT below.
--
-- RULES applied to all seven tables:
--   SELECT / UPDATE / DELETE  using:      ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
--   INSERT                    with check: that clause AND user_id = auth.uid()
--   UPDATE carries BOTH using and with_check (a row cannot be moved to
--   another ranch). events keeps NO update/delete policy (append-only;
--   corrections are superseding events in Block 2). jobs, detections,
--   detection_runs keep NO write policies (service-role writers only).
--   Every policy is `to authenticated` — the four tables whose policies
--   were on role {public} (detections, detection_runs, jobs,
--   job_annotations) move to {authenticated}.
--
-- PREREQUISITE: 042_ranch_id_backfill.sql (its verify query all zeros).
-- A row with ranch_id null matches no policy below and is reachable only
-- by the service role — intended for a person with no ranch, wrong for a
-- member's row, hence 042 first.
--
-- UNCHANGED: ranch_members "own membership readable" (the membership grant
-- itself — every subquery below runs under it; remove it and the ledger
-- goes silently empty) and ranches "member ranches readable". ranch_members
-- has no INSERT/UPDATE/DELETE policy: no invite path exists (Block 2).
-- alert_sent and hay_* stay policy-less (deny-all, server-side only);
-- herd_estimate_history and operation_profiles stay user_id-scoped
-- (Block 2 multi-user gap, not a hole).
--
-- DROPPED, by name (from the dump):
--   places:          "ranch places readable", "ranch places insertable",
--                    "ranch places updatable", "ranch places deletable"
--   devices:         "ranch devices readable", "ranch devices insertable",
--                    "ranch devices updatable", "ranch devices deletable"
--   events:          "ranch events readable", "ranch events insertable"
--   jobs:            "ranch jobs readable"
--   job_annotations: "ranch job annotations readable",
--                    "ranch job annotations insertable",
--                    "ranch job annotations updatable"
--   detection_runs:  "ranch detection runs readable"
--   detections:      "ranch detections readable"
-- Also drop-guarded: 031's ten "own …" names and this file's own "member …"
-- names, so the file is re-runnable. NEVER re-run 034/036/037/038 after
-- this: they would recreate the OR'd "ranch …" policies beside these.
--
-- Idempotent, data-untouched, order-independent (needs the seven tables +
-- ranch_members). Run in the Supabase SQL editor AFTER 042.
-- ============================================================

-- 1) places — full CRUD, membership only -------------------------------------
drop policy if exists "own places readable"      on public.places;
drop policy if exists "own places insertable"    on public.places;
drop policy if exists "own places updatable"     on public.places;
drop policy if exists "own places deletable"     on public.places;
drop policy if exists "ranch places readable"    on public.places;
drop policy if exists "ranch places insertable"  on public.places;
drop policy if exists "ranch places updatable"   on public.places;
drop policy if exists "ranch places deletable"   on public.places;
drop policy if exists "member places readable"   on public.places;
drop policy if exists "member places insertable" on public.places;
drop policy if exists "member places updatable"  on public.places;
drop policy if exists "member places deletable"  on public.places;

create policy "member places readable"
  on public.places for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

create policy "member places insertable"
  on public.places for insert to authenticated
  with check (
    ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
    and user_id = auth.uid()
  );

create policy "member places updatable"
  on public.places for update to authenticated
  using      (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()))
  with check (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

create policy "member places deletable"
  on public.places for delete to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- 2) devices — full CRUD, membership only ------------------------------------
drop policy if exists "own devices readable"      on public.devices;
drop policy if exists "own devices insertable"    on public.devices;
drop policy if exists "own devices updatable"     on public.devices;
drop policy if exists "own devices deletable"     on public.devices;
drop policy if exists "ranch devices readable"    on public.devices;
drop policy if exists "ranch devices insertable"  on public.devices;
drop policy if exists "ranch devices updatable"   on public.devices;
drop policy if exists "ranch devices deletable"   on public.devices;
drop policy if exists "member devices readable"   on public.devices;
drop policy if exists "member devices insertable" on public.devices;
drop policy if exists "member devices updatable"  on public.devices;
drop policy if exists "member devices deletable"  on public.devices;

create policy "member devices readable"
  on public.devices for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

create policy "member devices insertable"
  on public.devices for insert to authenticated
  with check (
    ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
    and user_id = auth.uid()
  );

create policy "member devices updatable"
  on public.devices for update to authenticated
  using      (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()))
  with check (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

create policy "member devices deletable"
  on public.devices for delete to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- 3) events — select + insert ONLY (append-only ledger) ----------------------
drop policy if exists "own events readable"      on public.events;
drop policy if exists "own events insertable"    on public.events;
drop policy if exists "ranch events readable"    on public.events;
drop policy if exists "ranch events insertable"  on public.events;
drop policy if exists "member events readable"   on public.events;
drop policy if exists "member events insertable" on public.events;

create policy "member events readable"
  on public.events for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

create policy "member events insertable"
  on public.events for insert to authenticated
  with check (
    ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
    and user_id = auth.uid()
  );

-- 4) jobs — select only (service-role deriver writes) ------------------------
drop policy if exists "ranch jobs readable"  on public.jobs;
drop policy if exists "member jobs readable" on public.jobs;

create policy "member jobs readable"
  on public.jobs for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- 5) job_annotations — select / insert / update, membership only -------------
drop policy if exists "ranch job annotations readable"    on public.job_annotations;
drop policy if exists "ranch job annotations insertable"  on public.job_annotations;
drop policy if exists "ranch job annotations updatable"   on public.job_annotations;
drop policy if exists "member job annotations readable"   on public.job_annotations;
drop policy if exists "member job annotations insertable" on public.job_annotations;
drop policy if exists "member job annotations updatable"  on public.job_annotations;

create policy "member job annotations readable"
  on public.job_annotations for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

create policy "member job annotations insertable"
  on public.job_annotations for insert to authenticated
  with check (
    ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
    and user_id = auth.uid()
  );

create policy "member job annotations updatable"
  on public.job_annotations for update to authenticated
  using      (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()))
  with check (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- 6) detection_runs — select only (service-role detector writes) -------------
drop policy if exists "ranch detection runs readable"  on public.detection_runs;
drop policy if exists "member detection runs readable" on public.detection_runs;

create policy "member detection runs readable"
  on public.detection_runs for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- 7) detections — select only ------------------------------------------------
drop policy if exists "ranch detections readable"  on public.detections;
drop policy if exists "member detections readable" on public.detections;

create policy "member detections readable"
  on public.detections for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

-- 8) Verify (paste back) -----------------------------------------------------
-- (a) Expect exactly 18 rows, every policyname starting "member ", every
--     roles = {authenticated}, and no qual/with_check containing
--     "user_id = auth.uid()" followed by OR.
select tablename, policyname, cmd, roles,
       (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ 'user_id = auth\.uid\(\)\)?\s+OR' as has_or_user_leg
from pg_policies
where schemaname = 'public'
  and tablename in ('places','devices','events','jobs','job_annotations','detection_runs','detections')
order by tablename, cmd, policyname;

-- (b) Expect zero rows: nothing left on role {public} across these tables.
select tablename, policyname, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('places','devices','events','jobs','job_annotations','detection_runs','detections')
  and 'public' = any(roles::text[]);
