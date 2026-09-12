-- ============================================================
-- 061_event_deletion.sql
-- An entry can be deleted. Two paths, one of them leaves a record.
--
-- Block 7D.1/7D.2. Until now an entry could only be CORRECTED or VOIDED (054):
-- both leave the original on the record, marked. That is right for a mistake
-- someone else has already seen. It is wrong for "I typed this into the wrong
-- ranch ten seconds ago and nobody has looked" — a correction chain for that
-- is clutter pretending to be provenance.
--
-- So: an entry that is the person's OWN, has no correction chain, and has not
-- been seen by another member is hard-deleted — the row is gone and every
-- balance recomputes without it. Everything else disappears from Activity and
-- leaves a deletion record: who, when. No reason required.
--
-- WHY COLUMNS AND NOT A TOMBSTONE TABLE. The chain must survive. 054 made
-- supersedes_event_id and superseded_by FOREIGN KEYS with ON DELETE RESTRICT,
-- both directions, so an entry at either end of a correction chain CANNOT be
-- removed — Postgres refuses with 23503. Moving a deleted row to another table
-- would mean dropping those constraints, and they are the thing that keeps a
-- correction from silently losing what it corrected. They stay. A deleted row
-- stays where it is, holding its links, and stops being visible.
--
-- NO NEW RLS POLICY, DELIBERATELY. events has no client UPDATE or DELETE
-- policy and gains neither here. Both paths run in the route under the service
-- role after it checks membership and ownership, because the hard-delete rule
-- ("no chain, mine, unseen by anyone else") is not expressible in a policy —
-- "unseen" is a comparison against every OTHER member's ranch_members.
-- last_seen_at. One place enforces it, one place is tested.
--
-- Additive, idempotent, no data touched. Order-independent: needs
-- public.events (031) and its 054 columns. Run in the Supabase SQL editor.
-- ============================================================

alter table public.events
  -- When the entry stopped being visible. Null = it stands.
  add column if not exists deleted_at timestamptz,
  -- Who removed it. SET NULL, not CASCADE: deleting the person must not
  -- resurrect the entry — the ranch's record of the removal outlives the
  -- account, the same way authorship does elsewhere.
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

comment on column public.events.deleted_at is
  $$061 Block 7D. Set when an entry was deleted but could not be removed — it holds a 054 chain link. The row keeps its links and stops being visible. Null = it stands.$$;
comment on column public.events.deleted_by is
  $$061 Block 7D. Who deleted it. No reason is required; who and when are the record.$$;

-- Every ledger read is "this ranch's live entries, newest first". The partial
-- index keeps that read off the deleted rows entirely rather than filtering
-- them after the fact.
create index if not exists events_ranch_live_idx
  on public.events (ranch_id, ts desc)
  where deleted_at is null;

-- ============================================================
-- Verify (paste back) — run separately.
-- ============================================================

-- (a) Expect two rows: deleted_at timestamptz YES, deleted_by uuid YES.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'events'
  and column_name in ('deleted_at', 'deleted_by')
order by column_name;

-- (b) Expect 0 — this file deletes nothing and marks nothing.
select count(*) as already_deleted from public.events where deleted_at is not null;

-- (c) Expect the index to exist.
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'events' and indexname = 'events_ranch_live_idx';

-- (d) UNCHANGED, and this is the point: expect exactly TWO rows, both
--     'RESTRICT' — the correction chain's guards are still in place.
select conname, confdeltype
from pg_constraint
where conrelid = 'public.events'::regclass and contype = 'f'
  and conname like '%supersed%'
order by conname;

-- (e) Expect SELECT and INSERT only. events gains no UPDATE or DELETE policy;
--     both delete paths run in the route under the service role.
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'events'
order by cmd, policyname;
