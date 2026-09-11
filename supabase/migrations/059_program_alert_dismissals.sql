-- ============================================================
-- 059_program_alert_dismissals.sql
-- "I've seen that" for a program alert — per person, per SPECIFIC change.
--
-- Block 7.9 puts a dismissible alert on Today when one of three things
-- happens: the ranch county's drought designation changes, the LFP status or
-- tier changes, or a deadline in lib/programDates.ts comes 30 / 7 / 1 days
-- away. Dismissal has to be per person (the owner reading it does not silence
-- it for the hand) and per change (dismissing "D2 → D3 on Sep 8" must not
-- silence "D3 → D4 on Sep 22").
--
-- WHY NOT ranch_members.last_seen_at / markets_seen_at. Those two columns
-- (044, 048) are the shape that already exists, and they are the wrong shape
-- here. They are single TIMESTAMPS: they answer "what is new since you last
-- looked". A cursor cannot answer "have you seen THIS", and gets both failure
-- modes wrong — it would silence a later, different change that happened
-- before the cursor moved, and it would re-alert an unchanged weekly USDM
-- publication simply because a new row landed. So: a keyed record.
--
-- THE KEY IS THE CHANGE, NOT THE MOMENT. alert_key is built by
-- lib/program-alerts.ts and encodes what changed and when it changed, e.g.
--   drought:30069:D2>D3:2026-09-08
--   lfp:30069:tier:1>2:2026-09-08
--   deadline:prf:sales_closing:2026-12-01:30
-- The same change dismissed once stays dismissed forever; a different change
-- has a different key and alerts again. Text, not an enum, and no CHECK: a new
-- alert kind must never require a migration (031:46's rule).
--
-- THE CODE DOES NOT NEED THIS TABLE TO WORK. lib/program-alerts.ts reads it
-- tolerantly and treats any failure — including "relation does not exist" —
-- as "nothing dismissed". The alerts render and are dismissible-in-vain until
-- this runs; nothing breaks in the window between the deploy and the SQL.
--
-- OWNERSHIP. A dismissal belongs to one person, so the primary key is
-- (user_id, alert_key) and NOT the ranch. ranch_id rides along so the row is
-- scoped, sweepable, and covered by the same membership gate as everything
-- else — but two members of one ranch dismiss independently, which is the
-- whole point.
--
-- Additive, idempotent (create … if not exists; policies drop-guarded),
-- non-orphaning (CASCADE from auth.users honours the instant-total-delete
-- promise; the ranch FK is NO ACTION like every other ledger table).
-- Order-independent: needs auth.users, public.ranches and ranch_members.
-- Run in the Supabase SQL editor.
-- ============================================================

create table if not exists public.program_alert_dismissals (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  ranch_id     uuid        not null references public.ranches(id),
  -- What was dismissed, not when it was seen. Built in lib/program-alerts.ts.
  alert_key    text        not null,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, alert_key)
);

-- The read is always "my dismissals on this ranch", so lead with the person.
create index if not exists program_alert_dismissals_ranch_idx
  on public.program_alert_dismissals (ranch_id);

-- ── RLS — membership is the gate, and a person writes only their own ─────────
-- 043's shape exactly: SELECT/DELETE gate on membership; INSERT additionally
-- requires user_id = auth.uid(), so a member cannot dismiss on someone else's
-- behalf. No UPDATE policy: a dismissal is not edited, it is made or removed.
alter table public.program_alert_dismissals enable row level security;

drop policy if exists "member dismissals readable"   on public.program_alert_dismissals;
drop policy if exists "member dismissals insertable" on public.program_alert_dismissals;
drop policy if exists "member dismissals deletable"  on public.program_alert_dismissals;

create policy "member dismissals readable"
  on public.program_alert_dismissals for select to authenticated
  using (ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid()));

create policy "member dismissals insertable"
  on public.program_alert_dismissals for insert to authenticated
  with check (
    ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
    and user_id = auth.uid()
  );

create policy "member dismissals deletable"
  on public.program_alert_dismissals for delete to authenticated
  using (
    ranch_id in (select ranch_id from public.ranch_members where user_id = auth.uid())
    and user_id = auth.uid()
  );

comment on table public.program_alert_dismissals is
  'Per-person, per-change dismissals of Today program alerts. alert_key encodes WHAT changed and WHEN it changed, so a later different change alerts again and an unchanged weekly publication never does.';

-- ============================================================
-- Verify (paste back) — run separately.
-- ============================================================

-- (a) Expect four columns; user_id + alert_key are the primary key.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'program_alert_dismissals'
order by ordinal_position;

-- (b) Expect one row: PRIMARY KEY on (user_id, alert_key).
select tc.constraint_type, string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as cols
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
where tc.table_schema = 'public' and tc.table_name = 'program_alert_dismissals'
  and tc.constraint_type = 'PRIMARY KEY'
group by tc.constraint_type;

-- (c) Expect exactly three policies — SELECT, INSERT, DELETE — all "member …",
--     all on {authenticated}, and NO update policy.
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'program_alert_dismissals'
order by cmd;

-- (d) Expect 0 — the table starts empty and this file writes nothing.
select count(*) as dismissals from public.program_alert_dismissals;
